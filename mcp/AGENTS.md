[English](AGENTS.md) | [中文](docs/AGENTS_zh.md)

# AGENTS.md

Welcome to the NotebooLM MCP Server project! This document outlines the core conventions, setup instructions, and architecture principles for AI agents working in this repository.

> **Important**: This project enforces strict environmental management rules. You MUST read and follow `RULES.md` before executing any commands or installing dependencies.

## Project Overview

This project is a Model Context Protocol (MCP) server built with Python (`FastMCP`) that provides AI agents with direct access to Google NotebookLM's capabilities. It allows agents to manage notebooks, add diverse sources (URLs, YouTube, text), and conduct RAG-based Q&A with citations.

This project is fully base on [notebooklm-py](https://github.com/teng-lin/notebooklm-py.git) to access [NotebookLM](https://blog.google/innovation-and-ai/technology/ai/notebooklm-google-ai/). 

It automatically authenticates by reading the Playwright browser storage state JSON (usually located at `~/.notebooklm/profiles/default/storage_state.json` after running `notebooklm login`). Older setups may still fall back to `~/.notebooklm/storage_state.json`. You can also override the path via `NOTEBOOKLM_STORAGE_PATH` or inject JSON directly via `NOTEBOOKLM_AUTH_JSON`.

## Setup

This project uses `uv` as the exclusive Python package manager and operates as a `uv workspace` member within the `notebooklm-py` repository.

```bash
# 1. Sync workspace dependencies (run from the repository root)
uv sync --all-packages

# 2. Authenticate
# Run the local login command to generate ~/.notebooklm/profiles/default/storage_state.json
uv run notebooklm login
```

## Development

The application can be run locally or via Docker. The configuration is loaded from the `.env` file.

**Locally (HTTP or stdio mode):**
Since this is a workspace member, you can run commands seamlessly using `uv run` from the `mcp/` directory, which automatically uses the root `.venv`.

```bash
# Using fastmcp CLI (Recommended for tools discovery and local agent use)
uv run fastmcp list src/nblm_mcp_server/server.py
uv run fastmcp run src/nblm_mcp_server/server.py

# Using python module (Starts FastMCP via HTTP or stdio)
uv run python -m nblm_mcp_server
uv run python -m nblm_mcp_server --transport stdio
```

**Using Docker Compose (Recommended for HTTP/SSE deployment):**
```bash
# Start the containers with build step
docker compose up -d --build

# View logs
docker compose logs -f nblm-mcp-server
```

## Testing

You can easily test the server tools and schemas locally using the `fastmcp` CLI:

```bash
# List all registered tools
fastmcp list src/nblm_mcp_server/server.py

# Inspect server metadata and tool schemas
fastmcp inspect src/nblm_mcp_server/server.py
```

## Code Style & Conventions

- **Layout**: The project strictly adheres to the `python-src-layout`. All core application code MUST reside inside `src/nblm_mcp_server/`, while tests belong outside in the `tests/` directory.
- **Naming**: Follow `snake_case` for variables, functions, and internal services (`_a_function` for internal async, `_function` for internal sync). Class names should be `PascalCase`.
- **Dependencies**: Never use `pip install` directly. Always use `uv pip install`. Changes to dependencies MUST be reflected in `pyproject.toml`.
- **Type Hinting**: All code should have appropriate type hints (`from __future__ import annotations`).

## Project Structure

```text
├── src/nblm_mcp_server/
│   ├── server.py         # Main FastMCP entrypoint (mcp instance & lifespan)
│   ├── tools.py          # All MCP tool definitions and registrations
│   ├── client_service.py # Singleton management for NotebookLMClient
│   └── __main__.py       # CLI wrapper for starting the server
├── openspec/             # SDD OpenSpec files
├── pyproject.toml        # Project metadata and dependencies
└── Dockerfile            # Docker configuration for HTTP/SSE deployment
```

## Security Notes

- **Secrets**: API Keys MUST ONLY be loaded from the `.env` file through `python-dotenv` environment variables. Do NOT hardcode API keys anywhere.
- **Committing**: Never commit the `.env` file to version control. The `.gitignore` is already configured to prevent this.

## SDD Workflow

This codebase uses the Spec-Driven workflow with `OpenSpec` for architectural planning and task execution. For example: 
- Use `/opsx-explore` to analyze ideas.
- Use `/opsx-propose` to plan new changes.
- Use `/opsx-apply` to implement approved tasks.
- Spec files are synced to `openspec/specs/` after change archival.

## Related documents

### FastMCP

This MCP server must `FastMCP` as framework:

- Official [Github repo](https://github.com/PrefectHQ/fastmcp.git)
- `FastMCP` [llms-full.txt](https://gofastmcp.com/llms-full.txt)
- `FastMCP` [llms.txt](https://gofastmcp.com/llms.txt)

### notebooklm-py

- Official [Github repo](https://github.com/teng-lin/notebooklm-py.git)