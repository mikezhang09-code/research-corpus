## Why

The current MCP server provides basic capabilities to list and create notebooks, add URL sources, and ask general questions. To enable more sophisticated AI agent workflows (Phase 2 of the Roadmap), we need advanced resource management (deleting resources, retrieving full text, supporting diverse source types like YouTube and text) and enhanced chat controls (scoping chats to specific sources, managing history, and saving notes). This will allow agents to dynamically curate the notebook's knowledge base and conduct targeted research.

## What Changes

- Add tools to delete notebooks (`delete_notebook`) and sources (`delete_source`).
- Add a tool to retrieve the full indexed text of a source (`get_source_fulltext`).
- Add tools to import YouTube videos (`add_youtube_source`) and pasted text (`add_text_source`).
- Enhance chat interactions by adding tools/parameters for querying specific sources, retrieving conversation history (`get_chat_history`), and saving chat responses as notes (`save_chat_note`).

## Capabilities

### New Capabilities
- `chat-history`: Manage conversation history and save chat responses as notes.

### Modified Capabilities
- `notebook-management`: Add requirement for deleting notebooks.
- `source-management`: Add requirements for deleting sources, fetching source fulltext, and adding YouTube/Text sources.
- `chat-interaction`: Add requirement for scoping queries to specific source IDs and continuing conversations.

## Impact

- **Code**: Adds new tools in `src/nblm_mcp_server/tools.py`.
- **APIs**: Exposes 6+ new MCP tools to the clients.
- **Dependencies**: Relies on existing `notebooklm-py` capabilities.
