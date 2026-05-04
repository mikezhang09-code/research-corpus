# 對話與研究 (Chat & Research)

這部分涵蓋了與 NotebookLM 核心模型互動的功能，包含基本的 QA 聊天到進階的研究助理任務。

## 聊天對話 (Chat)

- **一般問答 (Ask)**：針對 Notebook 內的來源進行提問。
- **特定來源對話**：可以限定只針對特定的幾個來源（Source IDs）進行對話。
- **引用與來源追蹤 (References/Citations)**：API 支援回傳詳細的引用結構（JSON），包含 `citation_number`, `cited_text` 以及 `source_id`，能夠精準定位回答內容的來源。配合 `get_fulltext()` 可以從原文中找出引用的確切上下文。
- **對話紀錄 (History)**：可以獲取歷史對話紀錄，或者基於特定的 `conversation_id` 繼續之前的對話。
- **儲存筆記 (Save as Note)**：可以將對話的回答結果直接儲存為 Notebook 內的筆記（Notes），甚至能一鍵保存整個對話紀錄。

## 深度研究助理 (Web/Drive Research)

`notebooklm-py` 支援觸發 NotebookLM 內建的研究探員（Research Agent）：

- **研究模式 (Modes)**：
  - `fast` 模式：針對特定主題進行快速搜尋與摘要（約 5-10 個來源，速度快）。
  - `deep` 模式：針對廣泛主題進行深入分析與資料收集（20+ 個來源，耗時較長）。
- **研究來源指定**：可指定在 `Web` 或 `Google Drive` 中進行搜尋與研究。
- **自動匯入 (Auto-import)**：研究完成後，可以自動將相關的文章或資料直接匯入為 Notebook 的來源（Sources），作為後續對話的知識庫。
