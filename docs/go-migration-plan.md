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
