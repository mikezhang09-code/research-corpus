## Context

The initial MCP server implementation covers basic NotebookLM workflows (listing/creating notebooks, adding URLs, asking questions). To act as a fully autonomous research agent, clients need granular control over the notebook contents and chat context. `notebooklm-py` already supports these operations (deleting resources, getting fulltext, adding different source types, scoping queries by source, saving notes). We need to expose these through new or updated MCP tools.

## Goals / Non-Goals

**Goals:**
- Provide tools to delete notebooks and sources (`delete_notebook`, `delete_source`).
- Provide a tool to extract the indexed full text of a source (`get_source_fulltext`).
- Provide tools for adding YouTube videos (`add_youtube_source`) and pasted text (`add_text_source`).
- Enhance the `ask_notebook` tool to accept optional `source_ids` and `conversation_id`.
- Add tools for retrieving chat history (`get_chat_history`) and saving notes (`save_chat_note`).

**Non-Goals:**
- File uploads (PDF/Docs) and Google Drive integrations are out of scope for this immediate change, as they involve file transfer logistics over the MCP protocol which requires careful design. We will focus on URL/text-based sources first.
- Complex research agents (Deep/Fast mode) will be handled in a separate "Phase 3" change.

## Decisions

- **Modifying `ask_notebook` vs New Tool**: Instead of creating `ask_notebook_with_sources`, we will add optional parameters `source_ids: list[str]` and `conversation_id: str` to the existing `ask_notebook` tool. FastMCP supports optional typed parameters, making this backward compatible and cleaner.
- **Separate Add Source Tools**: We will create `add_youtube_source` and `add_text_source` as distinct tools rather than overloading `add_source`. This provides clearer schemas (e.g., `add_text_source` needs a `text` parameter, not a `url`) and better LLM understanding.
- **Fulltext extraction**: `get_source_fulltext` will just return the raw string. This might be long, so MCP clients must be able to handle large text outputs.

## Risks / Trade-offs

- **Risk: Large fulltext responses** → Mitigation: MCP protocol can handle reasonably large text payloads. The `notebooklm-py` client handles pagination if necessary internally.
- **Risk: Deleting active resources** → Mitigation: Tools will be documented to require explicit user intent for deletion.
