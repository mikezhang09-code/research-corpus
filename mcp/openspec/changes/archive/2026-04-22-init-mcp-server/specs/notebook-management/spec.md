## ADDED Requirements

### Requirement: List Notebooks Tool
The system SHALL provide an MCP tool `list_notebooks` to retrieve all available notebooks.

#### Scenario: User lists notebooks
- **WHEN** the `list_notebooks` tool is invoked
- **THEN** the tool returns a JSON list of notebook IDs and titles

### Requirement: Create Notebook Tool
The system SHALL provide an MCP tool `create_notebook` to create a new notebook by title.

#### Scenario: User creates notebook
- **WHEN** the `create_notebook` tool is invoked with a `title`
- **THEN** the system creates a notebook and returns its ID
