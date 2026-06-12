# Research Corpus — public viewer

A public-facing **Cloudflare Worker** companion to `portal/frontend`. The
**"My Research"** folios are **fully editable** here — create folios, upload
files, write Markdown notes, rename, retag, delete. The saved
**"NotebookLM Corpus"** artifacts stay
**view-only**. Both surfaces have the inline viewers (DOCX, Excel, PDF, images,
audio/video, slides, mind maps, flashcards). There is **no chat** and **no
NotebookLM access** — those stay on the private `portal/frontend` (Tailscale).

It is a self-contained Worker. Access control is split per hostname: an
**in-app admin password gate** covers every hostname, except
`corpus.companyresearch.org` where **Cloudflare Access** (Zero Trust email
allowlist) does the job at the edge instead — see [Access control](#access-control).

## Architecture

```
Browser ──password / Access──▶ Cloudflare Worker (this app, OpenNext)
                                   ├─ reads/writes Supabase  (folio/file/artifact rows)
                                   ├─ reads/writes R2        (folio file objects)
                                   └─ calls MiMo / Gemini    (folio AI generate)
```

- **No VPS, no tunnel, no FastAPI backend.** `/api/*` is served by this app's
  own route handlers (`src/app/api/**`), which talk to Supabase with the
  service-role key (a Worker secret) and to R2 through a bucket binding.
- **My Research** is read/write; the **NotebookLM Corpus** is read-only —
  artifacts are generated on the private portal, which needs NotebookLM +
  Google auth. File reads stream from R2 public URLs; writes/deletes use the
  `R2_BUCKET` binding.
- Hosting: Next.js on Cloudflare via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

## Access control

Four hostnames reach this Worker; two mechanisms guard them (since 2026-06-12):

| Hostname | Gate |
|---|---|
| `public.research.us.kg` | admin password (in-app) |
| `research-portal-public.hongyanzhang69.workers.dev` | Cloudflare Access **then** admin password |
| `*-research-portal-public.hongyanzhang69.workers.dev` (previews) | Cloudflare Access **then** admin password |
| `corpus.companyresearch.org` | Cloudflare Access only (password gate skipped) |

How the password gate works (`src/middleware.ts`, `src/app/login/`,
`src/app/api/login/`, `src/lib/auth.ts`):

- Every request is checked in Next.js middleware. No valid cookie → pages
  redirect to `/login?next=…`, API calls get `401`.
- The session cookie (`rc_public_auth`, 1 year, `HttpOnly`/`Secure`) is a
  **stateless HMAC** keyed by `ADMIN_PASSWORD` — nothing is stored server-side,
  and **rotating the password invalidates every logged-in browser at once**.
- `corpus.companyresearch.org` is in the middleware's exempt-host list because
  Cloudflare Access already authenticated those requests at the edge. Edge
  gates only protect their own hostname, which is exactly why the in-app gate
  exists: it covers the `workers.dev` URLs that would otherwise bypass Access
  on the custom domain.
- If `ADMIN_PASSWORD` is missing in production the middleware **fails closed**
  (503). Under `next dev` without the var, the gate is off.
- **Rotate the password**: update the `ADMIN_PASSWORD` GitHub secret, then
  re-run the "Deploy public viewer" workflow (the deploy syncs it to the
  Worker — a dashboard edit of this particular secret would be overwritten on
  the next deploy).

## AI generate

Folios have a **Generate** dropdown (Note / Mind map / Quiz / Flashcards) →
`POST /api/library-notebooks/{id}/generate`. Provider policy mirrors
`portal/backend/ai.py`: **MiMo first, Gemini fallback**, error only when both
fail. Context is the folio's text artifacts read from R2; output is validated
against the viewer schemas and saved like a manual upload.

**Changing the model names needs no deploy**: `ANTHROPIC_MODEL` and
`GEMINI_MODEL` are deliberately *not* in `wrangler.jsonc` — they are
**Secret-type values in the Cloudflare dashboard** (Workers →
research-portal-public → Settings → Variables and Secrets). Edit there →
effective immediately. They must be the *Secret* type: plaintext vars added in
the dashboard are wiped by every deploy, secrets persist. Code defaults when
unset: `mimo-v2.5` / `gemini-2.5-flash`.

(The private portal reads the same knobs from `portal/.env`
(`ANTHROPIC_MODEL`, `GEMINI_MODEL`) — edit + `sudo systemctl restart
research-portal-backend`.)

## Environment

Copy `.dev.vars.example` → `.dev.vars` for local dev (use the same Supabase
project as the private portal — see `portal/.env`). For the deployed Worker:

| Name | Kind | How to set |
|---|---|---|
| `SUPABASE_URL` | var | `wrangler.jsonc` `vars` |
| `R2_PUBLIC_URL` | var | `wrangler.jsonc` `vars` |
| `ANTHROPIC_BASE_URL` | var | `wrangler.jsonc` `vars` — MiMo's Anthropic-compatible proxy |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | `wrangler secret put …` once; persists across deploys |
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put …` once; persists across deploys |
| `ADMIN_PASSWORD` | secret | GitHub secret, synced by the deploy workflow every deploy |
| `GEMINI_API_KEY` | secret | GitHub secret, synced by the deploy workflow every deploy |
| `ANTHROPIC_MODEL` | secret | Cloudflare dashboard (Secret type) — instant model switch |
| `GEMINI_MODEL` | secret | Cloudflare dashboard (Secret type) — instant model switch |
| `R2_BUCKET` | R2 binding | `wrangler.jsonc` `r2_buckets` — bucket `research-portal` |

## Commands

```bash
npm install
npm run dev       # local dev on http://localhost:3003
npm run build     # standard Next.js build (type-check)
npm run preview   # build + run in the local Cloudflare Workers runtime
npm run deploy    # build + deploy to Cloudflare
```

## Deploy

### Automatic (GitHub Actions)

Pushing to `main` with changes under `portal/public/**` auto-deploys the
Worker via `.github/workflows/deploy-public-viewer.yml` (runs `npm ci` +
`npm run deploy`). Python-only commits don't trigger it. You can also run
it manually from the repo's **Actions** tab ("Deploy public viewer" → Run
workflow).

It needs four **repository secrets** (Settings → Secrets and variables →
Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with *Workers Scripts: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `ADMIN_PASSWORD` | password gate — synced to the Worker on every deploy |
| `GEMINI_API_KEY` | Gemini fallback key — synced to the Worker on every deploy |

### Manual

`npm run deploy` from this directory — needs the same two values as
environment variables (see `.cf-setup.env`).

### One-time setup

1. `SUPABASE_URL` is a plain var in `wrangler.jsonc`; set the
   `SUPABASE_SERVICE_ROLE_KEY` secret once with
   `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` — Worker secrets
   persist across deploys.
2. In the Cloudflare dashboard (Zero Trust → Access), the **self-hosted
   Access applications** on `corpus.companyresearch.org` and the `workers.dev`
   hostname allow the listed email(s). The other hostnames rely on the in-app
   password gate (see [Access control](#access-control)).
3. In the Worker's dashboard settings, add `ANTHROPIC_MODEL` and
   `GEMINI_MODEL` as **Secret**-type values (see [AI generate](#ai-generate)).

## Copied from `portal/frontend`

To keep both apps visually identical without a shared package, the design system
and presentational components were **copied** from `portal/frontend`. If you
change any of these there, re-copy them here:

- `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(corpus)/layout.tsx`
- `src/components/corpus/*`, `src/components/ui/*`
- `src/components/library/` viewer modals — `DocxModal`, `ExcelModal`,
  `ImageModal`, `AudioModal`, `VideoModal`, `MindMapModal`
- `src/components/library/` writable folio components — `FileCard`,
  `FilesPanel`, `AddFileModal`, `NoteEditorModal`, `TagInput`,
  `file-categories.ts`
- `src/hooks/*`, `src/lib/utils.ts`, `tsconfig.json`, `postcss.config.mjs`,
  `eslint.config.mjs`

Files **specific to this app**:

- `src/middleware.ts`, `src/lib/auth.ts`, `src/app/login/`,
  `src/app/api/login/` — the admin password gate (the private portal needs no
  equivalent — it lives behind Tailscale).
- `src/lib/supabase.ts` — service-role Supabase client + R2 streaming helper.
- `src/lib/r2.ts` — R2 bucket-binding helper (writes/deletes) + key builders.
- `src/lib/api.ts` — API client: read + My Research write methods.
- `src/app/api/**` — Supabase + R2 route handlers (My Research read/write,
  NotebookLM Corpus read-only).
- `src/app/(corpus)/library/*`, `notebooklm/*` — folio pages (My Research
  editable) and view-only Corpus pages.
- `src/components/library/CreateLibraryNotebookModal.tsx`,
  `LibraryNotebookDescription.tsx` — adapted from `portal/frontend` (no emoji
  picker, no AI description — those need state/services this app omits).
- `src/components/notebook/artifact-viewers.tsx` — artifact viewer modals
  extracted from `portal/frontend`'s `notebooklm/[id]/page.tsx`.
- `src/components/corpus/Masthead.tsx` — `ArchiveCount` counts saved-artifact
  notebooks instead of live NotebookLM notebooks.
- Cloudflare configs: `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`.
