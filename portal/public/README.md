# Research Corpus — public viewer

A public-facing, **view-only** companion to `portal/frontend`. It displays the
**"My Research"** folios and their files, and the saved **"NotebookLM Corpus"**
artifacts — with all the inline viewers (DOCX, Excel, PDF, images, audio/video,
slides, mind maps, flashcards). No editing, no chat, no NotebookLM access.

It is a self-contained **Cloudflare Worker**, gated by **Cloudflare Access**
(login handled by Cloudflare — no auth code in the app). Managing the corpus
stays on the private `portal/frontend` (Tailscale).

## Architecture

```
Browser ──Access login──▶ Cloudflare Worker (this app, OpenNext)
                               ├─ reads Supabase   (folio/file/artifact metadata)
                               └─ streams files    (R2, via public URLs)
```

- **No VPS, no tunnel, no FastAPI backend.** `/api/*` is served by this app's
  own route handlers (`src/app/api/**`), which query Supabase with the
  service-role key (a Worker secret) and proxy file bytes from R2.
- Read-only by construction — there are no write endpoints.
- Hosting: Next.js on Cloudflare via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

## Environment

Copy `.dev.vars.example` → `.dev.vars` for local dev (use the same Supabase
project as the private portal — see `portal/.env`). For the deployed Worker:

| Name | Kind | How to set |
|---|---|---|
| `SUPABASE_URL` | var | `wrangler.jsonc` `vars`, or dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |

## Commands

```bash
npm install
npm run dev       # local dev on http://localhost:3003
npm run build     # standard Next.js build (type-check)
npm run preview   # build + run in the local Cloudflare Workers runtime
npm run deploy    # build + deploy to Cloudflare
```

## Deploy

1. `npm run deploy` (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in
   the environment; token needs *Workers Scripts: Edit*).
2. Set `SUPABASE_URL` (var) and `SUPABASE_SERVICE_ROLE_KEY` (secret).
3. In the Cloudflare dashboard (Zero Trust → Access), add a **self-hosted
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
- `src/hooks/*`, `src/lib/utils.ts`, `tsconfig.json`, `postcss.config.mjs`,
  `eslint.config.mjs`

Files **specific to this app**:

- `src/lib/supabase.ts` — service-role Supabase client + R2 streaming helper.
- `src/lib/api.ts` — read-only API client.
- `src/app/api/**` — Supabase-backed read route handlers.
- `src/app/(corpus)/library/*`, `notebooklm/*` — view-only pages.
- `src/components/library/FileCard.tsx` — view-only (no edit/delete).
- `src/components/notebook/artifact-viewers.tsx` — artifact viewer modals
  extracted from `portal/frontend`'s `notebooklm/[id]/page.tsx`.
- `src/components/corpus/Masthead.tsx` — `ArchiveCount` counts saved-artifact
  notebooks instead of live NotebookLM notebooks.
- Cloudflare configs: `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`.
