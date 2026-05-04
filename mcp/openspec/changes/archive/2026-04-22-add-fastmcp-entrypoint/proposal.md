## Why

The `fastmcp` CLI tool (`fastmcp list`, `fastmcp call`) is the standard way to inspect and interact with FastMCP servers. However, it requires a **module-level FastMCP instance** as its entry point — it cannot run files that use relative imports or encapsulate the server inside functions. Currently, our server only exposes a `main()` function via `__main__.py`, which is incompatible with `fastmcp` CLI direct invocation. Adding a top-level `server.py` that uses FastMCP's `lifespan` mechanism for client initialization will make the server both CLI-compatible and architecturally cleaner.

## What Changes

- Add `src/nblm_mcp_server/server.py` exposing a module-level `mcp` FastMCP instance with tools registered and the NotebookLM client managed via lifespan context.
- Modify `__main__.py` to import from `server.py` instead of constructing its own `FastMCP` instance, removing the duplication.
- The `client_service.py` singleton pattern is preserved; `setup_client()` / `teardown_client()` are now called from the FastMCP lifespan hook.

## Capabilities

### New Capabilities
- `fastmcp-entrypoint`: A standalone `server.py` module exposing a top-level `mcp` FastMCP instance compatible with `fastmcp list/call/run`, using lifespan for client lifecycle management.

### Modified Capabilities
- `mcp-server-core`: The server startup flow changes to use FastMCP lifespan instead of a manual `setup/teardown` wrapper in `__main__.py`.

## Impact

- **Code**: `src/nblm_mcp_server/server.py` (new), `src/nblm_mcp_server/__main__.py` (modified to use server.py)
- **APIs**: No change to MCP tools or their interfaces
- **Developer UX**: `fastmcp list src/nblm_mcp_server/server.py` now works
