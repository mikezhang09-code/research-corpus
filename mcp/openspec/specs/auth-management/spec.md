## ADDED Requirements

### Requirement: JSON-based Authentication Configuration
The system SHALL use the `NOTEBOOKLM_AUTH_JSON` environment variable to authenticate the `notebooklm-py` client.

#### Scenario: Successful Client Initialization
- **WHEN** `NOTEBOOKLM_AUTH_JSON` is provided with valid cookies
- **THEN** the `NotebookLMClient` initializes without opening a browser
