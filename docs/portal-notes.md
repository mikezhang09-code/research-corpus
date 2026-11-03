**Status:** Active
**Last Updated:** 2026-11-01

# Portal Working Notes

Conventions, deployment facts, and gotchas for the personal research portal
under `portal/`. Read this before changing anything in `portal/` — especially
from a cloud/remote session that cannot see the production host. First-time
account setup (Supabase, R2) is in
[portal-infrastructure-setup.md](portal-infrastructure-setup.md); the systemd
runbook is in [`portal/deploy/README.md`](../portal/deploy/README.md).

Secrets are never in this repo. `portal/.env`, `portal/public/.dev.vars` and
`portal/public/.cf-setup.env` are gitignored and exist only on the host.

## Scope and working style

- **Single user.** The portal is for one person. Do not propose multi-tenancy,
  Supabase Auth, row-level security, `owner_user_id` columns, or sign-in pages.
  When a feature could be built "simple for one user" or "scalable for many",
  pick simple.
- **Minimal scope first.** Lead with the smallest change that solves the stated
  problem; offer bigger versions as optional. For deploys, schema changes, or
  anything touching Supabase/R2/billing: write the plan, then wait for an
  explicit "go". Small fixes that were asked for can just be done.
- **Commits.** Solo repo: committing straight to `main` is fine when asked.
  Cloud/remote sessions should push to a **branch** instead — a push to `main`
  that touches `portal/public/**` deploys the public viewer immediately.
- `gh` defaults to the upstream repo (`teng-lin/notebooklm-py`) because this repo
  was imported, not forked. Always pass `-R mikezhang09-code/research-corpus` to
  `gh run` / `gh pr` / `gh workflow`.

## Two deployments

### 1. Private portal (`portal/frontend` + `portal/backend`) — the host VM

Runs as two systemd units on an Oracle ARM Ubuntu VM, reached only over
Tailscale (no public exposure):

| Unit | What | Bind |
|---|---|---|
| `research-portal-backend.service` | FastAPI (uvicorn, no reload) | `127.0.0.1:8000` |
| `research-portal-frontend.service` | Next.js **production** build (`next start`) | `0.0.0.0:3001` |

- The frontend's `/api/*` rewrite proxies to the backend; the backend is never
  on a tailnet/public interface and has **no auth**.
- Port is **3001**, not 3000 (another local service owns 3000).
- **After pulling code** — the frontend is not hot-reloaded:
  ```bash
  sudo systemctl restart research-portal-backend.service        # backend changes
  cd portal/frontend && npm run build \
    && sudo systemctl restart research-portal-frontend.service  # frontend changes
  journalctl -u research-portal-frontend.service -f             # logs
  ```
- Tailscale Funnel and a Cloudflare Tunnel for this portal were both evaluated
  and declined — plain Tailscale already covers "only me, from anywhere".

### 2. Public viewer (`portal/public`) — Cloudflare Worker

A separate, self-contained Next.js app deployed with OpenNext as the Worker
`research-portal-public`, served at `corpus.companyresearch.org` (and
`*.workers.dev`). It talks to Supabase (service-role key) and R2 (`R2_BUCKET`
binding) directly — **not** through the VM backend.

- **Auto-deploys** via `.github/workflows/deploy-public-viewer.yml` on push to
  `main` touching `portal/public/**` (also `workflow_dispatch`).
- **Access control:** `corpus.companyresearch.org` sits behind Cloudflare Access
  (email allowlist) at the edge. Every other hostname goes through the
  admin-password gate in `src/middleware.ts` (stateless HMAC cookie). The
  password is the GitHub secret `ADMIN_PASSWORD`, re-synced on every deploy;
  rotating it invalidates all cookies. Middleware fails closed (503) if unset.
- **Capabilities:** My Research folios are fully writable (create / upload /
  edit / delete / AI generate); the NotebookLM Corpus is read-only; folio
  **chat is VM-only** (needs Python text extraction the Worker can't run).
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` set once with
  `wrangler secret put` (persist across deploys). `ADMIN_PASSWORD`,
  `GEMINI_API_KEY` synced from GitHub secrets each deploy. Model names
  (`ANTHROPIC_MODEL`, `GEMINI_MODEL`) are dashboard *secrets* so they can be
  changed without a redeploy (plain dashboard vars get wiped by deploys).
- **Deploy token** (`CLOUDFLARE_API_TOKEN` GitHub secret) needs
  `Workers Scripts: Edit` **and** `Workers R2 Storage: Read` — wrangler checks
  the bound bucket exists at deploy time; a deploy once broke without it.
- Many UI components are **duplicated** in `portal/frontend/src` and
  `portal/public/src` (e.g. `components/markdown/markdown-extras.tsx`,
  `components/library/*`). Fix bugs in both copies.

## AI providers

- Chat and generate use **Google Gemini** first (`GEMINI_MODEL`), with the
  **Xiaomi MiMo** Anthropic-compatible proxy as the automatic fallback
  (`portal/backend/ai.py`, mirrored in the Worker's generate route). MiMo is
  called via the `anthropic` SDK and serves only MiMo models; no `claude-*`
  model name works.
- The effective base URL / model come from `portal/.env`
  (`ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`); `portal/backend/config.py` holds
  *different* fallback defaults — never quote those as the live values.
  Change the model by editing `.env` and restarting the backend.
- List models: `GET <proxy root>/v1/models` (the path is at the root, not under
  `/anthropic/`).
- MiMo may return `thinking` blocks alongside `text`; handlers must keep
  filtering for `type == "text"`.

## Supabase

- Run SQL/DDL through the **Management API**
  (`POST https://api.supabase.com/v1/projects/<ref>/database/query`, bearer
  `SUPABASE_PAT` from `portal/.env`). Direct Postgres is IPv6-only and the VM
  has IPv4-only egress; the pooler hostnames don't resolve the tenant.
- That API sits behind Cloudflare: send `User-Agent: curl/8.0`, or Python's
  default UA gets `403 error code: 1010`.
- Migrations live in `portal/supabase/migrations/NNN_name.sql`, numbered
  sequentially.

## Features with non-obvious decisions

- **Push folio → NotebookLM** (`POST /api/library-notebooks/{id}/push-to-corpus`)
  downloads from R2 and uploads via `client.sources.add_file()`. Feeding R2
  public URLs to `add_url` was tested and **rejected**: NotebookLM scrapes them
  as `web_page` and errors (even for `.md`), with no speed gain.
- **`folio` CLI** (`portal/cli/folio.py`): stdlib-only client over the backend
  REST API, symlinked to `~/.local/bin/folio` on the host. `$FOLIO_API`
  overrides the base (default `http://127.0.0.1:8000/api`; from another tailnet
  machine use the frontend proxy `http://<host>:3001/api`). The interactive
  picker uses `fzf` when installed, else a numbered menu.
- **Markdown viewer** allows `data:image/*` URLs via a custom `urlTransform`
  (`markdownUrlTransform`); react-markdown's default strips them, which blanked
  base64-embedded images from Word/Docs exports.
- **PDF viewer/editor** (`components/library/Pdf*.tsx`, `lib/pdf.ts`,
  `lib/pdf-edit.ts`, `lib/pdf-text.ts`) replaced the old "open `r2_url` in a
  new tab and let the browser render it" path. Everything runs in the browser —
  the public viewer is a Cloudflare Worker and the VM's Next server has no PDF
  toolchain, so a server-side tool like Stirling-PDF (Java/PDFBox) was not an
  option; its feature list was used as the scope reference instead.
  - **pdf.js** (`pdfjs-dist`, **legacy build** — the modern one calls
    `Map#getOrInsertComputed`, missing before the very latest browsers) renders:
    continuous scroll, fit-width / fit-page / stepped zoom, view rotation, a real
    text layer (select + copy), whole-document search with hit highlighting, a
    thumbnail rail, the document outline, print and download.
  - **pdf-lib** powers the editor: arrange / rotate / delete / duplicate /
    insert / merge / extract pages, document metadata, and flattened mark-up
    (text, highlight, freehand, edited text). Each operation re-serialises the
    whole file, which makes undo a stack of buffers and keeps the thumbnails
    honest. Saving PUTs over the same R2 object, so the file keeps its id, URL
    and category.
  - **Runtime data** — `scripts/copy-pdfjs-assets.mjs` (run by `npm run dev` /
    `npm run build`, output gitignored) copies pdf.js's `cmaps/`,
    `standard_fonts/`, `wasm/` and `iccs/` into `public/pdfjs/`, and `openPdf`
    passes their URLs. These are not optional: without `cMapUrl`, text set in a
    non-embedded CJK font (predefined CMaps like `UniGB-UCS2-H`) renders as
    *nothing*, and without `wasmUrl` every JPEG 2000 / JBIG2 image — the usual
    encoding of scanned papers — decodes to a blank. Files load lazily, only
    when a document needs one. The public app's middleware excludes `/pdfjs/`
    (Cloudflare serves assets ahead of the Worker anyway).
  - **Worker** — one `PDFWorker` is created once and passed to every
    `getDocument` via the `worker` option. pdf.js only destroys a worker on
    `loadingTask.destroy()` when it created that worker itself, so sharing it
    this way is safe. Do **not** use `GlobalWorkerOptions.workerPort` instead:
    pdf.js treats a port as its own, and the first `destroy()` kills it for
    every document ("PDFWorker.create - the worker is being destroyed").
    `workerSrc` comes from `new URL(..., import.meta.url)` so it is emitted
    under `_next/static/media/`, same-origin, as both auth gates require.
  - **Render pipeline** (measured on a 200-page file; the numbers are in the PR
    that introduced it): pages outside the prerender window shrink their
    canvas to 0×0 — the only way to free a bitmap — and drop the text layer;
    renders go through a 2-slot priority queue in `lib/pdf.ts` (pages before
    thumbnails, queued pages that scroll away never start, and a slot is
    released on abort because `getPage()` on a destroyed document never
    settles); bitmaps render off-screen and swap in when done; zoom re-renders
    only after it settles (`ZOOM_SETTLE_MS`), and the text layer follows zoom
    through `--total-scale-factor` without being rebuilt; one canvas is capped
    at 4096² pixels (iOS Safari's limit); thumbnails and editor tiles render
    lazily as they scroll into view.
  - **Edit text** (Annotate tab) is cover-and-redraw: click a line, change it,
    and on Apply the line is painted over in its sampled background colour and
    the new text drawn on the original baseline, in the original direction
    (even on `/Rotate` pages). It is visually exact, but the old glyphs stay in
    the content stream, so search and copy still find the old words — truly
    deleting them means rewriting Tj/TJ operators, which no client-side library
    does reliably. Lines are pdf.js text items merged along a baseline.
  - **Non-Latin text** (edited lines and free-text notes): WinAnsi text is real
    text in Helvetica / Times / Courier; anything else — Chinese above all — is
    rendered by the browser with a system font and embedded as a 288 dpi image.
    No font download, any script the reader's machine can show; the trade-off
    is that such text is not selectable. Embedding a CJK font (fontkit + a
    hosted TTF) would make it selectable at the cost of a ~10 MB asset.
  - **Text-layer CSS** lives in `globals.css` (`.pdf-text-layer`), trimmed from
    `pdfjs-dist/web/pdf_viewer.css` — importing that file whole would pull in
    ~165 KB of annotation/editor styles we don't use.
  - **Known limits**: encrypted PDFs are refused (pdf-lib cannot decrypt);
    printing rasterises pages and is capped at 80; edited text keeps the old
    words searchable underneath (see above).
  - Wired into folio cards, Free Forms, and — read-only, through
    `/api/artifacts/{id}/content` rather than the public R2 URL — the
    NotebookLM Corpus artifact cards.

## Upstream (`teng-lin/notebooklm-py`)

- Re-add per clone: `git remote add upstream https://github.com/teng-lin/notebooklm-py.git`.
- Pull only when needed (e.g. an RPC ID broke). **Merge, never rebase**
  (portal history is pushed).
- **Never push upstream tags** (`--tags` / `--follow-tags`): tag pushes once ran
  upstream's "Publish to PyPI" workflow here. That workflow is disabled on
  GitHub — keep it disabled.
- `portal/` never conflicts, but upstream refactors of `src/notebooklm/` can
  break portal imports at runtime. After a merge, before restarting:
  ```bash
  .venv/bin/python -c "from portal.backend.routers import notebooks, library_notebooks, artifacts, library; print('imports OK')"
  ```

## What a cloud/remote session cannot do

No access to the secrets above, the live database/R2 data, the VM's services,
or the tailnet. Code edits, builds, type checks (`npx tsc --noEmit`), lint and
unit tests work; anything that needs real data, a service restart, or a
production rebuild happens on the host after `git pull`. `package-lock.json`
for `portal/frontend` is gitignored, so dependency versions may differ slightly
from the host.
