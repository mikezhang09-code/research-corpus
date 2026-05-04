---
name: nblm-mcp-skill
description: Comprehensive guide for AI Agents to effectively interact with the Google NotebookLM MCP server. Use this skill when the user asks to research topics, manage notebooks, add sources (URLs, YouTube, text), wait for source indexing, run NotebookLM research workflows, or extract insights using MCP tools.
---

# NotebookLM MCP Skill

## Overview

This skill guides you (the AI Agent) on how to effectively orchestrate the NotebookLM MCP tools to act as an advanced research assistant. You will learn the required workflows to create notebooks, add diverse sources, wait for source indexing when needed, run NotebookLM research tasks, import research results, and perform RAG-based interactions with citation support.

## Authentication & Setup Verification

The NotebookLM MCP server relies on Playwright browser storage state for authentication. Before using the tools or starting the server, you **MUST** ensure the environment is authenticated.

1. **Check Authentication Status**:
   - Check if `~/.notebooklm/profiles/default/storage_state.json` exists, OR
   - Run `uv run notebooklm status` from the workspace root (it should show "Authenticated as...").

2. **Login if Necessary**:
   If the environment is not authenticated, you must prompt the user to log in by running:
   ```bash
   uv run notebooklm login
   ```
   *(If using standard Python `venv`, ensure the environment is activated and run `notebooklm login`)*.
   
   This will usually save the session to `~/.notebooklm/profiles/default/storage_state.json`, which the MCP server automatically reads. Legacy setups may still use `~/.notebooklm/storage_state.json` as a fallback.

## Starting the MCP Server

If the user asks you to start, restart, or run the NotebookLM MCP server, you can do so from the root of the `notebooklm-py` workspace. 

By default, the server runs using HTTP/SSE transport on port `8089`. Once running, MCP clients can connect to it via `http://localhost:8089/mcp`.

**Option A: Using `uv` (Recommended)**
```bash
uv sync --all-packages
uv run python -m nblm_mcp_server
```

**Option B: Using standard Python (`venv`)**
If the user's environment does not have `uv`, you can use standard Python to create a virtual environment and start the server:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[browser]"
pip install -e ./mcp
python -m nblm_mcp_server
```

## Required Workflows

When a user asks you to research a topic or use NotebookLM, follow these steps:

### 1. Initialization and Context
- If the user doesn't specify a notebook, use `list_notebooks` to see if a relevant one exists.
- If not, use `create_notebook` to make a new one for the research topic.

### 2. Source Ingestion Workflow
- Add web pages with `add_source`, YouTube videos with `add_youtube_source`, and raw text with `add_text_source`.
- For simple one-off ingestion, `wait=True` is fine.
- For async or batched workflows, prefer `wait=False`, then use `get_source_status` or `wait_for_source` on the returned `source_id`.
- Use `list_sources` to retrieve `source_id`s if you need to scope later questions to specific sources.

### 3. NotebookLM Research Workflow
- Use `start_research` when the user wants NotebookLM to discover sources from the web or Drive on its own.
- Use `get_research_status` for non-blocking polling.
- Use `wait_for_research` when you want the MCP server to block until the research task is done.
- If the user wants the discovered sources available inside the notebook, use `import_research_sources`, or `wait_for_research(import_all=True)`.

### 4. Q&A and Follow-up Interaction
- Use `ask_notebook` to query the notebook after sources are ready or research results have been imported.
- **IMPORTANT**: If continuing a conversation, you MUST pass the `conversation_id` returned from the previous `ask_notebook` call.
- Provide citations to the user based on the tool's output.

## Detailed Workflows & Tool Guidelines

For complete examples, best practices, and edge-case handling, you **MUST** read [references/workflows.md](references/workflows.md). It contains essential details on how to format your queries and handle NotebookLM's specific behaviors.
