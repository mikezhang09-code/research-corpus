"""FastMCP server definition for the NotebookLM MCP Server.

Exposes a module-level `mcp` instance compatible with the `fastmcp` CLI:
    fastmcp list src/nblm_mcp_server/server.py
    fastmcp run src/nblm_mcp_server/server.py

The NotebookLM client is managed via a lifespan context manager,
ensuring it is properly initialized before any tool is invoked and
cleanly closed on server shutdown—regardless of how the server is started.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastmcp import FastMCP

from nblm_mcp_server import tools

# Use absolute imports so this file can be exec'd directly by the fastmcp CLI.
# The package must be installed (editable: `uv pip install -e .`) for this to work.
from nblm_mcp_server.client_service import setup_client, teardown_client


@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[None]:
    """Initialize and tear down the NotebookLM client around the server lifetime."""
    await setup_client()
    try:
        yield
    finally:
        await teardown_client()


mcp = FastMCP(
    name="NotebookLM MCP Server",
    instructions=(
        "This server provides programmatic access to Google NotebookLM. "
        "You can list and create notebooks, add sources, and chat with notebook content."
    ),
    lifespan=_lifespan,
)

tools.register(mcp)
