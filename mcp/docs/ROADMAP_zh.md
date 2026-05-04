[English](../ROADMAP.md) | [中文](ROADMAP_zh.md)

# NotebookLM MCP Server Roadmap

本文件列出了 `notebooklm-mcp-server` 當前已實作的功能，並基於 `notebooklm-py` 的能力，規劃了未來可持續擴充的工具藍圖。

## 🟢 階段一：基礎核心 (已實作)

目前的 MCP Server 已經具備與 NotebookLM 互動的最基本能力：

- **Notebook 管理**
  - [x] 列出所有 Notebooks (`list_notebooks`)
  - [x] 建立新的 Notebook (`create_notebook`)
- **來源管理**
  - [x] 透過 URL 新增來源 (`add_source`)
  - [x] 列出 Notebook 內的來源 (`list_sources`)
- **對話互動**
  - [x] 基於 Notebook 進行提問，並回傳引用資訊 (`ask_notebook`)

---

## 🟡 階段二：進階資源與對話管理 (已實作)

擴充對話與資源的精細操作，讓 AI Agent 能夠更靈活地操作 Notebook。

### 資源管理擴充
- [x] **刪除資源**：提供刪除 Notebook 或特定來源的工具。
- [x] **查詢 / 等待來源狀態** (`get_source_status`, `wait_for_source`)：讓 Agent 可在非同步匯入後查詢單一 source 的 indexing 狀態，或直接等待其完成。
- [x] **取得來源全文** (`get_source_fulltext`)：讓 Agent 可以直接讀取來源經過系統索引後的完整純文字內容，這對於後續的在地端分析非常有用。
- [x] **多種類型來源匯入**：
  - [x] 支援新增 YouTube 影片來源。
  - [x] 支援純文字內容直接建立來源 (Pasted Text)。
  - [ ] (選用) 支援上傳本機檔案或 Google Drive 檔案。

### 對話控制擴充
- [x] **指定來源對話**：擴充 `ask_notebook` 參數，允許限定只針對某些特定的 Source ID 進行檢索與對話。
- [x] **對話歷史管理**：
  - [x] 取得過去的對話歷史。
  - [x] 支援傳入 `conversation_id` 來延續之前的對話上下文。
- [x] **筆記管理**：新增將特定的回答儲存為 Notebook 內部筆記 (Note) 的工具。

---

## 🔵 階段三：研究探員整合 (已實作)

引入 NotebookLM 內建的強大研究能力。

- [x] **觸發研究** (`start_research`)：MCP Server 可呼叫 NotebookLM 的研究探員，支援 `fast` / `deep` 模式與 Web / Google Drive 來源。
- [x] **查詢 / 等待研究狀態** (`get_research_status`, `wait_for_research`)：Agent 可以輪詢最新狀態，或直接等待研究任務完成。
- [x] **自動匯入研究結果** (`import_research_sources`, `wait_for_research(import_all=True)`)：研究完成後可將結果轉成 Notebook sources。
- *注意：研究仍屬於長時間任務，但 MCP 層現在同時提供非阻塞查詢與阻塞等待兩種介面。*

---

## 🟣 階段四：內容生成與匯出 (遠期規劃)

解鎖 NotebookLM Studio 的全套多媒體生成能力。這可以讓 AI Agent 具備「產出最終交付物」的能力。

### 生成觸發工具
- [ ] **音訊/Podcast 生成** (`generate_audio_overview`)
- [ ] **簡報生成** (`generate_slides`)
- [ ] **測驗與閃卡生成** (`generate_quiz`, `generate_flashcards`)
- [ ] **文件與圖表生成** (Report, Data Table, Mind Map)
- [ ] **全域語言設定** (`set_output_language`)：控制生成的語言。

### 匯出與下載工具
- [ ] **下載多媒體產物**：支援將生成的 `.mp3`, `.mp4`, `.pptx` 下載回本機。
- [ ] **取得結構化資料**：直接回傳生成後的 JSON (如：測驗資料、心智圖結構) 或 CSV (資料表) 供 Agent 進一步處理。

---

## 💡 架構與部署優化

- [x] Docker 化部署支援
- [ ] **Token 與認證自動更新**：探討在長時間運行的 Docker 容器中，處理 Session 過期或重新認證的機制。
- [ ] **併發與排隊機制**：若未來支援耗時的生成任務，考慮加入簡易的任務佇列狀態管理。
