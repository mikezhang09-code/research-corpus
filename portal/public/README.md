# Research Corpus — public viewer

A public-facing **Cloudflare Worker** companion to `portal/frontend`. The
**"My Research"** folios are **fully editable** here — create folios, upload
files, write Markdown notes, rename, retag, delete. The saved
**"NotebookLM Corpus"** artifacts stay
**view-only**. Both surfaces have the inline viewers (DOCX, Excel, PDF, images,
audio/video, slides, mind maps, flashcards). There is **no chat** and **no
NotebookLM access** — those stay on the private `portal/frontend` (Tailscale).

It is a self-contained Worker, gated by **Cloudflare Access** (login handled by
Cloudflare — no auth code in the app).

## Architecture

```
Browser ──Access login──▶ Cloudflare Worker (this app, OpenNext)
                               ├─ reads/writes Supabase  (folio/file/artifact rows)
                               └─ reads/writes R2        (folio file objects)
```

- **No VPS, no tunnel, no FastAPI backend.** `/api/*` is served by this app's
  own route handlers (`src/app/api/**`), which talk to Supabase with the
  service-role key (a Worker secret) and to R2 through a bucket binding.
- **My Research** is read/write; the **NotebookLM Corpus** is read-only —
  artifacts are generated on the private portal, which needs NotebookLM +
  Google auth. File reads stream from R2 public URLs; writes/deletes use the
  `R2_BUCKET` binding.
- Hosting: Next.js on Cloudflare via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

## Environment

Copy `.dev.vars.example` → `.dev.vars` for local dev (use the same Supabase
project as the private portal — see `portal/.env`). For the deployed Worker:

| Name | Kind | How to set |
|---|---|---|
| `SUPABASE_URL` | var | `wrangler.jsonc` `vars` |
| `R2_PUBLIC_URL` | var | `wrangler.jsonc` `vars` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |
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

It needs two **repository secrets** (Settings → Secrets and variables →
Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with *Workers Scripts: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

### Manual

`npm run deploy` from this directory — needs the same two values as
environment variables (see `.cf-setup.env`).

### One-time setup

1. `SUPABASE_URL` is a plain var in `wrangler.jsonc`; set the
   `SUPABASE_SERVICE_ROLE_KEY` secret once with
   `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` — Worker secrets
   persist across deploys.
2. In the Cloudflare dashboard (Zero Trust → Access), add a **self-hosted
   Access application** on the Worker's hostname with a policy allowing your
   email(s). That is the login gate.

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
