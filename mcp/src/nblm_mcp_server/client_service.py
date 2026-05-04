"""NotebookLM client service singleton.

Manages the lifecycle of a shared NotebookLMClient instance.
The client is initialized from NOTEBOOKLM_AUTH_JSON (env var) via
the notebooklm-py library's built-in precedence mechanism.
"""

from __future__ import annotations

import logging

from notebooklm import NotebookLMClient

logger = logging.getLogger(__name__)

_client: NotebookLMClient | None = None


async def get_client() -> NotebookLMClient:
    """Return the initialized, connected NotebookLMClient.

    The client is created once and reused across all tool calls.
    Authentication is loaded from NOTEBOOKLM_AUTH_JSON environment variable
    (set this via .env or Docker environment injection).

    Raises:
        RuntimeError: If the client has not been initialized via setup_client().
    """
    if _client is None:
        raise RuntimeError(
            "NotebookLM client is not initialized. "
            "Ensure setup_client() was called at server startup."
        )
    return _client


async def setup_client() -> None:
    """Initialize and open the NotebookLM client.

    Reads authentication from NOTEBOOKLM_AUTH_JSON or NOTEBOOKLM_STORAGE_PATH.
    If NOTEBOOKLM_AUTH_JSON is set but empty, it is removed so that notebooklm-py
    can fall back to the local storage file.

    The default lookup path is profile-based (typically ~/.notebooklm/profiles/default/storage_state.json), with a legacy fallback to ~/.notebooklm/storage_state.json for older setups.

    Must be called once at server startup before any tools are invoked.
    """
    global _client
    import os

    auth_json = os.environ.get("NOTEBOOKLM_AUTH_JSON", "").strip()
    if not auth_json:
        # Unset so notebooklm-py falls back to local storage file instead of
        # raising "variable is set but empty".
        os.environ.pop("NOTEBOOKLM_AUTH_JSON", None)

    storage_path = os.environ.get("NOTEBOOKLM_STORAGE_PATH", "").strip()

    logger.info("Initializing NotebookLM client...")
    if storage_path:
        client = await NotebookLMClient.from_storage(storage_path)
    else:
        client = await NotebookLMClient.from_storage()

    await client.__aenter__()
    _client = client
    logger.info("NotebookLM client initialized successfully.")


async def teardown_client() -> None:
    """Close the NotebookLM client connection."""
    global _client
    if _client is not None:
        await _client.__aexit__(None, None, None)
        _client = None
        logger.info("NotebookLM client closed.")
