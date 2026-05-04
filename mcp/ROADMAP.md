[English](ROADMAP.md) | [中文](docs/ROADMAP_zh.md)

# NotebookLM MCP Server Roadmap

This document outlines the currently implemented features of `notebooklm-mcp-server` and plans future extensions based on the capabilities of `notebooklm-py`.

## 🟢 Phase 1: Basic Core (Implemented)

The MCP Server currently has the fundamental capabilities to interact with NotebookLM:

- **Notebook Management**
  - [x] List all Notebooks (`list_notebooks`)
  - [x] Create a new Notebook (`create_notebook`)
- **Source Management**
  - [x] Add source via URL (`add_source`)
  - [x] List sources in a Notebook (`list_sources`)
- **Chat Interaction**
  - [x] Ask questions based on a Notebook and return citation info (`ask_notebook`)

---

## 🟡 Phase 2: Advanced Resource & Chat Management (Implemented)

Expand granular control over chat and resources, allowing AI Agents to interact with Notebooks more flexibly.

### Resource Management Expansion
- [x] **Delete Resources**: Provide tools to delete a Notebook or specific sources.
- [x] **Get Source Status / Wait** (`get_source_status`, `wait_for_source`): Allow Agents to inspect a single source's indexing state or wait for it to become ready after asynchronous imports.
- [x] **Get Source Fulltext** (`get_source_fulltext`): Allow Agents to directly read the complete plain text content of a source after system indexing, which is highly useful for local analysis.
- [x] **Multiple Source Types Import**:
  - [x] Support adding YouTube videos as sources.
  - [x] Support creating sources directly from plain text (Pasted Text).
  - [ ] (Optional) Support uploading local files or Google Drive files.

### Chat Control Expansion
- [x] **Scope Chat to Specific Sources**: Expand `ask_notebook` parameters to restrict retrieval and chat to specific Source IDs.
- [x] **Chat History Management**:
  - [x] Retrieve past chat history.
  - [x] Support passing `conversation_id` to continue previous chat context.
- [x] **Note Management**: Add a tool to save specific answers as internal Notes in the Notebook.

---

## 🔵 Phase 3: Research Agent Integration (Implemented)

Introduce NotebookLM's powerful built-in research capabilities.

- [x] **Trigger Research** (`start_research`): The MCP Server can call the NotebookLM research agent in `fast` or `deep` mode against Web or Google Drive sources.
- [x] **Query / Wait for Research Status** (`get_research_status`, `wait_for_research`): Agents can poll the latest status or block until a research task finishes.
- [x] **Auto-import Research Results** (`import_research_sources`, `wait_for_research(import_all=True)`): Research outputs can be converted into Notebook sources after completion.
- *Note: Research remains a long-running operation, but the MCP layer now exposes both non-blocking status checks and a blocking wait helper.*

---

## 🟣 Phase 4: Content Generation & Export (Long-term Plan)

Unlock the full multimedia generation capabilities of NotebookLM Studio. This allows AI Agents to "produce final deliverables".

### Generation Trigger Tools
- [ ] **Audio/Podcast Generation** (`generate_audio_overview`)
- [ ] **Slide Generation** (`generate_slides`)
- [ ] **Quiz & Flashcard Generation** (`generate_quiz`, `generate_flashcards`)
- [ ] **Document & Chart Generation** (Report, Data Table, Mind Map)
- [ ] **Global Language Setting** (`set_output_language`): Control the generation language.

### Export & Download Tools
- [ ] **Download Multimedia Artifacts**: Support downloading generated `.mp3`, `.mp4`, `.pptx` back to the local machine.
- [ ] **Get Structured Data**: Directly return generated JSON (e.g., quiz data, mind map structure) or CSV (data tables) for further Agent processing.

---

## 💡 Architecture & Deployment Optimization

- [x] Docker Deployment Support
- [ ] **Token & Auth Auto-refresh**: Explore mechanisms to handle Session expiration or re-authentication in long-running Docker containers.
- [ ] **Concurrency & Queueing Mechanism**: If time-consuming generation tasks are supported in the future, consider adding a simple task queue state management.
