# 筆記本與來源管理 (Notebooks & Sources)

`notebooklm-py` 提供了完整的 Notebook 與 Source 資源管理 API，這是所有互動的基礎。

## 筆記本管理 (Notebooks)

- **建立 (Create)**：可透過 API 或 CLI 建立新的 Notebook。
- **列出 (List)**：獲取帳號內所有的 Notebook 清單與基本資訊。
- **管理 (Rename/Delete)**：重新命名或刪除 Notebook。
- **狀態 (Status/Context)**：設定與查詢當前操作所屬的 Notebook 上下文。

## 來源管理 (Sources)

NotebookLM 的核心在於可以匯入多種來源，`notebooklm-py` 支援完整來源的操作：

- **支援的來源類型**：
  - 網頁 URLs。
  - YouTube 影片。
  - 檔案上傳（PDF, Text, Markdown, Word 文件, 音訊檔, 影片檔, 圖片檔）。
  - Google Drive 檔案匯入。
  - 純文字內容（Pasted Text）。
- **來源操作**：
  - **新增 (Add)**：非同步上傳或連結來源。
  - **列出 (List)**：檢視已匯入的來源及處理狀態（`processing`, `ready`, `error`）。
  - **刪除 (Delete)**：依據 ID 或精確標題刪除來源。
  - **讀取全文 (Fulltext)**：取得來源經過系統索引處理後的完整純文字內容，這是網頁版未提供的進階功能。
  - **等待處理 (Wait)**：匯入來源後，需等待系統處理完畢（`ready`），API 提供等待狀態的機制。
