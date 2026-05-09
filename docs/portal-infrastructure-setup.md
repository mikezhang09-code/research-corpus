**Status:** Active
**Last Updated:** 2026-05-09

# Portal Infrastructure Setup

Two external services to configure before development can begin:

1. **Supabase** — PostgreSQL database for all metadata (notebooks, artifact index, library index, tags, summaries)
2. **Cloudflare R2** — Object storage for all actual files (audio, video, PDFs, reports, etc.)

Once you have completed both sections, fill in `portal/.env.example` → `portal/.env` and hand back for the rest to be built.

---

## Part 1 — Supabase

### Step 1: Create a project

1. Go to **https://supabase.com** and sign in (GitHub login works)
2. Click **New project**
3. Fill in:
   - **Name**: `research-portal` (or anything you prefer)
   - **Database password**: choose a strong password — **save it**, you'll need it
   - **Region**: pick the one closest to you
4. Click **Create new project** and wait ~2 minutes for provisioning

---

### Step 2: Get your API credentials

1. In your project, go to **Settings** (gear icon, bottom-left) → **API**
2. Copy and save these three values:
   - **Project URL** — looks like `https://abcdefghij.supabase.co`
   - **anon / public key** — under "Project API keys" → `anon` `public`
   - **service_role key** — under "Project API keys" → `service_role` `secret` (click to reveal)

> The `anon` key is safe to use in the frontend. The `service_role` key has full DB access — backend only, never expose it in the browser.

---

### Step 3: Run the database schema

1. In your project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Paste the entire SQL block below and click **Run** (▶)

```sql
-- ============================================================
-- Table: notebooks
-- Cache of NotebookLM notebooks, refreshed on sync
-- ============================================================
CREATE TABLE IF NOT EXISTS notebooks (
  id              text PRIMARY KEY,
  title           text NOT NULL DEFAULT '',
  sources_count   int  NOT NULL DEFAULT 0,
  is_owner        bool NOT NULL DEFAULT true,
  nlm_created_at  timestamptz,
  last_synced_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Table: library_items
-- Created BEFORE nlm_artifacts so the FK can reference it
-- ============================================================
CREATE TABLE IF NOT EXISTS library_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  -- source_type: 'upload' | 'drive' | 'youtube_link' | 'web_link'
  source_type     text NOT NULL,
  original_name   text NOT NULL,
  mime_type       text,
  file_ext        text,
  r2_key          text,
  r2_url          text,
  file_size_bytes bigint,
  is_link_only    bool NOT NULL DEFAULT false,
  external_url    text,
  drive_file_id   text,
  -- Original Google Workspace MIME type before export
  drive_mime_type text,
  summary         text NOT NULL DEFAULT '',
  tags            text[] NOT NULL DEFAULT '{}',
  collection      text,
  added_at        timestamptz NOT NULL DEFAULT now(),
  last_modified   timestamptz,
  -- Auto-populated by trigger below — do not set manually
  search_vector   tsvector
);

CREATE INDEX IF NOT EXISTS idx_library_source_type ON library_items(source_type);
CREATE INDEX IF NOT EXISTS idx_library_added_at    ON library_items(added_at);
CREATE INDEX IF NOT EXISTS idx_library_collection  ON library_items(collection);
CREATE INDEX IF NOT EXISTS idx_library_tags        ON library_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_library_search      ON library_items USING GIN(search_vector);

-- Full-text search: auto-update search_vector on every insert/update
CREATE OR REPLACE FUNCTION library_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '')       || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.summary, ''));
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER library_search_vector_trigger
BEFORE INSERT OR UPDATE ON library_items
FOR EACH ROW EXECUTE FUNCTION library_search_vector_update();

-- ============================================================
-- Table: nlm_artifacts
-- One row per downloaded NotebookLM artifact
-- ============================================================
CREATE TABLE IF NOT EXISTS nlm_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- artifact.id from the NotebookLM API
  nlm_artifact_id text UNIQUE NOT NULL,
  notebook_id     text REFERENCES notebooks(id) ON DELETE CASCADE,
  -- Denormalized so we don't need a join for display
  notebook_title  text,
  -- artifact_type values: audio | video | report | quiz | flashcards |
  --   mind_map | infographic | slide_deck | data_table
  artifact_type   text NOT NULL,
  -- Actual file extension: mp4 | mp3 | md | pdf | pptx | json | png | csv | html
  file_format     text NOT NULL,
  title           text NOT NULL DEFAULT '',
  summary         text NOT NULL DEFAULT '',
  -- R2 object key — NULL until file is downloaded
  r2_key          text,
  r2_url          text,
  file_size_bytes bigint,
  -- download_status: pending | downloading | done | failed
  download_status text NOT NULL DEFAULT 'pending',
  downloaded_at   timestamptz,
  download_error  text,
  nlm_created_at  timestamptz,
  portal_added_at timestamptz NOT NULL DEFAULT now(),
  tags            text[] NOT NULL DEFAULT '{}',
  notes           text NOT NULL DEFAULT '',
  -- Populated when user clicks "Save to Library"
  library_item_id uuid REFERENCES library_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_nlm_notebook_id     ON nlm_artifacts(notebook_id);
CREATE INDEX IF NOT EXISTS idx_nlm_artifact_type   ON nlm_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_nlm_download_status ON nlm_artifacts(download_status);
CREATE INDEX IF NOT EXISTS idx_nlm_portal_added_at ON nlm_artifacts(portal_added_at);
CREATE INDEX IF NOT EXISTS idx_nlm_tags            ON nlm_artifacts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_nlm_fts             ON nlm_artifacts USING GIN(
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,''))
);
```

4. You should see **"Success. No rows returned"** — that means all tables, indexes, and the trigger were created correctly
5. To verify, click **Table Editor** in the left sidebar — you should see three tables: `notebooks`, `library_items`, `nlm_artifacts`

---

### Step 4: Disable Row Level Security (for private local use)

By default Supabase enables RLS on all tables, which blocks all queries unless you add policies. Since this portal is single-user and private, the simplest approach is to disable it:

1. Go to **Table Editor** → click `notebooks` → click **RLS disabled** toggle → confirm
2. Repeat for `library_items` and `nlm_artifacts`

> If you later want to add auth/multi-user support, you can re-enable RLS and add policies.

---

## Part 2 — Cloudflare R2

### Step 1: Enable R2 on your account

1. Go to **https://dash.cloudflare.com** and sign in
2. In the left sidebar, click **R2 Object Storage**
3. If prompted, click **Purchase R2** — don't worry, the free tier is generous:
   - 10 GB storage/month free
   - 1 million write operations/month free
   - 10 million read operations/month free
   - **Zero egress fees** (unlike AWS S3)
4. You may need to add a payment method even for the free tier

---

### Step 2: Create the bucket

1. Click **Create bucket**
2. Fill in:
   - **Bucket name**: `research-portal` (must be globally unique — add your initials if taken, e.g. `research-portal-mz`)
   - **Location**: leave as **Automatic** (or choose a region near you)
3. Click **Create bucket**

---

### Step 3: Enable public access (so files are directly accessible via URL)

This lets report files, images, and audio be served directly to the browser without going through the backend.

1. Open your bucket → click **Settings** tab
2. Scroll to **Public access**
3. Click **Allow Access** → confirm
4. Note the **Public bucket URL** — it looks like `https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev`

> If you prefer files to be private (served only via signed URLs), skip this step. The backend will generate short-lived presigned URLs instead. Either works — public is simpler.

---

### Step 4: Create an R2 API token

1. Go back to the **R2 overview page** (not inside a bucket)
2. Click **Manage R2 API Tokens** (top-right)
3. Click **Create API token**
4. Fill in:
   - **Token name**: `research-portal-backend`
   - **Permissions**: select **Object Read & Write**
   - **Specify bucket**: select your `research-portal` bucket
   - **TTL**: leave as no expiry (or set to 1 year)
5. Click **Create API Token**
6. **Copy immediately** — the secret is only shown once:
   - **Access Key ID** — looks like `abc1234567890def...`
   - **Secret Access Key** — looks like `xyz9876543210abc...`
7. Also note your **Account ID** — visible at the top of the R2 overview page (32-character hex string)

---

### Step 5: Find the R2 S3-compatible endpoint

The R2 S3 endpoint follows this pattern:
```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

You'll need this for boto3/S3 SDK configuration.

---

## Part 3 — Fill in the .env file

Open `portal/.env` (copy from `portal/.env.example`) and fill in every value you collected above.

The file is at: `portal/.env.example`

---

## Summary Checklist

**Supabase:**
- [ ] Project created
- [ ] Project URL copied
- [ ] `anon` key copied
- [ ] `service_role` key copied
- [ ] Database connection string copied (Settings → Database → Connection string → URI)
- [ ] RLS disabled on all 3 tables

> **Note:** You do NOT need to run the SQL schema manually — once you provide the filled `.env`, the SQL will be run directly from Claude Code.

**Cloudflare R2:**
- [ ] R2 enabled on account
- [ ] Bucket `research-portal` created
- [ ] Public access enabled (bucket URL noted)
- [ ] API token created with Read & Write permission
- [ ] Access Key ID copied
- [ ] Secret Access Key copied
- [ ] Account ID noted
