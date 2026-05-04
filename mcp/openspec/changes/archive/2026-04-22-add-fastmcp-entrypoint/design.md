## Context

The FastMCP CLI (`fastmcp list`, `fastmcp call`, `fastmcp run`) requires a **module-level `FastMCP` instance** as its entry point—it imports the target file and looks for a top-level `mcp` variable. Our current architecture wraps everything inside `create_server()` and `main()` in `__main__.py`, making it incompatible with the CLI. Additionally, client initialization (`setup_client`) currently happens inside `_run_async()`, tightly coupling it to the `__main__.py` lifecycle.

## Goals / Non-Goals

**Goals:**
- Create `server.py` with a module-level `mcp` FastMCP instance usable by `fastmcp list/call/run`.
- Use FastMCP's **`lifespan` context manager** to handle `setup_client()` and `teardown_client()` within the FastMCP application lifecycle, so the client is properly managed regardless of how the server is launched.
- Refactor `__main__.py` to import `mcp` from `server.py` instead of constructing its own instance.

**Non-Goals:**
- Changing any MCP tool signatures or behavior.
- Adding new tools or capabilities.

## Decisions

- **Lifespan over manual setup/teardown**: FastMCP supports an `@asynccontextmanager` lifespan hook. Using it ensures the NotebookLM client is always initialized before any tool call—regardless of whether the server is started via `python -m nblm_mcp_server` or `fastmcp run src/nblm_mcp_server/server.py`. This is cleaner than the current approach of calling `setup_client()` manually in `_run_async()`.
- **Module-level `mcp` variable**: The `server.py` file will create and expose `mcp = FastMCP(...)` at module level with tools registered. `__main__.py` imports this directly.
- **No breaking changes to tool API**: All 5 tools remain identical; only the wiring changes.

## Risks / Trade-offs

- **Risk: lifespan not called in some FastMCP versions** → Mitigation: Verify against installed FastMCP 3.x docs; `lifespan` is supported since FastMCP 2.x.
- **Minor**: `server.py` at module level won't initialize the client on import (only on server run)—this is intentional and correct behavior.
