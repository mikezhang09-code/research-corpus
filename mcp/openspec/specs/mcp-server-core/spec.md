## ADDED Requirements

### Requirement: FastMCP Application Lifecycle
The system SHALL define a `FastMCP` instance as the core application.

#### Scenario: Server Startup via module
- **WHEN** the user runs `python -m nblm_mcp_server`
- **THEN** the server imports `mcp` from `server.py` and starts in HTTP mode (or stdio mode if specified), with the NotebookLM client initialized via lifespan
