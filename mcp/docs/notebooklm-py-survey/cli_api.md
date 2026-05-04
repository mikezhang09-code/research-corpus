# 使用介面 (CLI, API & Agent)

`notebooklm-py` 提供多種互動層次，適合不同的自動化場景：

## 1. Python API

- 採用標準的 `asyncio` 非同步實作，適合建立高效能管線。
- 提供了 `NotebookLMClient` 作為進入點。
- 方法分類清晰：`client.notebooks`, `client.sources`, `client.chat`, `client.artifacts` 等。
- 支援狀態等待機制（例如：`wait_for_completion`）以處理需時較長的後台生成工作。
- 回傳結構化的模型資料，易於在 Python 專案中解析與整合。

## 2. CLI 工具

- 提供 `notebooklm` 指令作為全功能的命令列介面，可執行與 API 完全相同的操作。
- 支援 `--json` 參數輸出機器可讀結果，便於 Shell Script 串接。
- 包含豐富的除錯與檢驗工具（如 `auth check`, `doctor`）。

## 3. Agent Integration (AI 代理整合)

- 內建符合標準的 `SKILL.md` 規範與 `notebooklm skill install` 專屬指令，自動將知識庫安裝到本地代理目錄。
- 支援供 LLM Agent（如 Claude Code, Codex 等）自主呼叫的工具定義與參數解讀。
- **最佳實踐與防阻塞**：提供子代理 (Subagent) 的模式建議。針對長時間操作（如生成影片或深度研究，可能耗時 5-45 分鐘），建議利用背景任務搭配 `--json` 取得 `task_id` 後進行非同步輪詢等待，避免阻塞主代理的對話流程。

## 權限與連線狀態管理

- 依賴 Google OAuth 驗證，初始化時需要瀏覽器登入（執行 `notebooklm login`）。
- 具備設定檔 (Profiles) 的設計支援：
  - 透過指令如 `notebooklm profile create <name>` 以管理多帳號。
  - 支援指定環境變數 `NOTEBOOKLM_HOME` 及 `NOTEBOOKLM_AUTH_JSON`，非常適合在 CI/CD 或平行執行的 Agent 環境中做到安全且獨立的沙盒隔離。
