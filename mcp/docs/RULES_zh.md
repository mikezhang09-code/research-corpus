[English](../RULES.md) | [中文](RULES_zh.md)

# 任務執行與環境管理規範

## 1. 任務啟動協議 (最高優先級)

- **讀取技能**：當開啟新任務或觸發任何技能時，**必須**第一時間讀取並執行 auto-skill 技能目錄下的 `SKILL.md`。
- **檢查進度**：每次啟動對話後，**必須**優先讀取 `user-recent-working-on/now/working-on.md` 以了解使用者目前正在進行的工作，確保對話上下文的一致性。
- **環境預檢**：在執行任何代碼或安裝套件前，必須先檢查當前目錄的環境狀態，確保符合隔離原則。

## 2. Python 環境管理 (強制使用 uv)

如果你在執行過程中發現缺少 Python 套件，請依照以下步驟操作，**絕對禁止**直接在本機全域環境安裝：

1. **檢查環境**：確認當前目錄是否存在虛擬環境（`.venv` 資料夾）。
2. **建立環境**：若不存在，請執行 `uv venv` 建立虛擬環境。
3. **啟動環境**：執行 `source .venv/bin/activate` (若在 Windows 則使用 `.venv\Scripts\activate`)。
4. **安裝套件**：使用 `uv pip install <套件名稱>` 進行安裝。
5. **快速執行**：若是單次腳本運行，亦可考慮直接使用 `uv run <script.py>`，讓 uv 自動處理依賴。

## 3. Node.js 環境管理 (強制使用專案內隔離)

如果你在執行過程中發現缺少 Node.js 套件，請依照以下步驟操作，**絕對禁止**直接在全域環境安裝：

1. **檢查專案設定**：先確認目前目錄是否存在 `package.json`。
2. **建立專案**：若不存在 `package.json`，先執行 `npm init -y` 建立專案設定。
3. **安裝套件**：使用 `npm install <package>` 安裝套件，確保依賴寫入 `package.json` 並安裝到專案內的 `node_modules`。
4. **開發依賴**：若是開發工具或測試工具，請使用 `npm install -D <package>`。
5. **執行指令**：優先使用 `npm run <script>` 執行專案腳本。
6. **單次執行**：若只是一次性執行某個工具或腳本，可優先使用 `npx <command>`，避免全域安裝。
7. **保持更新**：安裝完成後，視需求更新 `package.json` 與 lock file，例如 `package-lock.json`、`yarn.lock` 或 `pnpm-lock.yaml`。

以下額外規範同樣適用：

- **禁止全域操作**：嚴禁使用 `npm install -g`、`yarn global add` 或 `pnpm add -g`，除非使用者明確要求。
- **優先一致性**：若專案已經使用 `npm`、`yarn` 或 `pnpm` 其中一種，後續安裝與執行都要沿用同一套工具，不要混用。

## 4. 其他語言環境管理

非 Python 專案也必須遵守「專案內隔離」原則：

- **Node.js**: 
  - 若無 `package.json`，先執行 `npm init -y`。
  - 使用 `npm install <package>`，確保套件安裝在專案目錄下的 `node_modules`。
- **Rust**: 使用 `cargo add <crate>`，確保依賴紀錄在 `Cargo.toml` 中。
- **Go**: 使用 `go mod init` (若無) 配合 `go get <module>`。

## 5. 執行守則與自動修復

- **禁止全域操作**：嚴禁使用 `sudo pip install` 或在未啟動虛擬環境的情況下安裝任何套件。
- **故障自癒**：若執行代碼時出現 `ModuleNotFoundError` 或 `Command not found`，應根據上述協議自動判定環境、建立虛擬環境並安裝缺失套件，如果有任何不確定的部分，請先詢問使用者。
- **保持更新**：安裝完成後，視需求更新專案的依賴清單 (如 `pyproject.toml`、`requirements.txt` 或 `package.json`)。
