## ADDED Requirements

### Requirement: Chat History Tool
The system SHALL provide an MCP tool `get_chat_history` to retrieve the conversation history of a specific notebook.

#### Scenario: User gets chat history
- **WHEN** the `get_chat_history` tool is invoked with a `notebook_id`
- **THEN** the tool returns a list of past conversations and their IDs

### Requirement: Save Chat Note Tool
The system SHALL provide an MCP tool `save_chat_note` to save a chat response as a note in the notebook.

#### Scenario: User saves a note
- **WHEN** the `save_chat_note` tool is invoked with a `notebook_id`, `conversation_id`, and `reply_id` (or appropriate note content parameters depending on API)
- **THEN** the system creates a note inside the notebook with the content
