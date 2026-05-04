## ADDED Requirements

### Requirement: Add Source Tool
The system SHALL provide an MCP tool `add_source` to add a URL or file to a specific notebook.

#### Scenario: User adds a URL source
- **WHEN** the `add_source` tool is invoked with a `notebook_id` and a URL
- **THEN** the system adds the source to the notebook and waits for processing to complete

### Requirement: List Sources Tool
The system SHALL provide an MCP tool `list_sources` to retrieve sources in a notebook.

#### Scenario: User lists sources
- **WHEN** the `list_sources` tool is invoked with a `notebook_id`
- **THEN** the tool returns a list of sources and their statuses

### Requirement: Delete Source Tool
The system SHALL provide an MCP tool `delete_source` to remove a source from a notebook.

#### Scenario: User deletes a source
- **WHEN** the `delete_source` tool is invoked with a `notebook_id` and `source_id`
- **THEN** the system removes the source from the notebook

### Requirement: Get Source Fulltext Tool
The system SHALL provide an MCP tool `get_source_fulltext` to retrieve the indexed text of a source.

#### Scenario: User requests full text
- **WHEN** the `get_source_fulltext` tool is invoked with a `notebook_id` and `source_id`
- **THEN** the system returns the complete parsed text of the source

### Requirement: Add YouTube Source Tool
The system SHALL provide an MCP tool `add_youtube_source` to add a YouTube video to a notebook.

#### Scenario: User adds YouTube video
- **WHEN** the `add_youtube_source` tool is invoked with a `notebook_id` and `youtube_url`
- **THEN** the system imports the YouTube video and its transcript

### Requirement: Add Text Source Tool
The system SHALL provide an MCP tool `add_text_source` to add raw pasted text as a source.

#### Scenario: User adds raw text
- **WHEN** the `add_text_source` tool is invoked with a `notebook_id`, `title`, and `text`
- **THEN** the system creates a new text source with the provided content

