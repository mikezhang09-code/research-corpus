[English](../AGENTS.md) | [中文](AGENTS_zh.md)

# AGENTS.md

歡迎來到 NotebooLM MCP Server 專案！本文件概述了在本地碼庫中運作的 AI Agent 所需遵守的核心慣例、設定指引與架構原則。

> **重要**：本專案執行嚴格的環境管理規範。在執行任何指令或安裝套件前，你**必須**閱讀並遵守 `RULES.md`。

## 專案概述

這是一個以 Python (`FastMCP`) 建置的 Model Context Protocol (MCP) 伺服器，旨在提供 AI Agent 直接存取 Google NotebookLM 的能力。它允許 Agent 管理筆記本、新增多樣化來源 (URLs、YouTube 影片、純文字)，並進行基於 RAG 且附帶引用的問答。

本專案完全基於 [notebooklm-py](https://github.com/teng-lin/notebooklm-py.git) 來存取 [NotebookLM](https://blog.google/innovation-and-ai/technology/ai/notebooklm-google-ai/)。

它會自動讀取 Playwright 瀏覽器的儲存狀態 JSON 進行認證（在執行 `notebooklm login` 後，通常位於 `~/.notebooklm/profiles/default/storage_state.json`）。舊版環境仍可能 fallback 到 `~/.notebooklm/storage_state.json`。你也可以透過 `NOTEBOOKLM_STORAGE_PATH` 覆寫路徑，或透過 `NOTEBOOKLM_AUTH_JSON` 直接注入 JSON。

## 設定

本專案使用 `uv` 作為唯一的 Python 套件管理器，並作為 `notebooklm-py` 原始碼庫的 `uv workspace` 成員運作。

```bash
# 1. 同步 workspace 依賴套件 (請在專案根目錄執行)
uv sync --all-packages

# 2. 進行認證
# 執行本地登入指令來產生 ~/.notebooklm/profiles/default/storage_state.json
uv run notebooklm login
```

## 開發

應用程式可以在本地執行或透過 Docker 執行。設定會從 `.env` 檔案載入。

**本地執行 (HTTP 或 stdio 模式)：**
因為這是 workspace 成員，你可以從 `mcp/` 目錄下無縫使用 `uv run` 執行指令，它會自動使用根目錄的 `.venv`。

```bash
# 使用 fastmcp CLI (推薦用於工具發現與本地 Agent 測試)
uv run fastmcp list src/nblm_mcp_server/server.py
uv run fastmcp run src/nblm_mcp_server/server.py

# 使用 Python 模組 (透過 HTTP 或 stdio 啟動 FastMCP)
uv run python -m nblm_mcp_server
uv run python -m nblm_mcp_server --transport stdio
```

**使用 Docker Compose (推薦用於 HTTP/SSE 部署)：**
```bash
# 建置並啟動容器
docker compose up -d --build

# 檢視日誌
docker compose logs -f nblm-mcp-server
```

## 測試

你可以輕鬆使用 `fastmcp` CLI 在本地測試伺服器工具與 schemas：

```bash
# 列出所有註冊的工具
fastmcp list src/nblm_mcp_server/server.py

# 檢查伺服器詮釋資料與工具 schemas
fastmcp inspect src/nblm_mcp_server/server.py
```

## 程式碼風格與慣例

- **佈局**：專案嚴格遵守 `python-src-layout`。所有核心應用程式代碼**必須**位於 `src/nblm_mcp_server/`，而測試代碼則屬於外層的 `tests/` 目錄。
- **命名**：變數、函式與內部服務使用 `snake_case`（例如內部非同步函式使用 `_a_function`，內部同步函式使用 `_function`）。類別名稱應使用 `PascalCase`。
- **依賴管理**：絕對不要直接使用 `pip install`。永遠使用 `uv pip install`。依賴項的變更**必須**反映在 `pyproject.toml` 中。
- **型別提示**：所有程式碼都應有適當的型別提示（`from __future__ import annotations`）。

## 專案結構

```text
├── src/nblm_mcp_server/
│   ├── server.py         # Main FastMCP entrypoint (mcp instance & lifespan)
│   ├── tools.py          # All MCP tool definitions and registrations
│   ├── client_service.py # Singleton management for NotebookLMClient
│   └── __main__.py       # CLI wrapper for starting the server
├── openspec/             # SDD OpenSpec files
├── pyproject.toml        # Project metadata and dependencies
└── Dockerfile            # Docker configuration for HTTP/SSE deployment
```

## 安全注意事項

- **機密資訊**：API Keys **只能**透過 `python-dotenv` 從 `.env` 檔案載入環境變數。絕對**不要**在任何地方寫死 API keys。
- **版本控制**：絕對不要將 `.env` 檔案提交到版本控制。`.gitignore` 已經配置好防止此事發生。

## SDD 工作流

本碼庫使用規格驅動 (Spec-Driven) 工作流與 `OpenSpec` 進行架構規劃與任務執行。例如：
- 使用 `/opsx-explore` 探索想法。
- 使用 `/opsx-propose` 規劃新變更。
- 使用 `/opsx-apply` 實作已核准的任務。
- 在封存變更後，規格檔案會同步至 `openspec/specs/`。

## 相關文件

### FastMCP

此 MCP 伺服器必須以 `FastMCP` 作為框架：

- 官方 [Github repo](https://github.com/PrefectHQ/fastmcp.git)
- `FastMCP` [llms-full.txt](https://gofastmcp.com/llms-full.txt)
- `FastMCP` [llms.txt](https://gofastmcp.com/llms.txt)

### notebooklm-py

- 官方 [Github repo](https://github.com/teng-lin/notebooklm-py.git)

