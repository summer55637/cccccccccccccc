# 原始 Cocos 單機化實作計畫

> 依據：`docs/superpowers/specs/2026-11-08-cocos-offline-rebuild-design.md`
> 工作分支：`offline/local-character-system`
> 不修改：`main`

## 全域限制

- 發布入口改為原始 `client/index.html`，不能再將簡化原型當成主遊戲。
- 使用 Cocos Creator 3.8.8 原始 runtime、bundle 和資源包，保留其相對路徑。
- 所有遊戲狀態只存於瀏覽器 IndexedDB；不得發出登入、遊戲或資產請求至原線上伺服器。
- Pages artifact 只打包明確允許的 `client/`、必要 `extracted_data/`、新本機 runtime、PWA 殼層；排除 `server.js`、`local_accounts.json`、`node_modules`、`tools/`、密鑰、測試和原始備份。
- 每一個階段先建立失敗測試，再實作；不得以單純 HTTP 200 或空白畫布當成遊戲通過。

## Task 1 — 定義並測試原始遊戲發佈封裝

**輸出**
- `offline/tools/build-original-game-release.py`
- `offline/tests/test-original-game-release.py`
- CI 工作流程更新。

**步驟**
1. 先寫封裝測試：只允許 `client/`、必要 `extracted_data/*.json` 及新 runtime；明確拒絕帳號、伺服器、node_modules、測試與備份。
2. 驗證入口 HTML、Cocos 設定、SystemJS、所有 bundle、manifest、資源包與必要 JSON 均在 ZIP。
3. 驗證每個相對資源引用可解析，拒絕外部線上遊戲主機引用和常見憑證模式。
4. 生成逐檔 SHA-256 manifest，使用可重現 ZIP。
5. 在 CI 執行測試及封裝；不得覆蓋目前安全原型封裝，直到原版包通過瀏覽器測試。

**完成條件**：封裝測試全數通過，檔案數／總容量與 manifest 一致。

## Task 2 — 原版 Cocos 啟動與靜態 API 相容

**輸出**
- 原始 Cocos Pages 根目錄部署配置。
- `offline/original/api-compat.js`
- 原始 Cocos 頁面啟動測試。

**步驟**
1. 在 CI 測試站根目錄掛載原始 `client/`，保持既有相對路徑。
2. 將必要 JSON 資料由固定靜態路徑提供；以 API 相容層提供 shard、版本、時間、NPC、NPC 對話、城堡與 gamedata 回應。
3. 加入請求守門測試：不允許訪問 `test.xiaoshu.gg`、任何外部遊戲 API 或遠端 WebSocket。
4. 用 Playwright 啟動原始 Cocos 頁面，確認引擎初始化、主 bundle 及資源載入，收集 console/page errors。
5. 修正缺失資源和 base path，不把目前簡化 HTML 當作 fallback 成功。

**完成條件**：原始 Cocos 畫布成功初始化，所有必要初始資源在本機來源載入，沒有外部遊戲連線。

## Task 3 — Goline 本機服務層相容介面

**輸出**
- `offline/original/local-goline.js`
- `offline/original/local-game-state.js`
- `offline/tests/local-goline.test.js`

**步驟**
1. 先測試原始 `GolineSocket` 的 `on/off/fire/emit/raw/dial/disconnect` 相容契約與事件名稱。
2. 在 Cocos plugin 初始化後接管 `GolineSocket` 的傳輸，不建立原生 WebSocket、不呼叫原伺服器。
3. 把客戶端動作轉成瀏覽器本機服務操作；以原客戶端期待的 event payload 回傳。
4. 建立 accountless local character CRUD 和選角流程；複用現有 IndexedDB/備份層並為新 schema 加遷移。
5. 測試重整、關閉再開啟、不同角色資料隔離與備份還原。

**完成條件**：不連外即可登入本機入口、創角、選角、載入角色狀態，重整後狀態仍存在。

## Task 4 — 原始地圖、地圖實體及移動

**輸出**
- 地圖解析／座標工具。
- 本機世界狀態與 `WorldSnap/WorldDelta` 相容事件。
- 瀏覽器測試。

**步驟**
1. 解析 `gamedata.maps`、地圖資源包和 `WEnt/WorldSnap/WorldDelta` 格式。
2. 建立初始城鎮、玩家實體和地圖網格；保留原始 Cocos 地圖 renderer。
3. 實作本機移動、障礙判定、地圖切換、位置保存與重新載入。
4. 使用真實地圖資料測試座標及資源引用，不可使用 20×12 的自製示意地圖替代。

**完成條件**：原始遊戲場景顯示正確地圖，玩家可移動、切圖，位置能保存。

## Task 5 — 怪物生成、AI、戰鬥、經驗與掉落

**輸出**
- Combat/World service 和單元測試。
- Goline 世界實體、HP、FX 事件。
- 瀏覽器戰鬥流程測試。

**步驟**
1. 依地圖怪物清單和 `gamedata.mobs` 建立怪物生成及重生規則。
2. 實作主動／被動 AI、移動、索敵、攻擊間隔、命中、傷害、玩家受傷與死亡。
3. 實作玩家攻擊、技能傷害接口、怪物死亡、經驗值／升級及掉落。
4. 將角色、怪物、經驗、HP/MP、金幣和掉落保存到 IndexedDB。
5. 使用固定 RNG seed 測試戰鬥結果，確保單元測試可重現。

**完成條件**：玩家可在原始地圖遇怪、攻擊、擊殺、獲得經驗與掉落，重整後結果仍保存。

## Task 6 — 背包、裝備、技能、NPC 與任務

**輸出**
- Inventory/equipment/skills/NPC/quest 本機服務。
- Goline 相容事件和單元測試。

**步驟**
1. 以 665 件道具與裝備 schema 建立背包、堆疊、使用、丟棄、穿脫及狀態計算。
2. 以 123 個技能資料建立技能書、學習條件、MP 消耗、冷卻與效果。
3. 用 NPC 與 NPC HTML 資料實作對話、商店、購買及可安全本機化的動作。
4. 實作現有資料可支援的任務進度與獎勵。
5. 每項操作都須有原子存檔測試，錯誤時不可破壞既有資料。

**完成條件**：基本道具、裝備、技能與城鎮 NPC 流程可在原始 UI 操作。

## Task 7 — PWA／離線快取與完整瀏覽器驗收

**輸出**
- Cocos 頁面 Service Worker。
- Chromium / Firefox / WebKit smoke tests。
- Mobile QA 文件。

**步驟**
1. 預快取原始 Cocos 啟動依賴、必要 bundle、地圖／角色基本資源、資料與本機 runtime。
2. 避免首次載入時過度快取全部 287 MB；依必要資源及實際瀏覽路徑分批加入。
3. 測試首次線上載入、離線重啟、角色存檔、資源快取更新與 quota error。
4. 跑完整 CI；只有所有必需測試成功後才部署 Pages。
5. 驗證實際 Pages 網址載入原始 Cocos 畫面與第一段可操作玩法。

**完成條件**：原版 Cocos 入口可安裝至手機主畫面，快取完成後可離線開啟，核心單機流程通過瀏覽器測試。

## 審查重點

- 原版主畫面及地圖是否真的由 Cocos bundle/render pipeline 載入。
- 首頁是否仍誤導到簡化原型。
- 是否存在外部 fetch/WebSocket、硬編碼金鑰或帳號資料。
- Goline 事件資料 shape 是否和原始客戶端相符。
- 狀態更新與多步寫入是否具原子性。
- Pages artifact 是否只含必要客戶端、資料和本機 runtime。
