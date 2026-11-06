# 單機系統測試

## IndexedDB 角色資料庫測試

開啟 indexeddb-test.html 並按「執行完整測試」。測試使用一次性的臨時資料庫，完成後自動刪除。

## 角色管理介面測試

character-ui.test.mjs 透過 Playwright 操作真正的瀏覽器畫面，測試建立、編輯、選擇、升級、能力點數分配、進入主畫面、鍵盤／觸控移動、碰撞阻擋、重新載入後位置保存及刪除角色。

## 角色成長測試

progression-test.html 及 progression.test.mjs 驗證職業初始能力值、經驗進度、跨級及溢出經驗、能力點數、錯誤輸入、職業 HP／MP 差異、等級上限與重新開啟資料庫後資料持續存在。

## 地圖與移動測試

world-test.html 及 world.test.mjs 驗證新手村地圖尺寸、出生點、樹木／岩石／水域碰撞、單格移動、地圖邊界、無效方向及 IndexedDB 座標保存。

## 存檔備份測試

backup-ui.test.mjs 驗證完整 JSON 匯出及還原流程：

- 備份包含角色、背包、裝備、技能、任務及設定。
- 沒有明確的覆蓋確認時，程式 API 會拒絕匯入。
- 刪除角色後，透過匯入備份還原角色。
- 還原後確認附屬資料及自訂設定完整。
- 無效 JSON 會被拒絕，且不會改動原有存檔。
- 不連線任何外部服務。

## GitHub Actions

推送到 offline/local-character-system 分支的 offline/** 檔案變更時，GitHub Actions 會安裝 Chromium 並執行 offline/tests/run-browser-tests.mjs。流程會依序執行 IndexedDB、角色管理介面、地圖移動、角色成長及備份／還原測試。

各測試使用獨立的臨時 IndexedDB，結束後自動清除測試資料庫，不會刪除正式存檔，也不會連線原遊戲伺服器。
