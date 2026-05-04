# notebooklm-py 功能調查報告 (Survey)

本目錄彙整了 `notebooklm-py` 函式庫所提供的完整功能與 API 能力。這個函式庫是一個非官方的 Python API 與 CLI 工具，允許使用者透過程式化的方式完整存取 Google NotebookLM 的各項功能（甚至包含了網頁端未開放的進階功能）。

## 功能模組分類

請參閱以下子文檔以了解各項具體功能：

1. **[筆記本與來源管理 (Notebooks & Sources)](notebooks_sources.md)**
   - 建立與管理 Notebooks。
   - 支援多種來源（URLs, YouTube, PDF, Text, Audio, Video, Images, Google Drive）。
2. **[對話與研究 (Chat & Research)](chat_research.md)**
   - 針對來源內容進行 Q&A。
   - 具備引用追蹤（Citations）與對話紀錄管理。
   - 深度網頁/Drive 研究助理能力。
3. **[內容生成與匯出 (Content Generation & Export)](content_generation.md)**
   - 生成多媒體內容（Podcast、影片、投影片、資訊圖表）。
   - 生成學習與分析材料（測驗、閃卡、報告、心智圖、資料表）。
   - 支援多種格式匯出。
4. **[使用介面 (CLI, API & Agent)](cli_api.md)**
   - 非同步 Python API 介紹。
   - 命令列工具 (CLI) 能力。
   - Agent 整合與自動化應用。

## 關鍵特點

- **支援多重介面**：提供 `Python API`、`CLI` 以及給 AI Agent (如 Claude/Codex) 的 `SKILL` 支援。
- **超越 Web UI 的能力**：
  - 批次下載各類生成產物。
  - 測驗/閃卡資料可匯出為 JSON/Markdown 格式。
  - 心智圖可匯出原始 JSON 資料。
  - 投影片可匯出為可編輯的 `.pptx` 格式（Web 版僅提供 PDF）。
  - 對單一投影片進行修改（Slide Revision）。
  - 對話結果可存成獨立筆記。
  - 直接提取來源文件的純文字索引 (Fulltext)。
