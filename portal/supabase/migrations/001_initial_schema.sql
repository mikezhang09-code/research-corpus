-- =============================================================================
-- Migration 001: Initial schema
-- Tables: notebooks, library_items, nlm_artifacts
-- =============================================================================

-- -------------------------------------------------------------------------
-- Table: notebooks
-- Cache of NotebookLM notebooks, refreshed on sync
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notebooks (
  id              text PRIMARY KEY,
  title           text NOT NULL DEFAULT '',
  sources_count   int  NOT NULL DEFAULT 0,
  is_owner        bool NOT NULL DEFAULT true,
  nlm_created_at  timestamptz,
  last_synced_at  timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- Table: library_items
-- Manually uploaded files and Google Drive imports
-- Created before nlm_artifacts so the FK reference works
-- -------------------------------------------------------------------------
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
  drive_mime_type text,
  summary         text NOT NULL DEFAULT '',
  tags            text[] NOT NULL DEFAULT '{}',
  collection      text,
  added_at        timestamptz NOT NULL DEFAULT now(),
  last_modified   timestamptz,
  search_vector   tsvector
);

CREATE INDEX IF NOT EXISTS idx_library_source_type ON library_items(source_type);
CREATE INDEX IF NOT EXISTS idx_library_added_at    ON library_items(added_at);
CREATE INDEX IF NOT EXISTS idx_library_collection  ON library_items(collection);
CREATE INDEX IF NOT EXISTS idx_library_tags        ON library_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_library_search      ON library_items USING GIN(search_vector);

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

-- -------------------------------------------------------------------------
-- Table: nlm_artifacts
-- One row per downloaded NotebookLM artifact
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nlm_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nlm_artifact_id text UNIQUE NOT NULL,
  notebook_id     text REFERENCES notebooks(id) ON DELETE CASCADE,
  notebook_title  text,
  -- artifact_type: audio | video | report | quiz | flashcards |
  --   mind_map | infographic | slide_deck | data_table
  artifact_type   text NOT NULL,
  -- file_format: mp4 | mp3 | md | pdf | pptx | json | png | csv | html
  file_format     text NOT NULL,
  title           text NOT NULL DEFAULT '',
  summary         text NOT NULL DEFAULT '',
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

-- -------------------------------------------------------------------------
-- Disable Row Level Security (single-user personal portal)
-- -------------------------------------------------------------------------
ALTER TABLE notebooks     DISABLE ROW LEVEL SECURITY;
ALTER TABLE library_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE nlm_artifacts DISABLE ROW LEVEL SECURITY;
