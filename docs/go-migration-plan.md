# notebooklm-go: Python to Go Migration Plan

> Migrate `notebooklm-py` (Python CLI) → `notebooklm-go` (Go CLI) as a **separate standalone project**.

---

## Section 1: Project Audit Summary

### What exists today in Python

| Category | Count | Details |
|----------|-------|---------|
| **CLI Commands** | ~60 | 10 top-level + 9 command groups |
| **API Namespaces** | 8 | notebooks, sources, artifacts, chat, research, notes, sharing, settings |
| **RPC Methods** | 34 | Obfuscated method IDs in `rpc/types.py` |
| **Data Models** | 18 | Dataclasses: Notebook, Source, Artifact, Note, etc. |
| **Enums** | 25+ | AudioFormat, VideoStyle, SourceType, ArtifactType, etc. |
| **Exceptions** | 20 | Hierarchical: RPCError → AuthError, RateLimitError, etc. |
| **Test Files** | 47 | 16 unit + 16 integration + 15 e2e |
| **Source Files** | 20 | Core library files |
| **CLI Files** | 17 | Click command modules |

### Python Dependencies → Go Equivalents

| Python Dep | Purpose | Go Equivalent |
|------------|---------|---------------|
| `httpx` | Async HTTP client | `net/http` (stdlib) |
| `click` | CLI framework | `cobra` |
| `rich` | Terminal tables/spinners/colors | `lipgloss` + `tablewriter` |
| `playwright` | Browser auth (cookie capture) | `chromedp` |
| `pytest` | Testing | `testing` (stdlib) |
| `pytest-httpx` | HTTP mocking | `net/http/httptest` (stdlib) |
| `vcrpy` | HTTP record/replay | `go-vcr` or `httpreplay` |
| `mypy` | Type checking | Go compiler (built-in) |
| `ruff` | Linting/formatting | `golangci-lint` + `gofmt` |

### Key Architecture Layers to Port

```
Python Layer              →  Go Package
─────────────────────────────────────────
rpc/types.py              →  pkg/rpc/types.go      (method IDs, enums)
rpc/encoder.py            →  pkg/rpc/encoder.go    (request encoding)
rpc/decoder.py            →  pkg/rpc/decoder.go    (response parsing)
_core.py                  →  pkg/core/client.go    (HTTP + RPC calls)
auth.py                   →  pkg/auth/auth.go      (cookies, CSRF)
types.py                  →  pkg/types/types.go    (structs)
exceptions.py             →  pkg/errors/errors.go  (error types)
client.py + _*.py APIs    →  pkg/api/*.go          (notebook, source, etc.)
cli/*.py                  →  cmd/notebooklm/*.go   (cobra commands)
```

### Feature Inventory (all must be ported)

**Session**: login, use, status, clear, auth-check
**Notebooks**: list, create, delete, rename, summary, metadata
**Sources**: list, add (url/text/file/youtube/drive), get, delete, delete-by-title, rename, refresh, fulltext, guide, stale, wait, add-research
**Artifacts**: list, get, rename, delete, export, poll, wait, suggestions
**Generate**: audio, video, cinematic-video, slide-deck, quiz, flashcards, infographic, data-table, mind-map, report
**Download**: audio, video, report, mind-map, infographic, slide-deck, data-table, quiz, flashcards
**Chat**: ask (with follow-ups, source filtering, citations), configure, history
**Notes**: list, create, get, save, rename, delete
**Sharing**: status, public, view-level, add, update, remove
**Research**: status, wait, add-research (with import)
**Language**: list, get, set
