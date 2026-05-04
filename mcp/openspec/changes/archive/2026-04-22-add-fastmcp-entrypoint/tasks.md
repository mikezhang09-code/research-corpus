## 1. Create server.py

- [x] 1.1 Create `src/nblm_mcp_server/server.py` with a module-level `mcp` FastMCP instance
- [x] 1.2 Add a `lifespan` context manager to `server.py` that calls `setup_client()` on startup and `teardown_client()` on shutdown
- [x] 1.3 Register all tools onto the `mcp` instance by calling `tools.register(mcp)` in `server.py`

## 2. Refactor __main__.py

- [x] 2.1 Update `__main__.py` to import `mcp` from `server.py` instead of calling `create_server()`
- [x] 2.2 Remove the manual `setup_client()` / `teardown_client()` calls from `__main__.py` (now handled by lifespan)
- [x] 2.3 Remove the now-unused `create_server()` function from `__main__.py`

## 3. Verify

- [x] 3.1 Verify `fastmcp list src/nblm_mcp_server/server.py` works and lists all 5 tools
- [x] 3.2 Verify `python -m nblm_mcp_server` still starts the server correctly
