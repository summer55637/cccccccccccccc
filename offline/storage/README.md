# IndexedDB 本機角色資料庫

此模組提供不依賴遊戲伺服器的瀏覽器本機角色存檔。它不使用帳號、密碼、Token 或伺服器金鑰。

## 檔案

- `indexeddb.js`：資料庫及角色 CRUD／存檔 API。
- 測試頁：`../tests/indexeddb-test.html`。
- 測試程式：`../tests/indexeddb.test.js`。

## 快速使用

```js
import { OfflineCharacterDB } from "./indexeddb.js";

const saves = new OfflineCharacterDB();
await saves.open();

const character = await saves.createCharacter({
  name: "測試騎士",
  classId: "knight",
});

await saves.updateCharacter(character.characterId, {
  level: 2,
  experience: 100,
});

await saves.saveCharacterData(character.characterId, {
  inventory: { capacity: 100, items: [{ itemId: "potion", count: 3 }] },
  equipment: { slots: { weapon: "wooden-sword" } },
  skills: { learned: [] },
  quests: { entries: [] },
});

const fullSave = await saves.loadCharacterSave(character.characterId);
console.log(fullSave);
```

## API

| 方法 | 用途 |
|---|---|
| `open()`／`close()` | 開啟及關閉資料庫 |
| `createCharacter({ name, classId })` | 建立角色及預設附屬資料 |
| `getCharacter(characterId)` | 讀取單一角色 |
| `listCharacters()` | 列出全部角色 |
| `updateCharacter(characterId, patch)` | 更新角色資料 |
| `saveCharacterData(characterId, data)` | 原子性保存背包、裝備、技能、任務 |
| `loadCharacterSave(characterId)` | 讀取完整角色存檔 |
| `deleteCharacter(characterId)` | 刪除角色及其附屬資料 |

角色名稱在同一個瀏覽器資料庫中不可重複。角色初始等級、能力及 HP／MP 是測試用預設值，尚未對應特定遊戲伺服器規則。

## 資料表

- `characters`
- `inventories`
- `equipment`
- `skills`
- `quests`
- `settings`（預留）

## 執行測試

使用 HTTP localhost 或 HTTPS 提供靜態檔案，開啟 `../tests/indexeddb-test.html`，再按「執行完整測試」。

測試使用獨立隨機資料庫名稱，涵蓋建立、讀取、更新、重複名稱驗證、保護角色 ID、附屬資料存檔、關閉後重新開啟及刪除。測試結束後自動清除臨時資料庫，不會刪除正式存檔。

## 注意

存檔只存在目前瀏覽器設定檔及裝置。使用者清除網站資料、瀏覽器設定檔損壞或裝置遺失，可能導致存檔消失；正式遊戲版本仍應加入存檔匯出／匯入備份。

本模組不接觸現有 Cocos 成品、原線上登入、原伺服器或資源包。整合前仍須確認相關程式及素材的修改與發布授權。
