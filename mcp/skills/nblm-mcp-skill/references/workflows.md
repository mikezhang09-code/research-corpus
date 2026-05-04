# NotebookLM MCP Workflows & Best Practices

## Tool Usage Guide

### `ask_notebook`
This is your primary tool for extracting knowledge once the notebook already has ready sources.
- **Parameters**:
  - `notebook_id` (required): The ID of the target notebook.
  - `query` (required): Your question or instruction.
  - `conversation_id` (optional): To maintain conversation history, always pass this if you are continuing a multi-turn interaction.
  - `source_ids` (optional): A list of source IDs if you want NotebookLM to only consult specific documents.
- **Output**: Returns the text response along with citations. Always surface the citations in your final response to the user to build trust.

### Source Management
When adding sources, be mindful of the content type:
- `add_source`: Best for static web pages and articles.
- `add_youtube_source`: Extracts transcripts from YouTube. Extremely useful for video research.
- `add_text_source`: Use this if you have raw text to inject directly.

The source-creation tools now return structured status fields such as:
- `status_code`
- `status`
- `is_ready`
- `is_processing`
- `is_error`

For simple single-source workflows, `wait=True` is usually enough. For asynchronous, batched, or handoff workflows, prefer:
1. add with `wait=False`
2. keep the returned `source_id`
3. call `get_source_status` or `wait_for_source`

After sources are ready, you can use `get_source_fulltext` to retrieve the processed raw text if you need client-side analysis that NotebookLM chat might miss.

### Research Workflow
Use NotebookLM research tools when the user wants NotebookLM to discover sources by itself.

Recommended sequence:
1. `start_research`
2. `get_research_status` for polling, or `wait_for_research` for blocking wait
3. `import_research_sources` to bring discovered sources into the notebook
4. `ask_notebook` to query the imported material

If you want the MCP server to finish the whole research-to-import workflow in one blocking step, use `wait_for_research(import_all=True)`.

### State Management
NotebookLM's MCP server operates statelessly from your perspective, but maintains state via Notebook and Conversation IDs.
- **Always keep track of the `notebook_id`** during a session.
- **Always keep track of the `conversation_id`** if the user is asking follow-up questions.
- **Keep the `source_id`** when you add sources asynchronously.
- **Keep the `task_id`** when you start research or want to wait for a specific research task.

## Example Flow: Add Sources Then Ask

1. User: "Can you summarize the latest news about AI from these two URLs?"
2. Agent uses `create_notebook(title="AI News Research")` -> gets `notebook_id: "123"`
3. Agent uses `add_source(notebook_id="123", url="...")` for URL 1.
4. Agent uses `add_source(notebook_id="123", url="...")` for URL 2.
5. Agent uses `ask_notebook(notebook_id="123", query="Summarize the latest news from the sources")` -> gets response and `conversation_id: "abc"`
6. Agent presents summary to user.
7. User: "What did the first article say about model sizes?"
8. Agent uses `ask_notebook(notebook_id="123", query="What did the first article say about model sizes?", conversation_id="abc")`

## Example Flow: Async Source Handoff

1. Agent uses `add_youtube_source(notebook_id="123", youtube_url="...", wait=False)`.
2. Agent stores the returned `source_id`.
3. A follow-up agent calls `wait_for_source(notebook_id="123", source_id="src_001")`.
4. Once the source is ready, the agent continues with `ask_notebook` or `get_source_fulltext`.

## Example Flow: Research Then Import

1. Agent uses `start_research(notebook_id="123", query="latest AI safety policy updates", mode="fast")` -> gets `task_id`.
2. Agent uses `wait_for_research(notebook_id="123", task_id="task_001")`.
3. Agent uses `import_research_sources(notebook_id="123", task_id="task_001", sources=[...])`, or uses `wait_for_research(..., import_all=True)` if full import is desired.
4. Agent uses `ask_notebook` after the sources are available in the notebook.
