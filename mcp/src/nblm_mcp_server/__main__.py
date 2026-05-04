"""Main entrypoint for the NotebookLM MCP Server.

Usage:
    python -m nblm_mcp_server                      # HTTP mode (default)
    python -m nblm_mcp_server --transport stdio    # stdio mode

Environment Variables:
    NOTEBOOKLM_AUTH_JSON  Optional. Playwright storage state JSON containing
                          Google auth cookies. By default, the server reads the
                          profile-based path created by `notebooklm login`
                          (typically ~/.notebooklm/profiles/default/storage_state.json),
                          while remaining compatible with the legacy
                          ~/.notebooklm/storage_state.json fallback. Use this
                          env var only if you need to inject the JSON directly.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from dotenv import load_dotenv

from .server import mcp

logger = logging.getLogger(__name__)


async def _run_async(transport: str, host: str, port: int) -> None:
    """Main async entry point: run the server (client lifecycle managed by lifespan)."""
    load_dotenv()

    if transport == "stdio":
        logger.info("Starting MCP server in stdio mode")
        await mcp.run_async(transport="stdio")
    else:
        logger.info("Starting MCP server in HTTP mode on %s:%d", host, port)
        await mcp.run_async(transport="streamable-http", host=host, port=port)


def main() -> None:
    """Parse CLI args and run the server."""
    parser = argparse.ArgumentParser(
        description="NotebookLM MCP Server",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--transport",
        choices=["http", "stdio"],
        default="http",
        help="Transport mode: 'http' for Streamable HTTP, 'stdio' for direct MCP client use.",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind the HTTP server to.")
    parser.add_argument("--port", type=int, default=8089, help="Port for the HTTP server.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        asyncio.run(_run_async(args.transport, args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Server stopped.")


if __name__ == "__main__":
    main()
