## Why

NotebookLM offers powerful capabilities for research and content generation, but currently lacks an official MCP (Model Context Protocol) integration for AI agents to interact with it programmatically. This project aims to bridge that gap by building a Python-based MCP server using `FastMCP` and `notebooklm-py`. As the initial milestone (`init-mcp-server`), we need to establish the basic server architecture, handle authentication securely, and expose fundamental NotebookLM operations (notebook management, source addition, and basic chat) as MCP tools.

## What Changes

- Initialize a Python project using `uv` and `python-src-layout` with `FastMCP` as the framework.
- Configure secure Google NotebookLM authentication through the `NOTEBOOKLM_AUTH_JSON` environment variable to support headless and containerized execution without Playwright.
- Implement fundamental MCP tools for NotebookLM:
  - List available notebooks.
  - Create new notebooks.
  - Add sources (URLs, text files, etc.) to a notebook.
  - Ask questions against sources in a notebook (Chat).
- Set up Docker configurations (`Dockerfile`, `docker-compose.yml`) for seamless deployment.

## Capabilities

### New Capabilities
- `mcp-server-core`: The base FastMCP server setup, execution modes (HTTP/stdio), and unified error handling.
- `auth-management`: Managing NotebookLM session state robustly via the `NOTEBOOKLM_AUTH_JSON` environment variable.
- `notebook-management`: MCP tools for listing and creating NotebookLM notebooks.
- `source-management`: MCP tools for adding and managing sources within a notebook.
- `chat-interaction`: MCP tools for sending queries to NotebookLM and retrieving answers.

### Modified Capabilities

## Impact

- **Code/Architecture**: Establishes the foundational Python application structure (`src/nblm_mcp_server/`).
- **Dependencies**: Introduces `mcp`, `fastmcp`, `notebooklm-py`, `python-dotenv`, and server utilities.
- **Systems**: Prepares the server for integration with any standard MCP client (e.g., Claude), unlocking programmatic access to NotebookLM.
