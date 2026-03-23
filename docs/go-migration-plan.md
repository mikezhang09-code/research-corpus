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

---

## Section 2: Go Tool Selection

### CLI Framework: **Cobra** (recommended)

| Framework | Stars | Subcommands | Completions | Used By |
|-----------|-------|-------------|-------------|---------|
| **cobra** | 39k+ | Native groups | bash/zsh/fish/ps | kubectl, gh, docker, hugo |
| urfave/cli | 22k+ | Flat or nested | bash/zsh | - |
| kong | 2k+ | Struct tags | Limited | - |

**Why Cobra wins for this project:**
- ~60 commands with 9 groups maps perfectly to Cobra's command tree
- `gh` CLI (GitHub) uses Cobra — same pattern we need (verb-noun groups)
- Built-in `--help`, shell completions, man page generation
- Custom help templates (replaces Python's `SectionedGroup`)
- Persistent flags (like `--notebook`, `--json`) propagate to subcommands
- Ecosystem: `cobra-cli` scaffolding tool speeds up development

```go
// Example: mirrors Python's Click group structure
rootCmd.AddCommand(sourceCmd)       // notebooklm source ...
sourceCmd.AddCommand(sourceAddCmd)  // notebooklm source add ...
sourceCmd.AddCommand(sourceListCmd) // notebooklm source list
```

### Terminal UI: **lipgloss** + **tablewriter**

| Need | Python (rich) | Go Library |
|------|---------------|------------|
| Colored text | `rich.print` | `lipgloss` (charmbracelet) |
| Tables | `rich.table` | `tablewriter` |
| Spinners | `rich.spinner` | `yacspin` or `spinner` |
| Progress bars | `rich.progress` | `mpb` |
| JSON output | `json.dumps` | `encoding/json` (stdlib) |

**lipgloss** (charmbracelet) is the standard for Go CLI styling — used by `gh`, `charm`, `gum`.

### HTTP Client: **net/http** (stdlib)

No external dependency needed. Go's stdlib HTTP client handles:
- Cookie jars (`net/http/cookiejar`)
- Custom headers
- Timeouts (`http.Client.Timeout`)
- Form-encoded POST bodies (`url.Values`)
- File uploads (`multipart/Writer`)

Python's async (httpx + asyncio) maps to Go's goroutines naturally — no async/await complexity.

### Browser Auth: **chromedp** (user-selected)

```
chromedp vs rod comparison:
┌──────────────┬──────────────────────────┬─────────────────────────┐
│              │ chromedp                 │ rod                     │
├──────────────┼──────────────────────────┼─────────────────────────┤
│ Protocol     │ Chrome DevTools Protocol │ Chrome DevTools Protocol│
│ Dependencies │ None (uses system Chrome)│ Auto-downloads Chromium │
│ Stars        │ 11k+                     │ 5k+                    │
│ Cookie API   │ network.GetAllCookies    │ browser.GetCookies     │
│ Maturity     │ Very mature              │ Newer                  │
│ Binary size  │ No impact (system Chrome)│ No impact              │
└──────────────┴──────────────────────────┴─────────────────────────┘
```

**chromedp implementation plan:**
1. Launch Chrome with user data dir (like Playwright's persistent context)
2. Navigate to `notebooklm.google.com`
3. Wait for user to complete Google login
4. Extract cookies via `network.GetAllCookies`
5. Save to `~/.notebooklm/storage_state.json` (same format as Python)
6. Extract CSRF token (`SNlM0e`) and session ID (`FdrFJe`) from page HTML

### Testing: **stdlib + go-vcr**

| Need | Go Solution |
|------|-------------|
| Unit tests | `testing` (stdlib) — table-driven tests |
| HTTP mocking | `net/http/httptest` (stdlib) |
| HTTP record/replay | `go-vcr/v4` (equivalent to vcrpy) |
| Assertions | `testify/assert` or `is` |
| Test coverage | `go test -cover` (built-in) |
| Linting | `golangci-lint` (aggregates 50+ linters) |
| Formatting | `gofmt` / `goimports` (built-in) |

### JSON Handling: **encoding/json** + **gjson**

- `encoding/json` for struct marshaling (API responses → Go structs)
- `gjson` for navigating deeply nested RPC responses without full struct mapping
  - Critical for batchexecute responses which are arbitrary nested arrays
  - Example: `gjson.Get(resp, "0.2.0.1")` to extract notebook ID from nested list

### Summary: Go Module Dependencies

```
go.mod dependencies (minimal):
  github.com/spf13/cobra          # CLI framework
  github.com/charmbracelet/lipgloss # Terminal styling
  github.com/olekukonko/tablewriter # Tables
  github.com/chromedp/chromedp     # Browser auth
  github.com/tidwall/gjson         # JSON navigation
  github.com/stretchr/testify      # Test assertions (dev)
  gopkg.in/dnaeon/go-vcr.v4       # HTTP recording (dev)
```
