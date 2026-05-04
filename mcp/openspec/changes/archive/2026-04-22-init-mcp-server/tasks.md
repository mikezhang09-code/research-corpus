## 1. Project Initialization

- [x] 1.1 Create `pyproject.toml` and initialize the project with `uv`
- [x] 1.2 Setup `python-src-layout` directory structure (`src/nblm_mcp_server/` and `tests/`)
- [x] 1.3 Add required dependencies (`fastmcp`, `notebooklm-py`, `python-dotenv`)

## 2. Server Core & Authentication Setup

- [x] 2.1 Implement the main entrypoint (`src/nblm_mcp_server/__main__.py`) and FastMCP server instance
- [x] 2.2 Implement environment variable loading for `NOTEBOOKLM_AUTH_JSON` using `python-dotenv`
- [x] 2.3 Create a NotebookLM client service that initializes with the auth JSON upon server startup

## 3. Notebook Management Tools

- [x] 3.1 Implement `list_notebooks` MCP tool logic using `client.notebooks.list()`
- [x] 3.2 Implement `create_notebook` MCP tool logic using `client.notebooks.create()`

## 4. Source Management Tools

- [x] 4.1 Implement `add_source` MCP tool to accept a URL and add it to the notebook (`client.sources.add_url()`)
- [x] 4.2 Implement `list_sources` MCP tool logic using `client.sources.list()`

## 5. Chat Interaction Tool

- [x] 5.1 Implement `ask_notebook` MCP tool using `client.chat.ask()`
- [x] 5.2 Format the chat response to include the text answer and citations

## 6. Docker Configuration

- [x] 6.1 Create `Dockerfile` for the MCP server
- [x] 6.2 Create `docker-compose.yml` defining the service and environment variable injection
