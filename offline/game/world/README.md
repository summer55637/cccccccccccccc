# 本機世界與地圖

負責單機地圖資料、角色座標、移動規則及碰撞判定。此階段使用自製的新手村測試地圖，不載入原遊戲素材。

## 地圖規格

- 地圖：start（新手村）。
- 尺寸：20 × 12 格。
- 新角色出生點：座標 (9, 5)。
- 座標原點：左上角 (0, 0)，X 向右增加，Y 向下增加。
- 可通行地形：草地、道路。
- 阻擋地形：樹木、岩石、水域及地圖邊界。

## 檔案

- map.js：地圖尺寸、出生點、地形及障礙物資料。
- movement.js：方向移動、邊界檢查、碰撞判定及 IndexedDB 座標保存。

## 操作方式

- 鍵盤方向鍵或 W、A、S、D：每次移動一格。
- 畫面方向按鈕：支援觸控操作。
- 遇到樹木、岩石、水域或地圖邊界時，角色會停下，座標不變。
- 每次成功移動後即時更新角色座標及 IndexedDB 存檔。

## API

    import { getMapDefinition, getMapSpawn } from "./map.js";
    import { calculateMovement, moveCharacter } from "./movement.js";

    const map = getMapDefinition("start");
    const spawn = getMapSpawn("start");
    const preview = calculateMovement(spawn, "right");
    const saved = await moveCharacter(database, characterId, "right");

calculateMovement 只計算移動結果，不寫入資料庫；moveCharacter 讀取角色目前座標，檢查通行條件，成功時才呼叫 IndexedDB 更新座標。

## 測試

offline/tests/world-test.html 及 world.test.mjs 會驗證地圖尺寸、出生點、地形分類、單格移動、障礙碰撞、地圖邊界、無效方向、座標保存、重開資料庫後恢復及不存在角色的錯誤處理。

GitHub Actions 會在 Chromium 中執行測試。測試只使用臨時資料庫及自製地圖資料，不呼叫外部服務。
