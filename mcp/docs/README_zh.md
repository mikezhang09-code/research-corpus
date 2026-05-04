[English](../README.md) | [中文](README_zh.md)

# NotebookLM MCP Server

這是一個 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 伺服器，讓 AI Agent 能夠直接使用 Google NotebookLM 的強大功能。

透過此專案，AI Agent 可以無縫管理 NotebookLM 的筆記本 (notebooks)、新增多種來源 (URLs、YouTube 影片、純文字)，並進行基於 RAG (Retrieval-Augmented Generation) 的問答及引用，使 AI 助理能成為自動化的研究探員。

## 🚀 基於 `notebooklm-py` 開發

這個 MCP 伺服器建構於出色的 **[`notebooklm-py`](https://github.com/teng-lin/notebooklm-py.git)** 函式庫之上，該函式庫提供了與 Google NotebookLM 互動的核心 API。我們主要仰賴其穩定的客戶端實作來提供這些 MCP 工具。

## 🛠️ 功能特色

目前，此 MCP 伺服器為 AI Agent 提供以下工具：

**Notebook 管理：**
- `list_notebooks`：列出所有可用的筆記本。
- `create_notebook`：建立新的筆記本。
- `delete_notebook`：刪除現有的筆記本。

**來源 (Source) 管理：**
- `list_sources`：列出特定筆記本內的所有來源。
- `add_source`：新增 URL (網頁) 作為來源，並回傳結構化狀態欄位。
- `add_youtube_source`：新增 YouTube 影片作為來源，並回傳結構化狀態欄位。
- `add_text_source`：新增純文字內容作為來源，並回傳結構化狀態欄位。
- `get_source_status`：查詢單一 source 的 indexing 狀態。
- `wait_for_source`：等待單一 source 完成 indexing。
- `delete_source`：從筆記本中刪除來源。
- `get_source_fulltext`：取得來源經過索引後的完整純文字內容。

**對話與互動：**
- `ask_notebook`：向筆記本提問並獲取帶有引用的答案。支援透過 `source_ids` 限定特定來源，以及透過 `conversation_id` 延續對話。
- `get_chat_history`：取得特定對話的歷史紀錄。
- `save_chat_note`：將生成的文字或見解儲存為筆記本內的永久筆記 (note)。

**研究工作流：**
- `start_research`：啟動 NotebookLM 的 fast 或 deep research 任務，支援 Web 與 Drive 來源。
- `get_research_status`：查詢最新 research 狀態，或指定 task 的執行結果。
- `wait_for_research`：等待 research 完成，並可選擇自動匯入所有研究結果。
- `import_research_sources`：將 research 結果項目匯入 notebook，轉成一般 sources。

## ⚙️ 安裝與設定

本專案是 `notebooklm-py` 原始碼庫的一個 `uv workspace` 成員。

1. **複製原始碼：**
   ```bash
   git clone https://github.com/teng-lin/notebooklm-py.git
   cd notebooklm-py
   ```

2. **同步 workspace 依賴套件：**
   ```bash
   uv sync --all-packages
   ```

3. **環境變數：**
   伺服器會透過 Playwright 的瀏覽器儲存狀態進行認證。
   首先，在本地進行登入：
   ```bash
   uv run notebooklm login
   ```
   這通常會將你的登入階段儲存至 `~/.notebooklm/profiles/default/storage_state.json`。預設情況下，伺服器會自動讀取此檔案，同時仍相容於舊版 `~/.notebooklm/storage_state.json` 的 fallback。
   如果你需要客製化設定，可以複製 `mcp/` 目錄下的範例環境變數檔：
   ```bash
   cd mcp
   cp .env.example .env
   ```

## 🏃 啟動伺服器

### 供本地 AI Agent 使用 (Claude Desktop, Cursor 等)

我們使用 `FastMCP` 作為伺服器框架。因為這是 workspace 成員，你可以使用 `uv run` 無縫執行指令。

在 `mcp/` 目錄下：
```bash
# 確認工具皆有正確載入
uv run fastmcp list src/nblm_mcp_server/server.py

# 透過 stdio 執行 (通常在你的 MCP 客戶端設定中配置)
uv run fastmcp run src/nblm_mcp_server/server.py
```

或者，你也可以把它當作標準的 Python 模組從 `mcp/` 目錄執行：
```bash
uv run python -m nblm_mcp_server --transport stdio
```

### Docker (HTTP/SSE 部署)

如果你希望透過 HTTP/SSE 部署伺服器：

```bash
docker compose up -d --build
```

## 🗺️ 開發藍圖

請參考 [ROADMAP.md](../ROADMAP.md) 了解計畫中的未來功能，包含深度研究探員整合以及多媒體內容生成 (Podcast、簡報等)。

## 📝 開發者指南

如果你是協助開發此專案的 AI Coding Agent，請參閱 [AGENTS.md](../AGENTS.md) 與 [RULES.md](../RULES.md) 以了解架構邊界、設定指令與程式碼規範。
