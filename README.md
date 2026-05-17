# notebooklm-py
<p align="left">
  <img src="https://raw.githubusercontent.com/teng-lin/notebooklm-py/main/notebooklm-py.png" alt="notebooklm-py logo" width="128">
</p>

**A Comprehensive NotebookLM Skill & Unofficial Python API.** Full programmatic access to NotebookLM's features—including capabilities the web UI doesn't expose—via Python, CLI, and AI agents like Claude Code, Codex, and OpenClaw.

[![PyPI version](https://img.shields.io/pypi/v/notebooklm-py.svg)](https://pypi.org/project/notebooklm-py/)
[![Python Version](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12%20%7C%203.13%20%7C%203.14-blue)](https://pypi.org/project/notebooklm-py/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/teng-lin/notebooklm-py/actions/workflows/test.yml/badge.svg)](https://github.com/teng-lin/notebooklm-py/actions/workflows/test.yml)
<p>
  <a href="https://trendshift.io/repositories/19116" target="_blank"><img src="https://trendshift.io/api/badge/repositories/19116" alt="teng-lin%2Fnotebooklm-py | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

**Source & Development**: <https://github.com/teng-lin/notebooklm-py>

> **⚠️ Unofficial Library - Use at Your Own Risk**
>
> This library uses **undocumented Google APIs** that can change without notice.
>
> - **Not affiliated with Google** - This is a community project
> - **APIs may break** - Google can change internal endpoints anytime
> - **Rate limits apply** - Heavy usage may be throttled
>
> Best for prototypes, research, and personal projects. See [Troubleshooting](docs/troubleshooting.md) for debugging tips.

## What You Can Build

🤖 **AI Agent Tools** - Integrate NotebookLM into Claude Code, Codex, and other LLM agents. Ships with a root [NotebookLM skill](SKILL.md) for GitHub and `npx skills add` discovery, local `notebooklm skill install` support for Claude Code and `.agents` skill directories, and repo-level Codex guidance in [`AGENTS.md`](AGENTS.md).

📚 **Research Automation** - Bulk-import sources (URLs, PDFs, YouTube, Google Drive), run web/Drive research queries with auto-import, and extract insights programmatically. Build repeatable research pipelines.

🎙️ **Content Generation** - Generate Audio Overviews (podcasts), videos, slide decks, quizzes, flashcards, infographics, data tables, mind maps, and study guides. Full control over formats, styles, and output.

📥 **Downloads & Export** - Download all generated artifacts locally (MP3, MP4, PDF, PNG, CSV, JSON, Markdown). Export to Google Docs/Sheets. **Features the web UI doesn't offer**: batch downloads, quiz/flashcard export in multiple formats, mind map JSON extraction.

## Three Ways to Use

| Method | Best For |
|--------|----------|
| **Python API** | Application integration, async workflows, custom pipelines |
| **CLI** | Shell scripts, quick tasks, CI/CD automation |
| **Agent Integration** | Claude Code, Codex, LLM agents, natural language automation |

## Features

### Complete NotebookLM Coverage

| Category | Capabilities |
|----------|--------------|
| **Notebooks** | Create, list, rename, delete |
| **Sources** | URLs, YouTube, files (PDF, text, Markdown, Word, audio, video, images), Google Drive, pasted text; refresh, get guide/fulltext |
| **Chat** | Questions, conversation history, custom personas |
| **Research** | Web and Drive research agents (fast/deep modes) with auto-import |
| **Sharing** | Public/private links, user permissions (viewer/editor), view level control |

### Content Generation (All NotebookLM Studio Types)

| Type | Options | Download Format |
|------|---------|-----------------|
| **Audio Overview** | 4 formats (deep-dive, brief, critique, debate), 3 lengths, 50+ languages | MP3/MP4 |
| **Video Overview** | 3 formats (explainer, brief, cinematic), 9 visual styles, plus a dedicated `cinematic-video` CLI alias | MP4 |
| **Slide Deck** | Detailed or presenter format, adjustable length; individual slide revision | PDF, PPTX |
| **Infographic** | 3 orientations, 3 detail levels | PNG |
| **Quiz** | Configurable quantity and difficulty | JSON, Markdown, HTML |
| **Flashcards** | Configurable quantity and difficulty | JSON, Markdown, HTML |
| **Report** | Briefing doc, study guide, blog post, or custom prompt | Markdown |
| **Data Table** | Custom structure via natural language | CSV |
| **Mind Map** | Interactive hierarchical visualization | JSON |

### Beyond the Web UI

These features are available via API/CLI but not exposed in NotebookLM's web interface:

- **Batch downloads** - Download all artifacts of a type at once
- **Quiz/Flashcard export** - Get structured JSON, Markdown, or HTML (web UI only shows interactive view)
- **Mind map data extraction** - Export hierarchical JSON for visualization tools
- **Data table CSV export** - Download structured tables as spreadsheets
- **Slide deck as PPTX** - Download editable PowerPoint files (web UI only offers PDF)
- **Slide revision** - Modify individual slides with natural-language prompts
- **Report template customization** - Append extra instructions to built-in format templates
- **Save chat to notes** - Save Q&A answers or conversation history as notebook notes
- **Source fulltext access** - Retrieve the indexed text content of any source
- **Programmatic sharing** - Manage permissions without the UI

## Installation

```bash
# Basic installation
pip install notebooklm-py

# With browser login support (required for first-time setup)
pip install "notebooklm-py[browser]"
playwright install chromium
```

If `playwright install chromium` fails with `TypeError: onExit is not a function`, see the Linux workaround in [Troubleshooting](docs/troubleshooting.md#linux).

### Development Installation

For contributors or testing unreleased features:

```bash
pip install git+https://github.com/teng-lin/notebooklm-py@main
```

⚠️ The main branch may contain unstable changes. Use PyPI releases for production.

## Quick Start

<p align="center">
  <a href="https://asciinema.org/a/767284" target="_blank"><img src="https://asciinema.org/a/767284.svg" width="600" /></a>
  <br>
  <em>16-minute session compressed to 30 seconds</em>
</p>

### CLI

```bash
# 1. Authenticate (opens browser)
notebooklm login
# Or use Microsoft Edge (for orgs that require Edge for SSO)
# notebooklm login --browser msedge

# 2. Create a notebook and add sources
notebooklm create "My Research"
notebooklm use <notebook_id>
notebooklm source add "https://en.wikipedia.org/wiki/Artificial_intelligence"
notebooklm source add "./paper.pdf"

# 3. Chat with your sources
notebooklm ask "What are the key themes?"

# 4. Generate content
notebooklm generate audio "make it engaging" --wait
notebooklm generate video --style whiteboard --wait
notebooklm generate cinematic-video "documentary-style summary" --wait
notebooklm generate quiz --difficulty hard
notebooklm generate flashcards --quantity more
notebooklm generate slide-deck
notebooklm generate infographic --orientation portrait
notebooklm generate mind-map
notebooklm generate data-table "compare key concepts"

# 5. Download artifacts
notebooklm download audio ./podcast.mp3
notebooklm download video ./overview.mp4
notebooklm download cinematic-video ./documentary.mp4
notebooklm download quiz --format markdown ./quiz.md
notebooklm download flashcards --format json ./cards.json
notebooklm download slide-deck ./slides.pdf
notebooklm download infographic ./infographic.png
notebooklm download mind-map ./mindmap.json
notebooklm download data-table ./data.csv
```

Other useful CLI commands:

```bash
notebooklm auth check --test         # Diagnose auth/cookie issues
notebooklm agent show codex          # Print bundled Codex instructions
notebooklm agent show claude         # Print bundled Claude Code skill template
notebooklm language list             # List supported output languages
notebooklm metadata --json           # Export notebook metadata and sources
notebooklm share status              # Inspect sharing state
notebooklm source add-research "AI"  # Start web research and import sources
notebooklm skill status              # Check local agent skill installation
```

### Python API

```python
import asyncio
from notebooklm import NotebookLMClient

async def main():
    async with await NotebookLMClient.from_storage() as client:
        # Create notebook and add sources
        nb = await client.notebooks.create("Research")
        await client.sources.add_url(nb.id, "https://example.com", wait=True)

        # Chat with your sources
        result = await client.chat.ask(nb.id, "Summarize this")
        print(result.answer)

        # Generate content (podcast, video, quiz, etc.)
        status = await client.artifacts.generate_audio(nb.id, instructions="make it fun")
        await client.artifacts.wait_for_completion(nb.id, status.task_id)
        await client.artifacts.download_audio(nb.id, "podcast.mp3")

        # Generate quiz and download as JSON
        status = await client.artifacts.generate_quiz(nb.id)
        await client.artifacts.wait_for_completion(nb.id, status.task_id)
        await client.artifacts.download_quiz(nb.id, "quiz.json", output_format="json")

        # Generate mind map and export
        result = await client.artifacts.generate_mind_map(nb.id)
        await client.artifacts.download_mind_map(nb.id, "mindmap.json")

asyncio.run(main())
```

### Agent Setup

**Option 1 — CLI install**:

```bash
notebooklm skill install
```

Installs the skill into `~/.claude/skills/notebooklm` and `~/.agents/skills/notebooklm`.

**Option 2 — `npx` install** (via the open skills ecosystem):

```bash
npx skills add teng-lin/notebooklm-py
```

Fetches the canonical [SKILL.md](SKILL.md) directly from GitHub.


## Research Portal

A web GUI on top of this library — a NotebookLM-style notebook manager plus a personal research library, backed by Supabase (Postgres) and Cloudflare R2.

### Features

**Visual design**
- Warm-paper / archival aesthetic — Cormorant Garamond for display, Source Serif 4 for body, JetBrains Mono for metadata
- Shared **Masthead** with a NotebookLM / My Research section switch and a global **Output language** toggle (English / 中文) that's threaded into every chat and generate call
- Two tabs share one shell via the `(corpus)` route group

**Notebook landing page** (`/notebooklm` → "My Corpus")
- Paper-card grid (`CorpusCard`) with deterministic accent swatches, cover emojis, source counts, search, and sort by recent / alphabetical / most sources
- Create, edit (title + emoji), hide, restore, and delete notebooks — all synced to NotebookLM
- Hide-from-list flag preserves saved artifacts and R2 files; delete cleans them up

**Notebook detail page**
- **Collapsible split-pane**: content + Marginalia (chat) — either side folds to a vertical rail; chat grows to fill the freed space when the content panel is collapsed
- AI-generated Synopsis + clickable suggested topics that auto-send into the chat
- Generate any NotebookLM studio type (audio, video, report, quiz, flashcards, infographic, slide deck, data table, mind map) and watch progress live
- Inline viewers — every one is portal-rendered with a frosted backdrop and has a **maximize / restore** toggle to fill the viewport:
  - **Markdown** reports
  - **CSV** data tables (paper headers + alternating rows)
  - **Mind maps** (horizontal collapsible tree, ink + terracotta nodes)
  - **Flashcards** — interactive study mode with flip / prev / next / ✓ / ✗ counters and keyboard navigation
- Per-artifact **Save to portal** (preserves the file in R2 + Supabase even if you delete it in NotebookLM) and **Delete from portal**

**Sources panel**
- Add by URL / pasted text / file upload
- "Discover sources" — fast or deep web research that returns a list of sources to import with one click

**Library notebooks** (`/library` → "My Research")
- Folio-card grid (`FolioCard`) with five paper-cover variants (stitch / manila / index / pinned / photo), each chosen deterministically per folio id
- Create named notebooks (e.g. "Research for AI Development"), each with cover emoji, editable description, and per-notebook chat
- **Generate description with AI** — drafts a 2–3 sentence summary from the folio's title + file list (no file-content access), language-aware, fills the textarea so you can edit before saving
- Upload files — auto-categorised as **Slides / Notes / Reports / Spreadsheets / Audio / Video / Mindmap / Images** by extension, overridable on upload
- Inline viewers, all maximize/restore-able:
  - **Markdown** / `.txt`
  - **DOCX** — client-side via `docx-preview` (preserves table content and numbers that the previous `mammoth` server-side conversion was dropping)
  - **Excel / CSV / ODS** — multi-sheet workbook viewer via SheetJS, with paper-styled tabs per sheet
  - JSON **mind maps**, images, audio, video
- Per-notebook chat powered by an Anthropic-compatible API (defaults to Xiaomi's MiMo proxy — model configurable via `ANTHROPIC_MODEL`); history persists across reloads
  - **File contents are injected as primary context** — extracted text from `.pdf` (pypdf), `.docx` (mammoth), `.xlsx`/`.xls`/`.xlsm` (openpyxl), `.md`/`.txt`/`.csv`/`.json` (raw), `.html` (regex-stripped) is shipped in the system prompt so the model answers from actual file data, not just titles. Audio/video/image files show up as placeholders. Per-file cap 30 k chars, total cap 200 k chars to stay within context window.
  - **Save chat as note** button: dumps the conversation to a Markdown file in the folio's Notes, then clears server + client history so the next turn starts fresh
  - Chat column is viewport-bounded (`calc(100dvh - 7rem)`) — messages scroll inside the panel instead of growing the page
- System prompt is language-aware, instructs the model to cite the source filename inline, and falls back to general knowledge only when the files don't cover the question
- Reasoning (`<think>…</think>` and Anthropic-style thinking blocks) is stripped server-side before the answer reaches the UI; `ANTHROPIC_MAX_TOKENS` defaults to **8192** so reasoning preambles don't truncate the actual answer

### Prerequisites

- Supabase project + Cloudflare R2 bucket (see [portal setup guide](docs/portal-infrastructure-setup.md))
- `portal/.env` filled in from `portal/.env.example`
- NotebookLM authentication (step 1 below)

### 1 — Log in to NotebookLM

```bash
uv pip install -e ".[all]"
playwright install chromium

# Authenticate (opens a browser window)
notebooklm login

# Verify
notebooklm list
```

### 2 — Run it (development)

Two helper scripts run from the repo root:

```bash
./portal/start-backend.sh    # FastAPI on :8000  (uvicorn --reload, watching portal/backend)
./portal/start-frontend.sh   # Next.js dev on :3000
```

API docs at **http://localhost:8000/docs**, portal at **http://localhost:3000**.

Click **Sync notebooks** to pull your existing NotebookLM notebooks into the portal. Use the **Library** page to create notebooks, upload files into them, and chat with their contents.

### 3 — Run it always-on (production)

For a persistent deployment (survives SSH disconnects and reboots), the portal runs as two
systemd services instead of the dev scripts. Reference unit files and a runbook live in
[`portal/deploy/`](portal/deploy/README.md).

```bash
# one-time install
sudo cp portal/deploy/research-portal-backend.service  /etc/systemd/system/
sudo cp portal/deploy/research-portal-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now research-portal-backend.service
sudo systemctl enable --now research-portal-frontend.service
```

- **Backend** — `uvicorn` (no `--reload`) bound to `127.0.0.1:8000`
- **Frontend** — Next.js **production build** (`next start`) bound to `0.0.0.0:3000`; the
  `/api/*` rewrite proxies to the backend, so the backend is never bound to a public interface

Access it over a private network (e.g. Tailscale) at `http://<host>:3000`, or keep using an
SSH port-forward to `localhost:3000`. Don't open port 3000 on your cloud provider's firewall —
the private network plus that firewall are the single-user security boundary.

**After pulling new code**, the dev hot-reload no longer applies — you must rebuild/restart:

```bash
# backend changes — just restart
sudo systemctl restart research-portal-backend.service

# frontend changes — rebuild first (production builds are not hot-reloaded)
cd portal/frontend && npm run build
sudo systemctl restart research-portal-frontend.service
```

See [`portal/deploy/README.md`](portal/deploy/README.md) for status/log commands and the full runbook.

---

## Documentation

- **[CLI Reference](docs/cli-reference.md)** - Complete command documentation
- **[Python API](docs/python-api.md)** - Full API reference
- **[Configuration](docs/configuration.md)** - Storage and settings
- **[Release Guide](docs/releasing.md)** - Release checklist and packaging verification
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions
- **[API Stability](docs/stability.md)** - Versioning policy and stability guarantees

### For Contributors

- **[Development Guide](docs/development.md)** - Architecture, testing, and releasing
- **[RPC Development](docs/rpc-development.md)** - Protocol capture and debugging
- **[RPC Reference](docs/rpc-reference.md)** - Payload structures
- **[Changelog](CHANGELOG.md)** - Version history and release notes
- **[Security](SECURITY.md)** - Security policy and credential handling

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | ✅ Tested | Primary development platform |
| **Linux** | ✅ Tested | Fully supported |
| **Windows** | ✅ Tested | Tested in CI |

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=teng-lin/notebooklm-py&type=timeline&legend=top-left)](https://www.star-history.com/?repos=teng-lin%2Fnotebooklm-py&type=timeline&legend=top-left)

## License

MIT License. See [LICENSE](LICENSE) for details.
