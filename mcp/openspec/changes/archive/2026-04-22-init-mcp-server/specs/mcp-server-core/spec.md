## ADDED Requirements

### Requirement: FastMCP Application Lifecycle
The system SHALL define a `FastMCP` instance as the core application.

#### Scenario: Server Startup
- **WHEN** the user runs `python -m nblm_mcp_server`
- **THEN** the FastMCP server starts in HTTP mode (or stdio mode if specified)
