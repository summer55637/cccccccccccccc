# IndexedDB 本機角色資料庫

此模組提供不依賴遊戲伺服器的瀏覽器本機角色存檔。它不使用帳號、密碼、Token 或伺服器金鑰。

## 檔案

- indexeddb.js：資料庫及角色 CRUD／存檔 API。
- backup.js：完整存檔 JSON 匯出、驗證及原子匯入。
- 測試頁：../tests/indexeddb-test.html。
- 瀏覽器自動測試：../tests/run-browser-tests.mjs。

## 快速使用

    import { OfflineCharacterDB } from "./indexeddb.js";
    import { exportCharacterBackup, importCharacterBackup } from "./backup.js";

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
      skills: { points: 1, learned: [], shortcuts: [], cooldowns: {} },
      quests: { entries: [] },
    });

    const fullSave = await saves.loadCharacterSave(character.characterId);
    console.log(fullSave);

    // 匯出完整資料庫備份
    const backup = await exportCharacterBackup(saves);
    const json = JSON.stringify(backup, null, 2);

    // 還原前必須先取得使用者明確同意；匯入會取代整個本機資料庫
    await importCharacterBackup(saves, JSON.parse(json), { replaceExisting: true });

## API

資料庫連線若收到關閉事件或版本變更，模組會丟棄舊連線；下一次資料操作會重新開啟資料庫。已中止的交易不會自動重送，呼叫端應先重新讀取存檔狀態，再決定是否重試。

| 方法 | 用途 |
|---|---|
| open()／close() | 開啟及關閉資料庫 |
| createCharacter({ name, classId }) | 建立角色及預設附屬資料 |
| getCharacter(characterId) | 讀取單一角色 |
| listCharacters() | 列出全部角色 |
| updateCharacter(characterId, patch) | 更新角色資料 |
| saveCharacterData(characterId, data) | 原子性保存背包、裝備、技能、任務 |
| loadCharacterSave(characterId) | 讀取完整角色存檔 |
| deleteCharacter(characterId) | 刪除角色及其附屬資料 |
| exportCharacterBackup(database) | 匯出全部角色、附屬資料及設定 |
| inspectCharacterBackup(backup) | 驗證備份格式並取得資料摘要 |
| importCharacterBackup(database, backup, { replaceExisting: true }) | 經使用者確認後，原子性取代並還原完整資料庫 |

角色名稱在同一個瀏覽器資料庫中不可重複。角色初始等級、能力及 HP／MP 是測試用預設值，尚未對應特定遊戲伺服器規則。

## 備份格式及安全措施

- 備份為 JSON 檔，包含版本號、匯出時間、角色、背包、裝備、技能、任務及設定。
- 技能存檔包含技能點數、已學技能等級、4 格快捷欄及冷卻到期時間；舊版僅含 learned 的資料會補預設欄位。
- 匯入只接受目前支援的備份格式及版本，並檢查欄位、數值、角色 ID、重複名稱、設定及附屬資料關聯。
- 會拒絕危險物件欄位、過深巢狀資料、超大備份、不存在角色的附屬資料及無效 JSON。
- 匯入前先完成整份資料驗證，再用單一 IndexedDB 交易清除及寫入資料；交易失敗時不會留下半套還原資料。
- importCharacterBackup 必須明確傳入 replaceExisting: true。畫面會先顯示覆蓋警告並要求使用者確認。
- 匯入會取代目前資料庫中的所有角色及設定；建議先下載目前備份。請把 JSON 備份保存到安全位置，不要公開分享。

## 資料表

- characters
- inventories
- equipment
- skills
- quests
- settings

## 執行測試

使用 HTTP localhost 或 HTTPS 開啟 ../character/ui/index.html，可在「存檔與備份」區域下載或還原 JSON 檔。

GitHub Actions 會在 offline/local-character-system 分支自動執行 Chromium 測試，包括 IndexedDB CRUD、角色管理畫面及完整備份匯入流程。測試使用獨立隨機資料庫，結束後自動清除臨時資料庫，不會刪除正式存檔。

## 注意

存檔只存在目前瀏覽器設定檔及裝置。使用者清除網站資料、瀏覽器設定檔損壞或裝置遺失，可能導致存檔消失；請定期下載並保存 JSON 備份。

本模組不接觸現有 Cocos 成品、原線上登入、原伺服器或資源包。整合前仍須確認相關程式及素材的修改與發布授權。
