[English](README.md) | [中文](docs/README_zh.md)

# NotebookLM MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI agents with direct access to Google NotebookLM's capabilities. 

This project allows agents to seamlessly manage NotebookLM notebooks, add diverse sources (URLs, YouTube videos, raw text), and conduct RAG-based Q&A with citations, empowering AI assistants to act as autonomous research agents.

## 🚀 Powered by `notebooklm-py`

This MCP server is built on top of the excellent **[`notebooklm-py`](https://github.com/teng-lin/notebooklm-py.git)** library, which provides the core API interactions with Google NotebookLM. We heavily rely on its robust client implementation to provide these MCP tools.

## 🛠️ Features

Currently, this MCP server exposes the following tools to AI agents:

**Notebook Management:**
- `list_notebooks`: List all available notebooks.
- `create_notebook`: Create a new notebook.
- `delete_notebook`: Delete an existing notebook.

**Source Management:**
- `list_sources`: List all sources within a specific notebook.
- `add_source`: Add a URL (webpage) as a source and return structured status fields.
- `add_youtube_source`: Add a YouTube video as a source and return structured status fields.
- `add_text_source`: Add raw pasted text as a source and return structured status fields.
- `get_source_status`: Inspect the indexing status of a single source.
- `wait_for_source`: Wait for a single source to finish indexing.
- `delete_source`: Delete a source from a notebook.
- `get_source_fulltext`: Retrieve the full indexed raw text of a source.

**Chat & Interaction:**
- `ask_notebook`: Ask questions to a notebook and receive answers with citations. Supports scoping by `source_ids` and continuing conversations via `conversation_id`.
- `get_chat_history`: Retrieve the history of a specific conversation.
- `save_chat_note`: Save generated text or insights as a persistent note inside the notebook.

**Research Workflow:**
- `start_research`: Start a fast or deep NotebookLM research task against web or Drive sources.
- `get_research_status`: Poll the latest research status or inspect a specific research task.
- `wait_for_research`: Wait for a research task to complete and optionally auto-import all discovered sources.
- `import_research_sources`: Import research result entries into the notebook as standard sources.

## ⚙️ Installation & Setup

This project is a `uv workspace` member of the `notebooklm-py` repository.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/teng-lin/notebooklm-py.git
   cd notebooklm-py
   ```

2. **Sync workspace dependencies:**
   ```bash
   uv sync --all-packages
   ```

3. **Environment Variables:**
   The server authenticates via Playwright's browser storage state. 
   First, login locally:
   ```bash
   uv run notebooklm login
   ```
   This usually saves your session to `~/.notebooklm/profiles/default/storage_state.json`. By default, the server will automatically find this file, while still supporting the legacy `~/.notebooklm/storage_state.json` fallback.
   If you need to customize settings, you can copy the env example in the `mcp/` directory:
   ```bash
   cd mcp
   cp .env.example .env
   ```

## 🏃 Running the Server

### For Local AI Agents (Claude Desktop, Cursor, etc.)

We use `FastMCP` as the server framework. Since this is a workspace member, you can run commands seamlessly using `uv run`. 

From the `mcp/` directory:
```bash
# Verify the tools are loaded correctly
uv run fastmcp list src/nblm_mcp_server/server.py

# Run via stdio (typically configured in your MCP client settings)
uv run fastmcp run src/nblm_mcp_server/server.py
```

Alternatively, you can run it as a standard Python module from the `mcp/` directory:
```bash
uv run python -m nblm_mcp_server --transport stdio
```

### Docker (HTTP/SSE Deployment)

If you want to deploy the server via HTTP/SSE:

```bash
docker compose up -d --build
```

## 🗺️ Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned future features, including deep research agent integration and multi-media content generation (Podcasts, Slides).

## 📝 Developer Guidelines

For AI coding agents working on this project, please refer to [AGENTS.md](./AGENTS.md) and [RULES.md](./RULES.md) for architectural boundaries, setup instructions, and code conventions.
