## ADDED Requirements

### Requirement: Module-level FastMCP entrypoint
The system SHALL expose a module-level `mcp` FastMCP instance in `src/nblm_mcp_server/server.py` that is compatible with the `fastmcp` CLI (`fastmcp list`, `fastmcp run`).

#### Scenario: fastmcp CLI lists tools
- **WHEN** a developer runs `fastmcp list src/nblm_mcp_server/server.py`
- **THEN** all 5 registered MCP tools are listed without error

### Requirement: Lifespan-managed client initialization
The system SHALL use a FastMCP `lifespan` context manager in `server.py` to call `setup_client()` on startup and `teardown_client()` on shutdown.

#### Scenario: Client initialized before first tool call
- **WHEN** the server starts via any transport (HTTP, stdio, or fastmcp CLI)
- **THEN** the NotebookLM client is initialized before any tool is invoked

## MODIFIED Requirements

### Requirement: FastMCP Application Lifecycle
The system SHALL define a `FastMCP` instance as the core application.

#### Scenario: Server Startup via module
- **WHEN** the user runs `python -m nblm_mcp_server`
- **THEN** the server imports `mcp` from `server.py` and starts in HTTP mode (or stdio mode if specified), with the NotebookLM client initialized via lifespan
