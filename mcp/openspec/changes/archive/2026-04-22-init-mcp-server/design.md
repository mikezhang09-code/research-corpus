## Context

This project introduces a new MCP Server that bridges AI agents to Google's NotebookLM. Currently, NotebookLM lacks an official MCP interface. By utilizing the community library `notebooklm-py`, we can programmatically control NotebookLM. This first milestone (`init-mcp-server`) focuses on setting up the foundation, managing authentication without Playwright, and wrapping core features into MCP tools using `FastMCP`.

## Goals / Non-Goals

**Goals:**
- Provide a robust Python FastMCP server layout.
- Authenticate to NotebookLM via the `NOTEBOOKLM_AUTH_JSON` environment variable to easily run inside Docker.
- Expose basic MCP tools: notebook listing/creation, source addition, and simple Q&A chat.

**Non-Goals:**
- Interactive Playwright-based browser login within the MCP Server. (Authentication state must be acquired externally and passed as JSON).
- Advanced content generation artifacts (Audio, Video, Quiz, etc.) - these will be added in future milestones.

## Decisions

- **Framework**: Use `FastMCP` because it simplifies routing, type safety, and MCP protocol handling compared to raw SDK implementation.
- **Dependency Management**: Use `uv` exclusively for speed and strict environment isolation as dictated by `AGENTS.md`.
- **Authentication Strategy**: Pass cookies directly via `NOTEBOOKLM_AUTH_JSON`. `notebooklm-py` supports this natively, which completely avoids the need for Chromium/Playwright inside the Docker image, drastically reducing image size and complexity.
- **Client Instance Lifecycle**: We will initialize a single asynchronous `NotebookLMClient` that reads the auth config at startup and shares the session across tool calls to avoid repeated cold starts.

## Risks / Trade-offs

- **Risk: Cookie Expiration** → Google session cookies expire over time (weeks/months). *Mitigation*: The user will need to re-authenticate locally and update the `NOTEBOOKLM_AUTH_JSON` environment variable when this occurs.
- **Risk: Unofficial APIs** → `notebooklm-py` uses undocumented endpoints that may break. *Mitigation*: Gracefully handle API errors and return clear error messages to the MCP client.
