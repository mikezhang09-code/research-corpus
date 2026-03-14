# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Follow documentation rules in [CONTRIBUTING.md](CONTRIBUTING.md) - especially the file creation and naming conventions.

## Project Overview

`notebooklm-py` is an unofficial Python client for Google NotebookLM that uses undocumented RPC APIs. The library enables programmatic automation of NotebookLM features including notebook management, source integration, AI querying, studio artifact generation (podcasts, videos, quizzes, etc.), sharing, research, living documents, and settings management.

**Critical constraint**: This uses Google's internal `batchexecute` RPC protocol with obfuscated method IDs that Google can change at any time. All RPC method IDs in `src/notebooklm/rpc/types.py` are undocumented and subject to breakage.

## Development Commands

```bash
# Create/recreate venv with uv (recommended - relocatable venvs)
uv venv .venv
uv pip install -e ".[all]"
playwright install chromium

# Activate virtual environment
source .venv/bin/activate

# Run all tests (excluding e2e by default)
pytest

# Run with coverage
pytest --cov

# Run e2e tests (requires authentication)
pytest tests/e2e -m e2e

# CLI testing
notebooklm --help
```

## Pre-Commit Checks (REQUIRED before committing)

**IMPORTANT:** Always run these checks before committing to avoid CI failures:

```bash
# Format code with ruff
ruff format src/ tests/

# Check for linting issues
ruff check src/ tests/

# Type checking with mypy
mypy src/notebooklm --ignore-missing-imports

# Run tests
pytest
```

Or use this one-liner:
```bash
ruff format src/ tests/ && ruff check src/ tests/ && mypy src/notebooklm --ignore-missing-imports && pytest
```

## Architecture

### Layered Design

```
CLI Layer (cli/)
    ↓
Client Layer (client.py, _*.py APIs)
    ↓
Core Layer (_core.py)
    ↓
RPC Layer (rpc/)
```

1. **RPC Layer** (`src/notebooklm/rpc/`):
   - `types.py`: All RPC method IDs and enums (source of truth)
   - `encoder.py`: Request encoding
   - `decoder.py`: Response parsing

2. **Core Layer** (`src/notebooklm/_core.py`):
   - HTTP client management
   - RPC call abstraction
   - Request counter handling

3. **Client Layer** (`src/notebooklm/client.py`, `_*.py`):
   - `NotebookLMClient`: Main async client with namespaced APIs
   - `_notebooks.py`, `_sources.py`, `_artifacts.py`, `_chat.py`, `_research.py`, `_notes.py`, `_sharing.py`, `_settings.py`, `_living_docs.py`: Domain APIs
   - `_cache.py`: Optional SQLite caching middleware for rate limiting and dataset building

4. **CLI Layer** (`src/notebooklm/cli/`):
   - Modular Click commands with `SectionedGroup` for organized help output
   - `session.py`, `notebook.py`, `source.py`, `generate.py`, `share.py`, `research.py`, etc.

### Key Files

| File | Purpose |
|------|---------|
| `client.py` | Main `NotebookLMClient` class |
| `_core.py` | HTTP and RPC infrastructure |
| `_notebooks.py` | `client.notebooks` API |
| `_sources.py` | `client.sources` API |
| `_artifacts.py` | `client.artifacts` API |
| `_chat.py` | `client.chat` API |
| `_research.py` | `client.research` API |
| `_notes.py` | `client.notes` API |
| `_sharing.py` | `client.sharing` API |
| `_settings.py` | `client.settings` API |
| `_living_docs.py` | `client.living_docs` API (auto-syncing Drive files) |
| `_cache.py` | Optional SQLite caching middleware |
| `exceptions.py` | Exception hierarchy (`NotebookLMError` base class) |
| `paths.py` | Path resolution (respects `NOTEBOOKLM_HOME` env var) |
| `types.py` | Dataclasses for API responses |
| `_logging.py` | Logging config (`NOTEBOOKLM_LOG_LEVEL`, `NOTEBOOKLM_DEBUG_RPC`) |
| `_url_utils.py` | URL validation utilities (YouTube detection, etc.) |
| `_version_check.py` | Runtime Python >= 3.10 check |
| `auth.py` | Authentication handling |
| `rpc/types.py` | RPC method IDs (source of truth) |
| `cli/` | CLI command modules |

### Repository Structure

```
src/notebooklm/
├── __init__.py          # Public exports
├── __main__.py          # python -m notebooklm entry point
├── notebooklm_cli.py    # CLI entry point (notebooklm command)
├── client.py            # NotebookLMClient
├── auth.py              # Authentication
├── types.py             # Dataclasses
├── exceptions.py        # Exception hierarchy
├── paths.py             # Path resolution
├── _core.py             # Core infrastructure
├── _notebooks.py        # NotebooksAPI
├── _sources.py          # SourcesAPI
├── _artifacts.py        # ArtifactsAPI
├── _chat.py             # ChatAPI
├── _research.py         # ResearchAPI
├── _notes.py            # NotesAPI
├── _sharing.py          # SharingAPI
├── _settings.py         # SettingsAPI
├── _living_docs.py      # LivingDocsAPI (Drive sync)
├── _cache.py            # Cache middleware (SQLite)
├── _logging.py          # Logging configuration
├── _url_utils.py        # URL validation utilities
├── _version_check.py    # Python version check
├── rpc/                 # RPC protocol layer
│   ├── __init__.py
│   ├── types.py         # Method IDs and enums
│   ├── encoder.py       # Request encoding
│   └── decoder.py       # Response parsing
└── cli/                 # CLI implementation
    ├── __init__.py
    ├── grouped.py       # SectionedGroup for organized help
    ├── helpers.py       # Shared utilities
    ├── options.py       # Shared option decorators (--notebook, --json)
    ├── error_handler.py # Centralized error handling
    ├── download_helpers.py # Download utilities (partial ID, filenames)
    ├── session.py       # login, use, status, clear
    ├── notebook.py      # list, create, delete, rename, summary
    ├── source.py        # source add, list, delete
    ├── artifact.py      # artifact commands
    ├── generate.py      # generate audio, video, etc.
    ├── download.py      # download commands
    ├── chat.py          # ask, configure, history
    ├── note.py          # note commands
    ├── share.py         # share status, public, add, remove
    ├── research.py      # research status, wait
    ├── language.py      # language list, get, set
    ├── living_doc.py    # living-doc register, check-stale, sync
    └── skill.py         # Claude Code skill install/update/remove
```

## API Patterns

### Client Usage

```python
# Correct pattern - uses namespaced APIs
async with await NotebookLMClient.from_storage() as client:
    notebooks = await client.notebooks.list()
    await client.sources.add_url(nb_id, url)
    result = await client.chat.ask(nb_id, question)
    status = await client.artifacts.generate_audio(nb_id)
    share = await client.sharing.get_status(nb_id)
    await client.settings.get_language(nb_id)
```

### CLI Structure

Commands are organized as:
- **Top-level**: `login`, `use`, `status`, `clear`, `list`, `create`, `delete`, `rename`, `summary`, `ask`, `configure`, `history`
- **Grouped**: `source add`, `artifact list`, `generate audio`, `download video`, `note create`, `share status`, `research status`, `language set`, `living-doc sync`

## Testing Strategy

- **Unit tests** (`tests/unit/`): Test encoding/decoding, CLI commands, no network
- **Integration tests** (`tests/integration/`): Mock HTTP responses
- **VCR cassette tests** (`tests/integration/cli_vcr/`): Recorded API responses for CLI tests
- **E2E tests** (`tests/e2e/`): Real API, require auth, marked `@pytest.mark.e2e`

### Test Markers

| Marker | Purpose |
|--------|---------|
| `e2e` | End-to-end tests requiring authentication |
| `variants` | Parameter variant tests (skip to save quota) |
| `readonly` | Read-only tests against user's test notebook |
| `vcr` | Tests using VCR.py recorded cassettes (`NOTEBOOKLM_VCR_RECORD=1` to record) |

### Test Configuration

- Default timeout: 60 seconds per test (override with `@pytest.mark.timeout(seconds)`)
- Coverage target: 90% (`fail_under = 90` in pyproject.toml)
- E2E tests excluded by default (`--ignore=tests/e2e` in pytest config)

### E2E Test Coverage

- Notebook operations (list, create, rename, delete)
- Source operations (add URL/text/YouTube, rename, file upload)
- Download operations (audio, video, infographic, slides)
- Chat operations
- Research operations
- Notes operations
- Settings operations
- Sharing operations
- Artifact generation (may fail due to rate limiting)

## Common Pitfalls

1. **RPC method IDs change**: Check network traffic and update `rpc/types.py`
2. **Nested list structures**: Params are position-sensitive. Check existing implementations.
3. **Source ID nesting**: Different methods need `[id]`, `[[id]]`, `[[[id]]]`, or `[[[[id]]]]`
4. **CSRF tokens expire**: Use `client.refresh_auth()` or re-run `notebooklm login`
5. **Rate limiting**: Add delays between bulk operations
6. **Exception handling**: Use the exception hierarchy from `exceptions.py` - all inherit from `NotebookLMError`
7. **URL validation**: Use `_url_utils.py` helpers instead of substring matching (avoids CodeQL security warnings)

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NOTEBOOKLM_HOME` | Base directory for config files (default: `~/.notebooklm`) |
| `NOTEBOOKLM_LOG_LEVEL` | Set to `DEBUG`, `INFO`, `WARNING` (default), or `ERROR` |
| `NOTEBOOKLM_DEBUG_RPC` | Set to `1` to enable debug logging (legacy) |
| `NOTEBOOKLM_VCR_RECORD` | Set to `1` to record VCR cassettes for tests |

## Documentation

All docs use lowercase-kebab naming in `docs/`:
- `docs/cli-reference.md` - CLI commands
- `docs/python-api.md` - Python API reference
- `docs/configuration.md` - Storage and settings
- `docs/troubleshooting.md` - Known issues
- `docs/development.md` - Architecture and testing
- `docs/releasing.md` - Release checklist
- `docs/stability.md` - API versioning policy
- `docs/auth-architecture.md` - Authentication architecture
- `docs/rpc-development.md` - RPC capture and debugging
- `docs/rpc-reference.md` - RPC payload structures
- `docs/examples/` - Runnable example scripts (quickstart, chat, video, notes, bulk-import, research-to-podcast)

## Code Style

- **Formatter/Linter**: ruff (target Python 3.10, line length 100)
- **Type checker**: mypy (check_untyped_defs, ignore_missing_imports)
- **Quote style**: double quotes
- **Indent style**: spaces
- **Import sorting**: isort via ruff (`known-first-party = ["notebooklm"]`)

## When to Suggest CLI vs API

- **CLI**: Quick tasks, shell scripts, LLM agent automation
- **Python API**: Application integration, complex workflows, async operations

## Pull Request Workflow (REQUIRED)

After creating a PR, you MUST monitor and address feedback:

### 1. Monitor CI Status
```bash
# Check CI status (repeat until all pass)
gh pr checks <PR_NUMBER>
```

Wait for all checks to pass. If any fail, investigate and fix.

### 2. Check for Review Comments
```bash
# Get review comments
gh api repos/teng-lin/notebooklm-py/pulls/<PR_NUMBER>/comments \
  --jq '.[] | "File: \(.path):\(.line)\nComment: \(.body)\n---"'
```

### 3. Address Feedback
For each review comment (especially from `gemini-code-assist`):
1. Read and understand the feedback
2. Make the suggested fix if it improves the code
3. Commit with a descriptive message referencing the feedback
4. Push and re-check CI
5. **Reply to the review thread** confirming the fix:
   ```bash
   gh api repos/teng-lin/notebooklm-py/pulls/<PR>/comments/<COMMENT_ID>/replies \
     -f body="Addressed in commit <SHA>: <brief description>"
   ```

### 4. Verify Final State
```bash
# Ensure PR is ready to merge
gh pr view <PR_NUMBER> --json state,mergeStateStatus,mergeable
```

**Important**: Do NOT consider a PR complete until:
- All CI checks pass
- All review comments are addressed
- `mergeStateStatus` is `CLEAN`
