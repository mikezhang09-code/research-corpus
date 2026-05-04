# 內容生成與匯出 (Content Generation & Export)

`notebooklm-py` 最強大的能力在於透過 API 驅動 NotebookLM 所有的內容生成模型（NotebookLM Studio），並且提供比網頁版更多的下載格式選擇。

## 支援的生成產物 (Artifacts)

1. **Audio Overview (Podcast 音訊統整)**
   - 支援格式：`deep-dive`, `brief`, `critique`, `debate`
   - 控制項：三種長度選擇，支援 50+ 種輸出語言。
   - 下載格式：`.mp3` / `.mp4`
2. **Video Overview (影片)**
   - 支援格式：`explainer`, `brief`, `cinematic`
   - 控制項：9 種視覺風格（如 whiteboard, kawaii, watercolor 等）。
   - 下載格式：`.mp4`
3. **Slide Deck (簡報/投影片)**
   - 支援格式：`detailed`, `presenter`
   - 進階功能：支援針對單張投影片透過自然語言提示進行修改 (`revise-slide`)。
   - 下載格式：除了基本的 PDF，亦支援下載為可編輯的 `.pptx` (Web 版僅支援 PDF)。
4. **Infographic (資訊圖表)**
   - 控制項：排版方向（直式/橫式/正方）、細節程度、多種風格（sketch-note, bento-grid 等）。
   - 下載格式：`.png`
5. **Study & Evaluation (測驗與學習)**
   - **Quiz (測驗)** & **Flashcards (閃卡)**
   - 控制項：可自訂難易度與數量。
   - 下載格式：可匯出為純資料 `JSON`、`Markdown` 或 `HTML` (Web 版僅提供互動介面)。
6. **Data Processing (資料與報告)**
   - **Report (報告)**：支援多種範本（Briefing doc, Study guide, Blog post）或自訂提示。可下載為 `.md`。支援附加自訂提示而不會遺失格式類型。
   - **Data Table (資料表)**：透過自然語言提示建立對比表格，並可下載為 `.csv` 供試算表使用。
   - **Mind Map (心智圖)**：除了視覺預覽外，API 可提取其階層架構的 `JSON` 資料以供第三方工具視覺化。

## 語言設定 (Language Config)
- 支援全域或單次指令設定產出內容的語言（例如：`zh_Hant` 繁體中文, `ja` 日文等）。
- 由於此設定為全域性，會影響帳號下所有 Notebook 的生成產物，API 支援靈活操作。
