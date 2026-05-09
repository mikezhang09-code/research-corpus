# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Follow documentation rules in [CONTRIBUTING.md](CONTRIBUTING.md) - especially the file creation and naming conventions.

## Project Overview

`notebooklm-py` is an unofficial Python client for Google NotebookLM that uses undocumented RPC APIs. The library enables programmatic automation of NotebookLM features including notebook management, source integration, AI querying, and studio artifact generation (podcasts, videos, quizzes, etc.).

**Critical constraint**: This uses Google's internal `batchexecute` RPC protocol with obfuscated method IDs that Google can change at any time. All RPC method IDs in `src/notebooklm/rpc/types.py` are undocumented and subject to breakage.

## Development Commands

```bash
# Install (uv recommended)
uv sync --extra dev --extra browser
playwright install chromium

# Run all tests (e2e excluded by default)
uv run pytest

# Run a single test file or test
uv run pytest tests/unit/test_encoder.py
uv run pytest -k "test_list_notebooks"

# Run with coverage (must stay at or above 90%)
uv run pytest --cov

# Run e2e tests (requires authentication and env vars)
uv run pytest tests/e2e -m e2e
uv run pytest tests/e2e -m readonly  # read-only subset

# Record VCR cassettes for integration tests
NOTEBOOKLM_VCR_RECORD=1 uv run pytest tests/integration/test_vcr_*.py -v

# CLI
uv run notebooklm --help
```

## Pre-Commit Checks (REQUIRED before committing)

```bash
uv run ruff format src/ tests/ && uv run ruff check src/ tests/ && uv run mypy src/notebooklm && uv run pytest
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

1. **RPC Layer** (`src/notebooklm/rpc/`): `types.py` holds all obfuscated RPC method IDs (source of truth). `encoder.py` builds the `batchexecute` request bodies. `decoder.py` parses the nested-list responses.

2. **Core Layer** (`src/notebooklm/_core.py`): Manages the `httpx` async client, executes RPC calls, handles retries and auth refresh, and maintains a per-session request counter required by the protocol.

3. **Client Layer** (`src/notebooklm/client.py`, `_*.py`): `NotebookLMClient` exposes namespaced APIs (`client.notebooks`, `client.sources`, `client.artifacts`, `client.chat`, `client.research`, `client.notes`). Each namespace is a separate `_*.py` module.

4. **CLI Layer** (`src/notebooklm/cli/`): Modular Click commands grouped by domain. `notebooklm_cli.py` is the entry point.

### Key Files

| File | Purpose |
|------|---------|
| `client.py` | `NotebookLMClient` — main entry point |
| `_core.py` | HTTP client, RPC dispatch, auth refresh |
| `rpc/types.py` | RPC method IDs and enums (update here when Google changes IDs) |
| `exceptions.py` | Full exception hierarchy (`NotebookLMError` base) |
| `auth.py` | Cookie-based and Playwright auth flows |
| `types.py` | Public dataclasses for notebooks, sources, artifacts |
| `paths.py` | `NOTEBOOKLM_HOME`-aware storage paths |
| `migration.py` | Storage format migrations between versions |

## API Patterns

```python
# Correct pattern — async context manager, namespaced APIs
async with await NotebookLMClient.from_storage() as client:
    notebooks = await client.notebooks.list()
    await client.sources.add_url(nb_id, url)
    result = await client.chat.ask(nb_id, question)
    status = await client.artifacts.generate_audio(nb_id)
```

## CLI Structure

Commands are organized as:
- **Top-level**: `login`, `use`, `status`, `clear`, `list`, `create`, `ask`
- **Grouped**: `source add/list/delete`, `artifact list/delete`, `generate audio/video/...`, `download audio/video/...`, `note create/list/...`, `research start/import`, `share`

Prefer `--json` flag when scripting or working in agent contexts.

## Testing Strategy

- **Unit tests** (`tests/unit/`): Test encoding/decoding, no network
- **Integration tests** (`tests/integration/`): VCR cassettes in `tests/cassettes/` replay recorded HTTP fixtures
- **E2E tests** (`tests/e2e/`): Real API, require auth, marked `@pytest.mark.e2e`; read-only subset with `@pytest.mark.readonly`

Coverage threshold is **90%** — failing to meet it will fail CI.

### E2E Test Status

- ✅ Notebook operations (list, create, rename, delete)
- ✅ Source operations (add URL/text/YouTube, rename)
- ✅ Download operations (audio, video, infographic, slides)
- ⚠️ Artifact generation may fail due to rate limiting

## Commit Style

Follow the existing convention: `feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `docs(scope): ...`, `style: ...`. Common scopes: `cli`, `rpc`, `client`, `test`, `auth`.

## Parallel Agent Isolation

When running multiple agents on the same machine, isolate storage with:
```bash
NOTEBOOKLM_HOME=/tmp/<agent-id> notebooklm ...
```
Pass explicit notebook IDs with `--notebook-id` rather than relying on `notebooklm use`.

## Common Pitfalls

1. **RPC method IDs change**: Check network traffic and update `rpc/types.py`
2. **Nested list structures**: RPC params are position-sensitive; check existing implementations
3. **Source ID nesting**: Different methods need `[id]`, `[[id]]`, `[[[id]]]`, or `[[[[id]]]]`
4. **CSRF tokens expire**: Use `client.refresh_auth()` or re-run `notebooklm login`
5. **Rate limiting**: Add delays between bulk operations

## Documentation Rules for Agents

From [CONTRIBUTING.md](CONTRIBUTING.md):

1. **No root `.md` files** — never create `.md` files in the repo root without explicit user instruction
2. **No forks** — edit existing files; never create `FILE_v2.md` or `FILE_updated.md` duplicates
3. **Scratchpad** — investigation notes and intermediate work go in `docs/scratch/YYYY-MM-DD-<context>.md`
4. **Protected sections** — never modify content between `<!-- PROTECTED -->` / `<!-- END PROTECTED -->` or `# PROTECTED:` / `# END PROTECTED` markers without explicit user approval
5. **Naming**: root GitHub files → `UPPERCASE.md`; all other `docs/` files → `lowercase-kebab.md`

## Documentation

All docs use lowercase-kebab naming in `docs/`:
- `docs/cli-reference.md` — CLI commands
- `docs/python-api.md` — Python API reference
- `docs/configuration.md` — Storage and settings
- `docs/troubleshooting.md` — Known issues
- `docs/stability.md` — API versioning policy
- `docs/development.md` — Architecture, testing, releasing
- `docs/rpc-development.md` — RPC capture and debugging
- `docs/rpc-reference.md` — RPC payload structures
- `docs/releasing.md` — Release checklist
- `docs/scratch/` — Temporary investigation logs (agent scratchpad)

## When to Suggest CLI vs API

- **CLI**: Quick tasks, shell scripts, LLM agent automation
- **Python API**: Application integration, complex workflows, async operations

## Pull Request Workflow (REQUIRED)

After creating a PR, you MUST monitor and address feedback:

### 1. Monitor CI Status
```bash
gh pr checks <PR_NUMBER>
```

Wait for all checks to pass. If any fail, investigate and fix.

### 2. Check for Review Comments
```bash
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
gh pr view <PR_NUMBER> --json state,mergeStateStatus,mergeable
```

**Important**: Do NOT consider a PR complete until:
- All CI checks pass
- All review comments are addressed
- `mergeStateStatus` is `CLEAN`
