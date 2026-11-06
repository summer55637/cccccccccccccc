# 單機系統測試

## IndexedDB 角色資料庫測試

開啟 indexeddb-test.html 並按「執行完整測試」。測試使用一次性的臨時資料庫，完成後自動刪除。

## 角色管理介面測試

character-ui.test.mjs 透過 Playwright 操作真正的瀏覽器畫面，測試建立、編輯、選擇、升級、能力點數分配、進入主畫面、鍵盤／觸控移動、碰撞阻擋、重新載入後位置保存及刪除角色。

## 角色成長測試

progression-test.html 及 progression.test.mjs 驗證職業初始能力值、經驗進度、跨級及溢出經驗、能力點數、錯誤輸入、職業 HP／MP 差異、等級上限與重新開啟資料庫後資料持續存在。

## 地圖與移動測試

world-test.html 及 world.test.mjs 驗證新手村地圖尺寸、出生點、樹木／岩石／水域及活動怪物碰撞、單格移動、地圖邊界、無效方向及 IndexedDB 座標保存。

## 怪物與戰鬥測試

combat-test.html 及 combat.test.mjs 使用臨時 IndexedDB 驗證怪物資料、待機／警戒／攻擊 AI、攻擊距離、命中與落空、玩家 HP、怪物反擊、攻擊冷卻、經驗獎勵、掉落物保存、死亡狀態及怪物重生。角色 UI 整合測試另會實際進入遊戲、攻擊相鄰怪物、確認獎勵並重新載入遊戲頁。

## 背包與裝備測試

inventory-test.html 及 inventory.test.mjs 使用臨時 IndexedDB 驗證道具堆疊、紅／藍藥水、滿 HP 防止浪費、角色狀態與背包原子更新、丟棄、裝備更換及卸下、攻防加成、背包容量、未知道具拒絕及重開資料庫後持續保存。角色 UI 整合測試另會直接操作藥水、裝備及丟棄按鈕。

## 職業技能測試

skills-test.html 及 skills.test.mjs 使用臨時 IndexedDB 驗證新角色起始技能點、跨職業與等級限制、學習／升級成本、前置技能條件、四格快捷欄、MP 不足、技能射程、命中／落空、冷卻、怪物反擊、經驗及掉落、重新開啟資料庫後的技能狀態保存。角色 UI 整合測試會實際學習並提升技能、指派快捷欄及施放技能擊敗怪物。備份 UI 測試也會檢查技能點、快捷欄及冷卻的匯出／還原。

## 存檔備份測試

backup-ui.test.mjs 驗證完整 JSON 匯出及還原流程：

- 備份包含角色、背包、裝備、技能、任務及設定。
- 沒有明確的覆蓋確認時，程式 API 會拒絕匯入。
- 刪除角色後，透過匯入備份還原角色。
- 還原後確認附屬資料及自訂設定完整。
- 無效 JSON 會被拒絕，且不會改動原有存檔。
- 不連線任何外部服務。

## GitHub Actions

推送到 offline/local-character-system 分支的 offline/** 檔案變更時，GitHub Actions 會安裝 Chromium 並執行 offline/tests/run-browser-tests.mjs。流程會依序執行 IndexedDB、角色管理介面與戰鬥／背包／技能整合、地圖移動、怪物戰鬥、背包與裝備、職業技能、角色成長及備份／還原測試。

各測試使用獨立的臨時 IndexedDB，結束後自動清除測試資料庫，不會刪除正式存檔，也不會連線原遊戲伺服器。
