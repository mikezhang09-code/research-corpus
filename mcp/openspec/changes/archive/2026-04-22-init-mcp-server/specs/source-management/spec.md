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
