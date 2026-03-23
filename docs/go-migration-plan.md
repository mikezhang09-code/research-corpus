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

---

## Section 3: Go Project Structure

### Repository Layout

```
notebooklm-go/
├── cmd/
│   └── notebooklm/
│       └── main.go                 # Entry point
├── internal/
│   ├── cli/                        # Cobra command definitions
│   │   ├── root.go                 # Root command + global flags
│   │   ├── session.go              # login, use, status, clear
│   │   ├── notebook.go             # list, create, delete, rename, summary
│   │   ├── source.go               # source add, list, delete, rename, ...
│   │   ├── artifact.go             # artifact list, get, delete, export, ...
│   │   ├── generate.go             # generate audio, video, quiz, ...
│   │   ├── download.go             # download audio, video, report, ...
│   │   ├── chat.go                 # ask, configure, history
│   │   ├── note.go                 # note create, list, get, save, ...
│   │   ├── share.go                # share status, public, add, remove, ...
│   │   ├── research.go             # research status, wait
│   │   ├── language.go             # language list, get, set
│   │   ├── helpers.go              # Shared: resolve IDs, output formatting
│   │   └── options.go              # Reusable flag definitions
│   ├── rpc/                        # RPC protocol layer
│   │   ├── types.go                # Method IDs, enums, constants
│   │   ├── encoder.go              # Request encoding (batchexecute format)
│   │   ├── encoder_test.go
│   │   ├── decoder.go              # Response parsing (anti-XSSI, chunked)
│   │   └── decoder_test.go
│   ├── core/                       # HTTP client + RPC abstraction
│   │   ├── client.go               # HTTP client, RPC call, auth refresh
│   │   └── client_test.go
│   ├── auth/                       # Authentication
│   │   ├── auth.go                 # Cookie loading, CSRF extraction
│   │   ├── browser.go              # chromedp browser login flow
│   │   ├── storage.go              # Read/write storage_state.json
│   │   └── auth_test.go
│   ├── api/                        # Domain API layer (like Python _*.py)
│   │   ├── notebooks.go            # NotebooksAPI
│   │   ├── sources.go              # SourcesAPI
│   │   ├── artifacts.go            # ArtifactsAPI
│   │   ├── chat.go                 # ChatAPI
│   │   ├── research.go             # ResearchAPI
│   │   ├── notes.go                # NotesAPI
│   │   ├── sharing.go              # SharingAPI
│   │   ├── settings.go             # SettingsAPI
│   │   └── *_test.go               # One test file per API
│   ├── config/                     # Configuration management
│   │   ├── paths.go                # ~/.notebooklm/ paths, env vars
│   │   └── context.go              # Notebook/conversation context persistence
│   └── output/                     # Terminal output helpers
│       ├── table.go                # Table rendering
│       ├── json.go                 # JSON output mode
│       └── spinner.go              # Progress spinners
├── pkg/
│   └── client/                     # Public SDK (for Go library consumers)
│       ├── client.go               # NotebookLMClient (public API)
│       └── client_test.go
├── testdata/                       # Test fixtures
│   ├── cassettes/                  # VCR recordings (go-vcr)
│   ├── fixtures/                   # Static RPC response fixtures
│   └── golden/                     # Golden file outputs
├── .github/
│   └── workflows/
│       ├── test.yml                # CI: lint + test + coverage
│       ├── release.yml             # GoReleaser on tag push
│       └── upstream-check.yml      # Track Python project releases
├── .goreleaser.yml                 # Multi-platform build config
├── go.mod
├── go.sum
├── Makefile                        # dev commands: test, lint, build
└── README.md
```

### Package Responsibilities

| Package | Visibility | Purpose |
|---------|-----------|---------|
| `cmd/notebooklm` | binary | Entry point only — calls `internal/cli` |
| `internal/cli` | internal | All Cobra commands, flags, output |
| `internal/rpc` | internal | Encode/decode batchexecute protocol |
| `internal/core` | internal | HTTP client, RPC call abstraction |
| `internal/auth` | internal | Cookie/token management, browser login |
| `internal/api` | internal | Domain APIs (notebooks, sources, etc.) |
| `internal/config` | internal | Paths, context, user settings |
| `internal/output` | internal | Tables, JSON, spinners |
| `pkg/client` | **public** | Reusable Go SDK for library consumers |

### Why `internal/` + `pkg/`

- `internal/` = implementation details, free to refactor without breaking consumers
- `pkg/client/` = stable public Go API for anyone importing `notebooklm-go` as a library
- Same pattern as `gh` CLI, `kubectl`, `docker`

### Key Design Decisions

**1. No async/await — use goroutines naturally**
```go
// Python: await client.sources.wait_for_sources(nb_id, source_ids)
// Go: use goroutines + errgroup
g, ctx := errgroup.WithContext(ctx)
for _, id := range sourceIDs {
    g.Go(func() error {
        return client.Sources.WaitUntilReady(ctx, nbID, id)
    })
}
err := g.Wait()
```

**2. Context propagation for cancellation/timeouts**
```go
// Every API method takes context.Context as first arg
func (s *SourcesAPI) Add(ctx context.Context, nbID, url string) (*Source, error)
```

**3. Functional options for generation parameters**
```go
// Clean API for optional parameters
status, err := client.Artifacts.GenerateAudio(ctx, nbID,
    WithAudioFormat(AudioFormatDeepDive),
    WithAudioLength(AudioLengthLong),
)
```

**4. Error types use Go idioms**
```go
// Sentinel errors + custom types
var ErrAuth = errors.New("authentication failed")
var ErrRateLimit = errors.New("rate limited")

type RPCError struct {
    MethodID string
    Code     int
    Message  string
}

// Usage: errors.Is(err, ErrRateLimit)
```

---

## Section 4: Migration Phases

### Overview: Bottom-Up, Test-First

Migrate from the **innermost layer outward**. Each phase is independently testable and shippable.

```
Phase 1: Foundation     (types, errors, config)        ~2 days
Phase 2: RPC Layer      (encoder, decoder)              ~3 days
Phase 3: Auth           (cookies, CSRF, browser login)  ~3 days
Phase 4: Core Client    (HTTP, RPC calls, retry)        ~2 days
Phase 5: Domain APIs    (notebooks, sources, etc.)      ~5 days
Phase 6: CLI Commands   (cobra commands, output)        ~5 days
Phase 7: Distribution   (goreleaser, npm, brew)         ~2 days
Phase 8: CI/CD + Parity (upstream tracking, tests)      ~2 days
                                                   Total: ~24 days
```

---

### Phase 1: Foundation (types, errors, config)

**Goal**: Define all data structures, error types, and config paths.

**Files to create:**
```
internal/rpc/types.go       # RPCMethod enum, ArtifactTypeCode, SourceStatus, all format enums
internal/config/paths.go    # ~/.notebooklm/ paths, NOTEBOOKLM_HOME env var
internal/config/context.go  # context.json read/write
internal/output/json.go     # JSON output helpers
```

**Port from Python:**
| Python File | Go File | What to port |
|-------------|---------|-------------|
| `rpc/types.py` | `internal/rpc/types.go` | All 34 RPCMethod IDs, 25+ enums, constants |
| `types.py` | `internal/api/types.go` | All 18 structs (Notebook, Source, Artifact, etc.) |
| `exceptions.py` | `internal/errors/errors.go` | All 20 error types |
| `paths.py` | `internal/config/paths.go` | Path resolution, env vars |

**Key mapping: Python enums → Go constants**
```go
// Python: class RPCMethod(str, Enum): LIST_NOTEBOOKS = "wXbhsf"
// Go:
type RPCMethod string
const (
    RPCListNotebooks  RPCMethod = "wXbhsf"
    RPCCreateNotebook RPCMethod = "CCqFvf"
    RPCDeleteNotebook RPCMethod = "WWINqb"
    // ... all 34 methods
)
```

**Key mapping: Python dataclasses → Go structs**
```go
// Python: @dataclass class Notebook: id, title, created_at, sources_count, is_owner
// Go:
type Notebook struct {
    ID           string     `json:"id"`
    Title        string     `json:"title"`
    CreatedAt    *time.Time `json:"created_at,omitempty"`
    SourcesCount int        `json:"sources_count"`
    IsOwner      bool       `json:"is_owner"`
}

func NotebookFromAPI(data []any) (*Notebook, error) { ... }
```

**Tests**: Unit tests for all struct parsing, enum string conversion, path resolution.

**Exit criteria**: `go build ./...` passes, all types compile, 100% unit test coverage on types.

---

### Phase 2: RPC Layer (encoder + decoder)

**Goal**: Encode/decode Google's batchexecute protocol identically to Python.

**Files to create:**
```
internal/rpc/encoder.go       # EncodeRPCRequest, BuildRequestBody, BuildURLParams
internal/rpc/encoder_test.go  # Table-driven tests with Python parity fixtures
internal/rpc/decoder.go       # StripAntiXSSI, ParseChunkedResponse, DecodeResponse
internal/rpc/decoder_test.go  # Golden file tests against real API responses
```

**Port from Python:**
| Python Function | Go Function | Critical Details |
|----------------|-------------|-----------------|
| `encode_rpc_request()` | `EncodeRPCRequest()` | Triple-nested: `[[[id, json, null, "generic"]]]` |
| `build_request_body()` | `BuildRequestBody()` | Form-encode: `f.req=...&at=csrf` |
| `build_url_params()` | `BuildURLParams()` | `rpcids`, `source-path`, `f.sid`, `rt=c` |
| `strip_anti_xssi()` | `StripAntiXSSI()` | Remove `)]}'\n` prefix |
| `parse_chunked_response()` | `ParseChunkedResponse()` | Alternating byte_count/json lines |
| `decode_response()` | `DecodeResponse()` | Full pipeline: strip → parse → extract |

**Critical: JSON encoding must match Python exactly**
```go
// Python produces: [[[\"wXbhsf\",\"[]\",null,\"generic\"]]]
// Go must produce identical output — test with fixtures from Python
```

**Testing strategy:**
1. Capture real encoded requests from Python (`rpc/encoder.py`)
2. Store as golden files in `testdata/fixtures/`
3. Go encoder must produce byte-identical output
4. Same for decoder: store real API responses, verify Go decodes identically

**Exit criteria**: Encoder/decoder produce identical output to Python for all 34 RPC methods.

---

### Phase 3: Authentication

**Goal**: Load cookies, extract CSRF/session tokens, browser login with chromedp.

**Files to create:**
```
internal/auth/auth.go        # AuthTokens struct, LoadFromStorage, FetchTokens
internal/auth/storage.go     # Read/write storage_state.json, cookie extraction
internal/auth/browser.go     # chromedp login flow
internal/auth/domains.go     # Regional Google domain whitelist (70+ domains)
internal/auth/auth_test.go   # Mock HTML token extraction
```

**Port from Python:**
| Python Function | Go Function |
|----------------|-------------|
| `AuthTokens.from_storage()` | `LoadAuthTokens(path)` |
| `load_auth_from_storage()` | `LoadCookiesFromFile(path)` |
| `extract_cookies_from_storage()` | `ExtractCookies(storageState)` |
| `fetch_tokens()` | `FetchTokens(cookies)` |
| `extract_csrf_from_html()` | `ExtractCSRF(html)` |
| `extract_session_id_from_html()` | `ExtractSessionID(html)` |
| `_is_google_domain()` | `IsGoogleDomain(domain)` |

**chromedp browser login (replaces Playwright):**
```go
func BrowserLogin(ctx context.Context, storagePath string) error {
    // 1. Create chromedp context with user data dir
    opts := append(chromedp.DefaultExecAllocatorOptions[:],
        chromedp.UserDataDir(browserProfileDir),
        chromedp.Flag("disable-blink-features", "AutomationControlled"),
    )
    // 2. Navigate to notebooklm.google.com
    // 3. Wait for user to login (poll for SID cookie)
    // 4. Extract all cookies via network.GetAllCookies
    // 5. Save to storage_state.json
}
```

**Exit criteria**: Can login via browser, save cookies, load cookies, extract CSRF token.

---

### Phase 4: Core HTTP Client

**Goal**: HTTP client with RPC call abstraction, auth refresh, retry logic.

**Files to create:**
```
internal/core/client.go       # CoreClient: HTTP client, RPCCall(), auth refresh
internal/core/client_test.go  # httptest mock server tests
```

**Port from Python `_core.py`:**
| Python | Go |
|--------|-----|
| `ClientCore.__init__()` | `NewCoreClient(auth, opts...)` |
| `ClientCore.rpc_call()` | `(c *CoreClient) RPCCall(ctx, method, params)` |
| `ClientCore.open()` | Constructor (Go HTTP clients don't need explicit open) |
| `ClientCore.close()` | `(c *CoreClient) Close()` |
| `_build_url()` | `(c *CoreClient) buildURL(method, sourcePath)` |
| Auth error detection | Middleware/retry with `ErrAuth` detection |
| Request counter (`_reqid_counter`) | Atomic counter for chat API |
| Conversation cache | `sync.Map` or `lru` cache |

**Key difference from Python**: No async. Use `http.Client` directly.

```go
type CoreClient struct {
    httpClient      *http.Client
    auth            *AuthTokens
    reqIDCounter    atomic.Int64
    conversationLRU *lru.Cache
    refreshMu       sync.Mutex  // prevents concurrent auth refresh
}

func (c *CoreClient) RPCCall(ctx context.Context, method RPCMethod, params []any) (any, error) {
    body := rpc.BuildRequestBody(rpc.EncodeRPCRequest(method, params), c.auth.CSRFToken, c.auth.SessionID)
    req, _ := http.NewRequestWithContext(ctx, "POST", rpc.BatchExecuteURL, strings.NewReader(body))
    // ... set headers, cookies, execute, decode
    // Auto-retry on auth error (refresh CSRF token)
}
```

**Exit criteria**: Can make RPC calls, handle auth refresh, request counting works.

---

### Phase 5: Domain APIs (8 namespaces)

**Goal**: Port all 8 API namespaces with full method parity.

**Order** (by dependency — simplest first):

| Order | API | Methods | Depends On |
|-------|-----|---------|-----------|
| 5a | Settings | 2 | core only |
| 5b | Notebooks | 10 | core only |
| 5c | Notes | 6 | notebooks |
| 5d | Sources | 16 | notebooks |
| 5e | Artifacts | 22 | notebooks, sources |
| 5f | Chat | 4 | notebooks, sources |
| 5g | Research | 3 | notebooks, sources |
| 5h | Sharing | 6 | notebooks |

**For each API namespace:**
1. Create `internal/api/<name>.go` with all methods
2. Create `internal/api/<name>_test.go` with table-driven tests
3. Use `httptest` server that returns fixture responses
4. Verify struct parsing matches Python behavior

**Example: NotebooksAPI**
```go
type NotebooksAPI struct {
    core *CoreClient
}

func (n *NotebooksAPI) List(ctx context.Context) ([]*Notebook, error) {
    result, err := n.core.RPCCall(ctx, RPCListNotebooks, []any{})
    if err != nil { return nil, err }
    // Parse nested response into Notebook structs
}

func (n *NotebooksAPI) Create(ctx context.Context, title string) (*Notebook, error) { ... }
func (n *NotebooksAPI) Delete(ctx context.Context, id string) error { ... }
func (n *NotebooksAPI) Rename(ctx context.Context, id, title string) (*Notebook, error) { ... }
// ... all 10 methods
```

**Exit criteria**: All 69 API methods ported, all unit tests passing.

---

### Phase 6: CLI Commands

**Goal**: Port all ~60 CLI commands with identical UX.

**Order** (mirrors user workflow):

| Order | Commands | File |
|-------|----------|------|
| 6a | login, use, status, clear | `cli/session.go` |
| 6b | list, create, delete, rename | `cli/notebook.go` |
| 6c | source add/list/delete/... | `cli/source.go` |
| 6d | ask, configure, history | `cli/chat.go` |
| 6e | generate audio/video/... | `cli/generate.go` |
| 6f | download audio/video/... | `cli/download.go` |
| 6g | artifact list/get/delete/... | `cli/artifact.go` |
| 6h | note create/list/get/... | `cli/note.go` |
| 6i | share status/add/remove/... | `cli/share.go` |
| 6j | research status/wait | `cli/research.go` |
| 6k | language list/get/set | `cli/language.go` |

**Reusable patterns (mirrors Python's `helpers.py` and `options.py`):**
```go
// Persistent flags (like Python's @notebook_option decorator)
func addNotebookFlag(cmd *cobra.Command) {
    cmd.PersistentFlags().StringP("notebook", "n", "", "Notebook ID (uses context if omitted)")
}

// Shared helper (like Python's require_notebook)
func requireNotebook(cmd *cobra.Command) (string, error) {
    nb, _ := cmd.Flags().GetString("notebook")
    if nb != "" { return nb, nil }
    return config.GetCurrentNotebook()
}

// JSON output mode (like Python's @json_option)
func addJSONFlag(cmd *cobra.Command) {
    cmd.PersistentFlags().Bool("json", false, "Output as JSON")
}
```

**Exit criteria**: All commands work, `--help` matches Python, `--json` works everywhere.

---

### Phase 7: Distribution (see Section 6 for details)

**Goal**: Ship binaries via GoReleaser, npm, brew.

---

### Phase 8: CI/CD + Upstream Tracking (see Section 7 for details)

**Goal**: CI pipeline, coverage gates, upstream release monitoring.

---

## Section 5: Test Plan for 100% Feature Parity

### Testing Strategy Overview

```
┌─────────────────────────────────────────────────────┐
│  Level 1: Unit Tests (fast, no network)             │
│  - Table-driven tests for all functions             │
│  - Golden files for encoder/decoder                 │
│  - Struct parsing from API response fixtures        │
│  Coverage target: 90%+                              │
├─────────────────────────────────────────────────────┤
│  Level 2: Integration Tests (mock HTTP)             │
│  - httptest server with fixture responses           │
│  - go-vcr recorded cassettes                        │
│  - Full API call → struct parsing pipeline          │
│  Coverage: All 69 API methods                       │
├─────────────────────────────────────────────────────┤
│  Level 3: E2E Tests (real API, requires auth)       │
│  - Real Google NotebookLM API calls                 │
│  - Rate-limit aware (delays between tests)          │
│  - Nightly CI run with auth secrets                 │
│  Coverage: All user workflows                       │
├─────────────────────────────────────────────────────┤
│  Level 4: Parity Tests (Go vs Python comparison)    │
│  - Same input → same output verification            │
│  - CLI output snapshot comparison                   │
│  - RPC encoding byte-identical check                │
│  Coverage: Critical paths                           │
└─────────────────────────────────────────────────────┘
```

### Level 1: Unit Tests

**1a. RPC Encoder Tests** (`internal/rpc/encoder_test.go`)

```go
func TestEncodeRPCRequest(t *testing.T) {
    tests := []struct {
        name     string
        method   RPCMethod
        params   []any
        wantJSON string // golden file path
    }{
        {"list notebooks", RPCListNotebooks, []any{}, "testdata/encode_list_notebooks.json"},
        {"create notebook", RPCCreateNotebook, []any{"My Notebook"}, "testdata/encode_create.json"},
        {"add source url", RPCAddSource, []any{"nb123", "https://example.com"}, "testdata/encode_add_url.json"},
        // ... one entry per RPC method (34 total)
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := EncodeRPCRequest(tt.method, tt.params)
            want := loadGoldenFile(t, tt.wantJSON)
            assert.JSONEq(t, want, got)
        })
    }
}
```

**1b. RPC Decoder Tests** (`internal/rpc/decoder_test.go`)

```go
func TestDecodeResponse(t *testing.T) {
    tests := []struct {
        name       string
        fixture    string // raw API response from testdata/
        rpcID      string
        wantErr    bool
        wantFields map[string]any
    }{
        {"notebook list", "testdata/resp_list_notebooks.txt", "wXbhsf", false, ...},
        {"auth error", "testdata/resp_auth_error.txt", "wXbhsf", true, ...},
        {"rate limited", "testdata/resp_rate_limit.txt", "R7cb6c", true, ...},
        // ... one entry per response type
    }
}

func TestStripAntiXSSI(t *testing.T) {
    input := ")]}'\n[real data]"
    assert.Equal(t, "[real data]", StripAntiXSSI(input))
}

func TestParseChunkedResponse(t *testing.T) {
    // Test with real chunked response from fixture
}
```

**1c. Struct Parsing Tests** (`internal/api/types_test.go`)

```go
func TestNotebookFromAPI(t *testing.T) {
    // Raw nested array from real API response
    raw := []any{"notebook-id-123", "My Notebook", nil, nil, 1234567890, 3, true}
    nb, err := NotebookFromAPI(raw)
    assert.NoError(t, err)
    assert.Equal(t, "notebook-id-123", nb.ID)
    assert.Equal(t, "My Notebook", nb.Title)
    assert.Equal(t, 3, nb.SourcesCount)
    assert.True(t, nb.IsOwner)
}

// Same pattern for: Source, Artifact, Note, ShareStatus, AskResult, etc.
```

**1d. Auth Tests** (`internal/auth/auth_test.go`)

```go
func TestExtractCSRF(t *testing.T) {
    html := `<script>window.WIZ_global_data = {"SNlM0e":"AF1_QpN-abc123"}</script>`
    csrf, err := ExtractCSRF(html)
    assert.Equal(t, "AF1_QpN-abc123", csrf)
}

func TestIsGoogleDomain(t *testing.T) {
    tests := []struct{ domain string; want bool }{
        {".google.com", true},
        {".google.co.uk", true},
        {".google.com.sg", true},
        {".evil.com", false},
    }
}

func TestExtractCookies(t *testing.T) {
    // Load sample storage_state.json, verify cookie extraction
}
```

**1e. Config/Path Tests** (`internal/config/paths_test.go`)

```go
func TestGetHomeDirEnvOverride(t *testing.T) {
    t.Setenv("NOTEBOOKLM_HOME", "/tmp/custom")
    assert.Equal(t, "/tmp/custom", GetHomeDir())
}

func TestContextReadWrite(t *testing.T) {
    dir := t.TempDir()
    SetCurrentNotebook(dir, "nb-123", "Test Notebook")
    id, _ := GetCurrentNotebook(dir)
    assert.Equal(t, "nb-123", id)
}
```

### Level 2: Integration Tests (go-vcr)

**Recording cassettes (one-time, with real auth):**
```bash
NOTEBOOKLM_VCR_RECORD=1 go test ./internal/api/... -run TestIntegration
```

**Replaying (CI, no auth needed):**
```bash
go test ./internal/api/... -run TestIntegration
```

**Test structure:**
```go
func TestIntegration_NotebookList(t *testing.T) {
    recorder := loadCassette(t, "testdata/cassettes/notebook_list")
    defer recorder.Stop()

    client := NewCoreClient(testAuth, WithHTTPClient(recorder.GetDefaultClient()))
    notebooks := NewNotebooksAPI(client)

    result, err := notebooks.List(context.Background())
    assert.NoError(t, err)
    assert.NotEmpty(t, result)
    assert.NotEmpty(t, result[0].ID)
}
```

**Cassettes to record (mirrors Python's `tests/cassettes/`):**
- `notebook_list.yaml`, `notebook_create.yaml`, `notebook_delete.yaml`
- `source_add_url.yaml`, `source_add_text.yaml`, `source_add_file.yaml`
- `artifact_generate_audio.yaml`, `artifact_list.yaml`
- `chat_ask.yaml`, `chat_followup.yaml`
- `research_start.yaml`, `research_poll.yaml`
- `note_create.yaml`, `note_list.yaml`
- `sharing_status.yaml`, `sharing_add_user.yaml`
- `settings_get_language.yaml`

### Level 3: E2E Tests

**Structure** (`tests/e2e/` — separate test binary):
```go
//go:build e2e

func TestE2E_NotebookLifecycle(t *testing.T) {
    client := mustCreateClient(t)

    // Create
    nb, err := client.Notebooks.Create(ctx, "E2E Test Notebook")
    require.NoError(t, err)
    defer client.Notebooks.Delete(ctx, nb.ID) // cleanup

    // Rename
    nb, err = client.Notebooks.Rename(ctx, nb.ID, "Renamed Notebook")
    require.NoError(t, err)
    assert.Equal(t, "Renamed Notebook", nb.Title)

    // List
    all, _ := client.Notebooks.List(ctx)
    found := false
    for _, n := range all { if n.ID == nb.ID { found = true } }
    assert.True(t, found)
}

func TestE2E_SourceAddURL(t *testing.T) {
    // Add URL source, wait for processing, verify ready
}

func TestE2E_ChatAsk(t *testing.T) {
    // Ask question, verify answer, test follow-up
}

func TestE2E_GenerateAudio(t *testing.T) {
    // Generate, poll, download
}
```

**Rate limit handling (mirrors Python's delays):**
```go
const (
    sourceProcessingDelay = 2 * time.Second
    generationTestDelay   = 15 * time.Second
    chatTestDelay         = 5 * time.Second
)

func TestE2E_GenerateAudio(t *testing.T) {
    time.Sleep(generationTestDelay) // between generation tests
    // ...
}
```

**Running E2E:**
```bash
# Requires NOTEBOOKLM_AUTH_JSON secret
go test -tags e2e ./tests/e2e/... -timeout 10m
```

### Level 4: Parity Tests (Go vs Python cross-validation)

**Purpose**: Verify Go produces identical results to Python for critical operations.

**4a. RPC Encoding Parity**
```bash
# Generate golden files from Python
python -c "
from notebooklm.rpc.encoder import encode_rpc_request
from notebooklm.rpc.types import RPCMethod
import json
for method in RPCMethod:
    result = encode_rpc_request(method, [])
    with open(f'testdata/parity/encode_{method.name}.json', 'w') as f:
        json.dump(result, f)
"

# Go tests verify against these golden files
func TestParity_Encoding(t *testing.T) {
    files, _ := filepath.Glob("testdata/parity/encode_*.json")
    for _, f := range files {
        // Compare Go output to Python golden file
    }
}
```

**4b. CLI Output Parity**
```bash
# Capture Python CLI output
notebooklm list --json > testdata/parity/cli_list.json
notebooklm source list --json -n $NB > testdata/parity/cli_source_list.json

# Go CLI must produce identical JSON structure
func TestParity_CLIListJSON(t *testing.T) {
    golden := loadFile(t, "testdata/parity/cli_list.json")
    // ... verify Go JSON output has same keys/structure
}
```

**4c. Response Decoding Parity**
```bash
# Save raw API responses via Python
# Go decoder must extract identical data from same raw response
```

### Feature Parity Checklist

Every feature gets a test at each applicable level:

| Feature | Unit | Integration | E2E | Parity |
|---------|------|-------------|-----|--------|
| **Notebooks** | | | | |
| list | struct parsing | VCR cassette | real API | JSON output |
| create | param encoding | VCR cassette | real API | - |
| delete | param encoding | VCR cassette | real API | - |
| rename | param encoding | VCR cassette | real API | - |
| summary | response parsing | VCR cassette | real API | - |
| metadata | struct + formatting | VCR cassette | real API | JSON output |
| **Sources** | | | | |
| add url | param encoding | VCR cassette | real API | - |
| add text | param encoding | VCR cassette | real API | - |
| add file | multipart encoding | VCR cassette | real API | - |
| add youtube | URL detection | VCR cassette | real API | - |
| list | struct parsing | VCR cassette | real API | JSON output |
| delete | param encoding | VCR cassette | real API | - |
| rename | param encoding | VCR cassette | real API | - |
| refresh | param encoding | VCR cassette | real API | - |
| fulltext | response parsing | VCR cassette | real API | - |
| wait | polling logic | mock server | real API | - |
| **Artifacts** | | | | |
| generate audio | param encoding | VCR cassette | real API | - |
| generate video | param encoding | VCR cassette | real API | - |
| generate quiz | param encoding | VCR cassette | real API | - |
| generate flashcards | param encoding | VCR cassette | real API | - |
| generate infographic | param encoding | VCR cassette | real API | - |
| generate slides | param encoding | VCR cassette | real API | - |
| generate mind-map | param encoding | VCR cassette | real API | - |
| generate data-table | param encoding | VCR cassette | real API | - |
| generate report | param encoding | VCR cassette | real API | - |
| download audio | file writing | VCR cassette | real API | - |
| download video | file writing | VCR cassette | real API | - |
| download infographic | file writing | VCR cassette | real API | - |
| download slides | file writing | VCR cassette | real API | - |
| list | struct parsing | VCR cassette | real API | JSON output |
| wait/poll | polling logic | mock server | real API | - |
| **Chat** | | | | |
| ask | param encoding | VCR cassette | real API | - |
| follow-up | conversation ID | VCR cassette | real API | - |
| source filter | param encoding | VCR cassette | real API | - |
| citations | reference parsing | VCR cassette | real API | - |
| history | response parsing | VCR cassette | real API | - |
| **Notes** | | | | |
| create | param encoding | VCR cassette | real API | - |
| list | struct parsing | VCR cassette | real API | JSON output |
| update | param encoding | VCR cassette | real API | - |
| delete | param encoding | VCR cassette | real API | - |
| **Sharing** | | | | |
| status | struct parsing | VCR cassette | real API | JSON output |
| add user | param encoding | VCR cassette | real API | - |
| update user | param encoding | VCR cassette | real API | - |
| remove user | param encoding | VCR cassette | real API | - |
| **Research** | | | | |
| start | param encoding | VCR cassette | real API | - |
| poll | response parsing | VCR cassette | real API | - |
| import | param encoding | VCR cassette | real API | - |
| **Auth** | | | | |
| cookie loading | file parsing | - | browser login | - |
| CSRF extraction | regex parsing | mock server | real API | - |
| auth refresh | retry logic | mock server | real API | - |
| regional domains | domain validation | - | - | - |
| **CLI** | | | | |
| all commands | flag parsing | - | manual | output parity |
| --json mode | JSON formatting | - | manual | JSON parity |
| --help | help text | - | - | - |
| partial IDs | ID resolution | mock server | real API | - |
| exit codes | error handling | - | - | - |

### CI Pipeline

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: golangci/golangci-lint-action@v6

  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        go: ['1.22', '1.23']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-go@v5
      - run: go test -race -coverprofile=coverage.txt ./...
      - run: go tool cover -func=coverage.txt  # enforce 90%+

  e2e:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'  # nightly only
    steps:
      - run: go test -tags e2e ./tests/e2e/... -timeout 10m
        env:
          NOTEBOOKLM_AUTH_JSON: ${{ secrets.NOTEBOOKLM_AUTH_JSON }}
```

---

## Section 6: Distribution (npm, Homebrew, GitHub Releases)

### 6a. GitHub Releases with GoReleaser

**GoReleaser** builds multi-platform binaries and creates GitHub releases automatically on tag push.

**`.goreleaser.yml`:**
```yaml
version: 2
project_name: notebooklm-go

builds:
  - id: notebooklm
    main: ./cmd/notebooklm
    binary: notebooklm
    env:
      - CGO_ENABLED=0
    goos:
      - linux
      - darwin
      - windows
    goarch:
      - amd64
      - arm64
    ldflags:
      - -s -w
      - -X main.version={{.Version}}
      - -X main.commit={{.Commit}}

archives:
  - id: default
    formats: ['tar.gz']
    format_overrides:
      - goos: windows
        formats: ['zip']
    name_template: "{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"

checksum:
  name_template: 'checksums.txt'

changelog:
  sort: asc
  filters:
    exclude: ['docs:', 'test:', 'ci:']

brews:
  - repository:
      owner: <your-org>
      name: homebrew-tap
    directory: Formula
    homepage: "https://github.com/<your-org>/notebooklm-go"
    description: "CLI for Google NotebookLM"
    license: "MIT"
    install: |
      bin.install "notebooklm"
    test: |
      system "#{bin}/notebooklm", "--version"
```

**Release workflow (`.github/workflows/release.yml`):**
```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - uses: goreleaser/goreleaser-action@v6
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

**Produced artifacts per release:**
```
notebooklm-go_0.1.0_linux_amd64.tar.gz
notebooklm-go_0.1.0_linux_arm64.tar.gz
notebooklm-go_0.1.0_darwin_amd64.tar.gz
notebooklm-go_0.1.0_darwin_arm64.tar.gz   (Apple Silicon)
notebooklm-go_0.1.0_windows_amd64.zip
checksums.txt
```

### 6b. Homebrew Distribution

**Option A: GoReleaser auto-publishes** (recommended)
- GoReleaser's `brews` config auto-creates/updates the formula in a separate `homebrew-tap` repo
- Users install: `brew install <your-org>/tap/notebooklm`

**Option B: Manual Homebrew formula**
- Create `<your-org>/homebrew-tap` repo
- Add `Formula/notebooklm.rb`:

```ruby
class Notebooklm < Formula
  desc "CLI for Google NotebookLM"
  homepage "https://github.com/<your-org>/notebooklm-go"
  version "0.1.0"

  on_macos do
    on_arm do
      url "https://github.com/<org>/notebooklm-go/releases/download/v0.1.0/notebooklm-go_0.1.0_darwin_arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/<org>/notebooklm-go/releases/download/v0.1.0/notebooklm-go_0.1.0_darwin_amd64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/<org>/notebooklm-go/releases/download/v0.1.0/notebooklm-go_0.1.0_linux_arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/<org>/notebooklm-go/releases/download/v0.1.0/notebooklm-go_0.1.0_linux_amd64.tar.gz"
      sha256 "..."
    end
  end

  def install
    bin.install "notebooklm"
  end

  test do
    system "#{bin}/notebooklm", "--version"
  end
end
```

**User experience:**
```bash
brew tap <your-org>/tap
brew install notebooklm
notebooklm --version
```

### 6c. npm Distribution (wrapper package)

Create an npm package that downloads the correct Go binary for the user's platform.

**Package structure:**
```
npm/
├── package.json
├── install.js          # Post-install: download correct binary
├── run.js              # Wrapper: exec the Go binary
└── bin/
    └── notebooklm     # Symlink/wrapper script
```

**`package.json`:**
```json
{
  "name": "notebooklm-go",
  "version": "0.1.0",
  "description": "CLI for Google NotebookLM",
  "bin": {
    "notebooklm": "./run.js"
  },
  "scripts": {
    "postinstall": "node install.js"
  },
  "os": ["darwin", "linux", "win32"],
  "cpu": ["x64", "arm64"]
}
```

**`install.js`** (downloads correct binary):
```javascript
const os = require('os');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION = '0.1.0';
const PLATFORM_MAP = {
  darwin: { x64: 'darwin_amd64', arm64: 'darwin_arm64' },
  linux:  { x64: 'linux_amd64',  arm64: 'linux_arm64' },
  win32:  { x64: 'windows_amd64' },
};

const platform = os.platform();
const arch = os.arch();
const key = PLATFORM_MAP[platform]?.[arch];
if (!key) { console.error(`Unsupported: ${platform}/${arch}`); process.exit(1); }

const ext = platform === 'win32' ? 'zip' : 'tar.gz';
const url = `https://github.com/<org>/notebooklm-go/releases/download/v${VERSION}/notebooklm-go_${VERSION}_${key}.${ext}`;

// Download, extract, place binary in bin/
```

**`run.js`** (wrapper):
```javascript
#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const bin = path.join(__dirname, 'bin', process.platform === 'win32' ? 'notebooklm.exe' : 'notebooklm');
try {
  execFileSync(bin, process.argv.slice(2), { stdio: 'inherit' });
} catch (e) {
  process.exit(e.status || 1);
}
```

**User experience:**
```bash
npm install -g notebooklm-go
notebooklm --version
```

**Alternative: Use `@aspect-build/bazel-lib`-style platform packages**
- Publish separate npm packages per platform: `@notebooklm/darwin-arm64`, `@notebooklm/linux-x64`, etc.
- Main package uses `optionalDependencies` to pull correct one
- Cleaner but more complex to maintain

### 6d. Other Distribution Channels

| Channel | Effort | How |
|---------|--------|-----|
| **go install** | Free | `go install github.com/<org>/notebooklm-go/cmd/notebooklm@latest` |
| **Docker** | Low | `FROM scratch` + binary, publish to GHCR |
| **Scoop** (Windows) | Low | GoReleaser has `scoop` config |
| **AUR** (Arch Linux) | Low | Community PKGBUILD |
| **snap** | Medium | snapcraft.yaml |
| **nix** | Medium | Flake with buildGoModule |

### Distribution Matrix

| Platform | brew | npm | go install | GitHub Release |
|----------|------|-----|-----------|----------------|
| macOS (Intel) | yes | yes | yes | `.tar.gz` |
| macOS (ARM) | yes | yes | yes | `.tar.gz` |
| Linux (x64) | yes | yes | yes | `.tar.gz` |
| Linux (ARM) | yes | yes | yes | `.tar.gz` |
| Windows (x64) | - | yes | yes | `.zip` |

---

## Section 7: Upstream Tracking Automation

### Problem

`notebooklm-go` is a fork/rewrite of `teng-lin/notebooklm-py`. When the upstream Python project releases a new version, we need to:

1. **Detect** the new release automatically
2. **Create a GitHub issue** in `notebooklm-go` with release details
3. **Diff RPC method IDs** — the most critical thing that changes
4. **Track what needs patching** in our Go codebase

### Solution: GitHub Actions Scheduled Workflow

**`.github/workflows/upstream-check.yml`:**
```yaml
name: Track Upstream Releases
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:       # Manual trigger

jobs:
  check-upstream:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4

      - name: Check upstream release
        id: check
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Get latest upstream release
          LATEST=$(gh api repos/teng-lin/notebooklm-py/releases/latest --jq '.tag_name')
          echo "latest=$LATEST" >> "$GITHUB_OUTPUT"

          # Get our tracked version
          TRACKED=$(cat .upstream-version 2>/dev/null || echo "none")
          echo "tracked=$TRACKED" >> "$GITHUB_OUTPUT"

          if [ "$LATEST" != "$TRACKED" ]; then
            echo "new_release=true" >> "$GITHUB_OUTPUT"
          else
            echo "new_release=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Fetch upstream RPC changes
        if: steps.check.outputs.new_release == 'true'
        id: diff
        run: |
          # Clone upstream at new tag
          git clone --depth 1 --branch ${{ steps.check.outputs.latest }} \
            https://github.com/teng-lin/notebooklm-py.git /tmp/upstream

          # Extract RPC method IDs from upstream
          grep -E '^\s+\w+ = "' /tmp/upstream/src/notebooklm/rpc/types.py \
            | sort > /tmp/upstream_methods.txt

          # Extract our current method IDs
          grep -E '^\s+RPC\w+\s+RPCMethod = "' internal/rpc/types.go \
            | sort > /tmp/our_methods.txt

          # Diff
          DIFF=$(diff /tmp/our_methods.txt /tmp/upstream_methods.txt || true)
          echo "rpc_diff<<EOF" >> "$GITHUB_OUTPUT"
          echo "$DIFF" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"

          # Get release notes
          NOTES=$(gh api repos/teng-lin/notebooklm-py/releases/latest --jq '.body')
          echo "notes<<EOF" >> "$GITHUB_OUTPUT"
          echo "$NOTES" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"

      - name: Create tracking issue
        if: steps.check.outputs.new_release == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "Upstream release: notebooklm-py ${{ steps.check.outputs.latest }}" \
            --label "upstream,sync" \
            --body "$(cat <<'ISSUE_EOF'
          ## Upstream Release Detected

          **Version**: `${{ steps.check.outputs.latest }}`
          **Source**: https://github.com/teng-lin/notebooklm-py/releases/tag/${{ steps.check.outputs.latest }}

          ### Release Notes
          ${{ steps.diff.outputs.notes }}

          ### RPC Method ID Changes
          ```diff
          ${{ steps.diff.outputs.rpc_diff }}
          ```

          ### Action Items
          - [ ] Review release notes for new features
          - [ ] Update RPC method IDs if changed (`internal/rpc/types.go`)
          - [ ] Port new API methods if any
          - [ ] Port new CLI commands if any
          - [ ] Update tests for changed behavior
          - [ ] Update `.upstream-version` to `${{ steps.check.outputs.latest }}`
          - [ ] Run E2E tests to verify compatibility

          ---
          *Auto-generated by upstream-check workflow*
          ISSUE_EOF
          )"

      - name: Update tracked version
        if: steps.check.outputs.new_release == 'true'
        run: |
          echo "${{ steps.check.outputs.latest }}" > .upstream-version
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .upstream-version
          git commit -m "chore: track upstream release ${{ steps.check.outputs.latest }}"
          git push
```

### What the Workflow Does

```
Daily at 6 AM UTC:
  1. GET /repos/teng-lin/notebooklm-py/releases/latest
  2. Compare tag with .upstream-version file
  3. If new release detected:
     a. Clone upstream at new tag
     b. Diff RPC method IDs (types.py vs types.go)
     c. Create GitHub issue with:
        - Release notes
        - RPC method diff
        - Checklist of action items
     d. Update .upstream-version file
```

### Issue Labels Setup

Create these labels in the `notebooklm-go` repo:

| Label | Color | Description |
|-------|-------|-------------|
| `upstream` | `#0075ca` | Changes from upstream Python project |
| `sync` | `#e4e669` | Needs sync with upstream |
| `rpc-change` | `#d73a4a` | RPC method IDs changed (critical) |

### Enhanced: RPC Health Monitoring

Beyond tracking releases, monitor if Google changes RPC endpoints independently (they can change without a Python project release):

**`.github/workflows/rpc-health.yml`:**
```yaml
name: RPC Health Check
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Test RPC endpoints
        env:
          NOTEBOOKLM_AUTH_JSON: ${{ secrets.NOTEBOOKLM_AUTH_JSON }}
        run: |
          go test -tags e2e -run TestRPCHealth ./tests/e2e/... -timeout 2m

      - name: Create issue on failure
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Check if issue already exists
          EXISTING=$(gh issue list --label "rpc-change" --state open --json number --jq 'length')
          if [ "$EXISTING" -eq "0" ]; then
            gh issue create \
              --title "RPC Health Check Failed - possible API change" \
              --label "rpc-change,upstream" \
              --body "RPC health check failed. Google may have changed method IDs.

              **Action**: Check network traffic and update \`internal/rpc/types.go\`

              See: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          fi
```

### Version Mapping File (`.upstream-version`)

Simple text file tracking the last-synced upstream version:
```
v0.3.4
```

Updated automatically by the workflow after creating an issue.

---

## Summary: Migration at a Glance

| Aspect | Decision |
|--------|----------|
| **Project** | Separate repo: `notebooklm-go` |
| **CLI Framework** | Cobra |
| **Terminal UI** | lipgloss + tablewriter |
| **HTTP Client** | net/http (stdlib) |
| **Browser Auth** | chromedp |
| **JSON Parsing** | encoding/json + gjson |
| **Testing** | stdlib + testify + go-vcr |
| **Distribution** | GoReleaser → GitHub Releases + Homebrew + npm |
| **Upstream Tracking** | GitHub Actions daily cron + auto-issue creation |
| **Migration Order** | Bottom-up: types → RPC → auth → core → APIs → CLI |
| **Estimated Effort** | ~24 working days for full parity |

### Why Go over Python for this project?

| Benefit | Impact |
|---------|--------|
| **Single binary** | No Python, pip, venv — just download and run |
| **Cross-platform** | Build once, ship to linux/mac/windows/arm64 |
| **Fast startup** | ~10ms vs ~500ms Python import time |
| **No runtime deps** | No Python 3.10+ requirement on target machine |
| **npm/brew native** | Go binaries wrap naturally into package managers |
| **Type safety** | Compile-time catches vs runtime TypeError |
| **Concurrency** | Goroutines vs asyncio complexity |
| **Distribution** | GoReleaser handles everything automatically |
