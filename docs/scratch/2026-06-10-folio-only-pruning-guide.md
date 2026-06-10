# Folio-only pruning guide

How to replicate the research portal **without NotebookLM** — keeping only the
Folio ("My Research" / library notebooks) functionality. Written 2026-06-10
after auditing every `notebooklm` import in `portal/`.

## TL;DR

The NotebookLM dependency is cleanly isolated. Only three backend modules
import the `notebooklm` package (all lazily, inside functions), and
`portal/backend/requirements.txt` does not list it. Everything Folio needs is
Supabase + R2 + one Anthropic-compatible chat API key.

Two replication paths:

| Path | Effort | What you get |
|---|---|---|
| **A. `portal/public` only** | Minimal | Cloudflare Worker app; folios fully read/write, all inline viewers, no chat |
| **B. Full portal, pruned** | Small | FastAPI + Next.js on your own host; folios + MiMo/Gemini chat + AI descriptions |

## Path A — take the Cloudflare Worker app

`portal/public` already contains **zero NotebookLM code**. It serves its own
`/api/*` routes which talk directly to Supabase (service-role key) and R2
(bucket binding). Keep:

- `portal/public/` (the whole directory; ignore `.next/` and `.open-next/` build output)
- `portal/supabase/migrations/` (run against a fresh Supabase project)

Delete everything else in the repo. Provision: Supabase project, R2 bucket,
Cloudflare account (Workers + Access). See `portal/public/README.md` for env
vars and deploy.

The NotebookLM Corpus tab will simply be empty — optionally prune its UI the
same way as described for the frontend in Path B.

## Path B — full portal (FastAPI backend + Next.js frontend)

### Delete: the entire upstream `notebooklm-py` library (repo root)

The repo root is the imported upstream Python library; it exists only to drive
NotebookLM. A Folio-only replica deletes all of it:

```
src/  tests/  docs/  examples/  scripts/
pyproject.toml  uv.lock  SKILL.md  AGENTS.md  CHANGELOG.md
SECURITY.md  notebooklm-py.png  README.md (upstream content)
package.json  package-lock.json  node_modules/  (root-level, skill tooling)
```

Verification: `grep -rn "from notebooklm\|import notebooklm" portal/backend`
hits only the three files deleted below.

### Delete: backend NotebookLM side

| Path | Why |
|---|---|
| `portal/backend/routers/notebooks.py` | The only router that uses `NotebookLMClient` (sync, sources, research, generate, live chat) |
| `portal/backend/tasks/` (whole dir) | `generator.py` + `downloader.py` both drive NotebookLM artifact generation/download |
| `portal/backend/routers/artifacts.py` | NLM corpus artifact CRUD; imports `tasks.downloader` |
| `portal/backend/repositories/artifacts.py` | Repository for the above |

Then edit:

- `portal/backend/main.py` — remove the `notebooks` and `artifacts` imports
  and their two `app.include_router(...)` lines (lines 39–40).
- `portal/backend/models.py` — optionally prune NLM-only models
  (`NotebookRead`, `NLMArtifact*`, `Research*`, `Generate*`, `LiveArtifact*`).
  Harmless if left.
- `portal/backend/config.py` — optionally drop `notebooklm_home`. Harmless if left.
- `portal/backend/tests/` — prune tests covering the deleted routers/tasks
  (`test_api.py`, `test_pipeline.py`, `conftest.py`, `test_pure_functions.py`
  all reference notebook/artifact code paths; keep the library/folio tests).

### Keep: backend Folio core

```
portal/backend/main.py            (edited)
portal/backend/config.py
portal/backend/database.py
portal/backend/storage.py         # R2 helpers; only a "notebooklm/" key-prefix string remains
portal/backend/models.py
portal/backend/ai.py              # MiMo primary / Gemini fallback chat helper
portal/backend/routers/library.py
portal/backend/routers/library_notebooks.py
portal/backend/repositories/library.py
portal/backend/repositories/library_notebooks.py
portal/backend/requirements.txt   # already NotebookLM-free
```

Note: folio file rows live in the **`library_items`** table
(`repositories/library_notebooks.py` → `ITEMS_TABLE = "library_items"`), so
keep both `library*` routers/repositories.

### Delete: frontend NotebookLM side

| Path | Why |
|---|---|
| `src/app/(corpus)/notebooklm/` (both pages) | NLM corpus + notebook detail UI |
| `src/components/generate/` | Artifact-generation modal/sheet |
| `src/components/notebook/` — all **except** `ChatPanel.tsx`, `EmojiPicker.tsx`, `emoji.ts` | Sources panel, research/discover modals, etc. are NLM-only |
| `src/components/corpus/CorpusCard.tsx` | Used only by the NLM corpus page |

**Shared files — do NOT delete:**

- `components/notebook/ChatPanel.tsx` — the folio detail page reuses it with
  `apiPrefix: "/api/library-notebooks"` (MiMo chat, not NotebookLM)
- `components/notebook/EmojiPicker.tsx` + `emoji.ts` — used by folio pages/modals
- `components/corpus/SourceThumb.tsx` — imported by `FolioCard.tsx`
- `components/corpus/SectionSwitch.tsx` — imported by `Masthead.tsx`
- All other `components/corpus/*` (`FolioCard`, `CollapsiblePanel`,
  `Expandable`, `SectionHead`, `PresentationModal`, `Masthead`)
- All of `components/library/`, `components/ui/`, `hooks/`, `lib/`

Then edit:

- `src/app/page.tsx` — change `redirect("/notebooklm")` → `redirect("/library")`
- `src/components/side-nav.tsx` — remove the NotebookLM link
- `src/components/corpus/Masthead.tsx` / `SectionSwitch.tsx` — drop the
  NotebookLM section toggle if present
- `src/lib/api.ts` — optionally delete the notebook/artifact API functions
  (dead code otherwise; nothing breaks if left)

### Keep: everything else

```
portal/frontend/                  (minus deletions above)
portal/supabase/migrations/       # 001 also creates now-unused notebooks/nlm_artifacts tables — they just sit empty
portal/deploy/                    # systemd units; adjust paths/ports
portal/start-backend.sh  portal/start-frontend.sh
```

### Provisioning for a replicator

1. Supabase project → run `portal/supabase/migrations/*.sql` in order
2. Cloudflare R2 bucket (or any S3-compatible store; `r2_endpoint_url` is configurable)
3. One Anthropic-compatible API key for chat + AI descriptions —
   `anthropic_base_url` in `config.py` defaults to the Xiaomi MiMo proxy but
   accepts the real Anthropic API; `gemini_api_key` is an optional fallback
4. `portal/.env` with the Supabase/R2/AI settings from `portal/backend/config.py`

**No** Google account, cookies, Playwright, or `uv`/`pyproject` install — the
backend installs from `requirements.txt` alone.

### Functional delta vs the full portal

Lost: NotebookLM corpus tab, artifact generation/download, source management,
research agent, "save artifact to library".
Unchanged: folio create/rename/tag/delete, file upload, Markdown notes, chat,
AI descriptions, and every inline viewer (DOCX, Excel, PDF, image, A/V,
slides, mind maps, flashcards, JSX).
