# Authentication Architecture

**Status:** Active
**Last Updated:** 2026-03-11

This document explains how authentication works across all notebooklm-py surfaces (Python library, CLI, MCP worker) and how to bridge between them.

## Overview

NotebookLM uses Google's cookie-based authentication. Every API call requires:

1. **Session cookies** (~25 cookies from `.google.com` and related domains)
2. **CSRF token** (`SNlM0e`) — extracted from the NotebookLM homepage HTML
3. **Session ID** (`FdrFJe`) — extracted from the NotebookLM homepage HTML
4. **Build label** (`cfb2h`) — optional but keeps the `bl` parameter current

Cookies are long-lived (days to weeks). CSRF tokens and session IDs are short-lived and auto-refreshed by the client.

## Auth Surfaces

### 1. Python Library (`NotebookLMClient`)

The library uses `AuthTokens` — a dataclass holding cookies + CSRF + session ID + build label.

```python
# AuthTokens.from_storage() does everything:
# 1. Loads cookies from storage_state.json or NOTEBOOKLM_AUTH_JSON
# 2. Fetches notebooklm.google.com to extract CSRF, session ID, build label
# 3. Returns a ready-to-use AuthTokens instance

auth = await AuthTokens.from_storage()
async with NotebookLMClient(auth) as client:
    notebooks = await client.notebooks.list()
```

**Auto-refresh:** When an API call fails with an auth error, `client.refresh_auth()` re-fetches the homepage to get fresh CSRF/session tokens. This is automatic — the `ClientCore` calls the refresh callback on auth failures.

### 2. CLI (`notebooklm` command)

The CLI uses the `@with_client` decorator which calls `get_auth_tokens(ctx)` → `AuthTokens.from_storage()`. Same auth pipeline as the library.

```bash
# Interactive login — opens browser, saves cookies
notebooklm login

# All subsequent commands load from storage automatically
notebooklm list
notebooklm ask "What is this about?"
```

### 3. MCP Worker (`notebooklm-worker`)

The MCP worker is a Cloudflare Worker that stores auth in **R2 object storage** and **KV**. It has its own cookie store that is NOT shared with the local CLI/library.

**Key difference:** The MCP worker's auth is isolated. There is no MCP tool that exports raw cookies.

| MCP Tool | What It Does | Exports Cookies? |
|----------|-------------|-----------------|
| `nlm_auth_status` | Returns `authenticated`, `cookie_count`, `has_csrf` | No — status only |
| `refresh_auth` | Re-fetches CSRF/session tokens from homepage | No — returns `has_csrf`, `build_label` |
| `save_auth_tokens` | Saves cookies TO the worker's R2 store | No — input only, not output |

## Auth Loading Precedence

When the library or CLI loads auth, it checks these sources in order:

```
1. --storage CLI flag          (explicit path to storage_state.json)
      ↓ (if not provided)
2. NOTEBOOKLM_AUTH_JSON        (env var with inline JSON — for CI/CD)
      ↓ (if not set)
3. $NOTEBOOKLM_HOME/storage_state.json   (custom home dir)
      ↓ (if NOTEBOOKLM_HOME not set)
4. ~/.notebooklm/storage_state.json      (default location)
```

**First match wins.** If none found, raises `FileNotFoundError`.

### Source: `auth.py:_load_storage_state()`

```python
def _load_storage_state(path: Path | None = None) -> dict[str, Any]:
    # 1. Explicit path (--storage flag)
    if path:
        return json.loads(path.read_text())

    # 2. NOTEBOOKLM_AUTH_JSON env var
    if "NOTEBOOKLM_AUTH_JSON" in os.environ:
        return json.loads(os.environ["NOTEBOOKLM_AUTH_JSON"])

    # 3. File at configured home dir
    storage_path = get_storage_path()  # respects NOTEBOOKLM_HOME
    return json.loads(storage_path.read_text())
```

## Storage State Format

The `storage_state.json` file uses Playwright's format:

```json
{
  "cookies": [
    {
      "name": "SID",
      "value": "g.a000abc...",
      "domain": ".google.com",
      "path": "/",
      "expires": 1742000000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    {
      "name": "__Secure-1PSID",
      "value": "g.a000xyz...",
      "domain": ".google.com",
      "path": "/",
      "expires": 1742000000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    }
  ],
  "origins": []
}
```

**Minimum required cookie:** `SID` (checked by `extract_cookies_from_storage()`).

**Commonly present cookies (~25):**
`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-1PSID`, `__Secure-3PSID`, `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `__Secure-1PAPISID`, `__Secure-3PAPISID`, `NID`, `AEC`, `SOCS`, plus others.

## Cookie Domain Handling

Google sets cookies on multiple domains depending on the user's region:

| Domain Pattern | Example | Priority |
|---------------|---------|----------|
| `.google.com` | Base domain | Highest — always preferred |
| `.google.com.XX` | `.google.com.sg` (Singapore) | Fallback |
| `.google.co.XX` | `.google.co.uk` (UK) | Fallback |
| `.google.XX` | `.google.de` (Germany) | Fallback |

When the same cookie name exists on multiple domains (e.g., `SID` on both `.google.com` and `.google.com.sg`), the `.google.com` value always wins. This prevents non-deterministic behavior.

**Supported regional domains:** See `GOOGLE_REGIONAL_CCTLDS` in `auth.py` for the full list (~50 countries).

## Token Lifecycle

```
notebooklm login (browser)
    │
    ├── Saves cookies to storage_state.json
    │   (long-lived: days to weeks)
    │
    ▼
AuthTokens.from_storage()
    │
    ├── Loads cookies from storage
    ├── GET https://notebooklm.google.com/
    ├── Extracts SNlM0e (CSRF token)
    ├── Extracts FdrFJe (session ID)
    └── Extracts cfb2h (build label)
        (short-lived: hours)
    │
    ▼
API calls using cookies + CSRF + session ID
    │
    ├── On auth error → client.refresh_auth()
    │   └── Re-fetches homepage for fresh CSRF/session
    │       (cookies stay the same)
    │
    └── On persistent auth error → cookies expired
        └── Must re-run: notebooklm login
```

## Bridging MCP Worker ↔ Local CLI

**Problem:** The MCP worker and local CLI maintain separate auth stores. You cannot directly export cookies from the MCP worker to use locally.

### How to Share Auth

#### Option A: Browser Login (Recommended)

Both the MCP worker and local CLI authenticate against the same Google account. Log in once locally and the cookies work everywhere:

```bash
# 1. Login locally
notebooklm login

# 2. Verify it works
notebooklm list

# 3. If MCP worker needs the same cookies, export and save:
cat ~/.notebooklm/storage_state.json
# → Use save_auth_tokens MCP tool to push cookies to the worker
```

#### Option B: Export from Browser DevTools

If `notebooklm login` isn't available (headless server), extract cookies manually:

1. Open https://notebooklm.google.com in Chrome
2. Open DevTools → Application → Cookies
3. Copy all `.google.com` cookies
4. Format as Playwright storage state JSON
5. Save to `~/.notebooklm/storage_state.json` or set `NOTEBOOKLM_AUTH_JSON`

#### Option C: CI/CD with Env Var

```bash
# Set inline auth (no file writes)
export NOTEBOOKLM_AUTH_JSON='{"cookies":[{"name":"SID","value":"...","domain":".google.com",...}]}'

# CLI and library both pick this up automatically
notebooklm list
python -c "
import asyncio
from notebooklm import NotebookLMClient
async def main():
    async with await NotebookLMClient.from_storage() as client:
        print(await client.notebooks.list())
asyncio.run(main())
"
```

#### Option D: Share Between Machines

```bash
# Copy auth to remote machine
scp ~/.notebooklm/storage_state.json user@server:~/.notebooklm/

# Or use a shared path
export NOTEBOOKLM_HOME=/shared/mount/.notebooklm
```

### What Does NOT Work

| Approach | Why It Fails |
|----------|-------------|
| `nlm_auth_status` MCP tool | Returns flags (`authenticated: true`), not cookie values |
| `refresh_auth` MCP tool | Returns `has_csrf`/`build_label`, not cookies |
| `save_auth_tokens` MCP tool | Saves cookies TO the worker, doesn't export FROM it |
| Reading MCP worker's R2/KV | No tool exposes raw cookie data from storage |

## Troubleshooting

### "Storage file not found"

```
FileNotFoundError: Storage file not found: ~/.notebooklm/storage_state.json
Run 'notebooklm login' to authenticate first.
```

**Fix:** Run `notebooklm login` or set `NOTEBOOKLM_AUTH_JSON`.

### "Missing required cookies: {'SID'}"

The storage state file exists but doesn't contain Google auth cookies.

**Fix:** Re-run `notebooklm login`. The existing `storage_state.json` may be from a failed login.

### "Authentication expired or invalid"

CSRF token extraction failed — Google redirected to login page.

**Fix:**
1. Try `notebooklm login` to get fresh cookies
2. If cookies are less than a day old, it may be a transient issue — retry

### "Session Expired" errors during API calls

The CSRF token or session ID expired but cookies are still valid.

**Fix:** This should auto-recover. The `refresh_auth()` callback re-fetches tokens automatically. If it persists, cookies have expired → re-login.

### MCP Worker authenticated but CLI is not

The MCP worker and CLI use independent auth stores.

**Fix:** Run `notebooklm login` locally. The MCP worker's cookies cannot be exported to the CLI.

## Key Files

| File | Purpose |
|------|---------|
| `src/notebooklm/auth.py` | `AuthTokens`, cookie extraction, token fetching |
| `src/notebooklm/_core.py` | `ClientCore` with auto-refresh on auth failure |
| `src/notebooklm/client.py` | `refresh_auth()` method on `NotebookLMClient` |
| `src/notebooklm/cli/helpers.py` | `get_auth_tokens()`, `@with_client` decorator |
| `src/notebooklm/paths.py` | `get_storage_path()`, `get_home_dir()` |
| `~/.notebooklm/storage_state.json` | Default cookie storage location |

## Security Notes

- `storage_state.json` contains sensitive session cookies — treat as a credential file
- Set permissions to `600` (`chmod 600 storage_state.json`)
- Never commit to git or share publicly
- `NOTEBOOKLM_AUTH_JSON` stays in memory only (no file written)
- Cookie domains are validated against a whitelist to prevent injection
- Regional domain handling prevents `.google.com` suffix attacks (e.g., `evil-google.com` is rejected)
