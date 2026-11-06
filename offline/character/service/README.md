# 角色管理服務

此處日後放置不依賴遠端伺服器的角色管理程式。

## 預定介面

- `createCharacter(input)`
- `listCharacters()`
- `getCharacter(characterId)`
- `selectCharacter(characterId)`
- `updateCharacter(characterId, changes)`
- `deleteCharacter(characterId)`

## 設計要求

- 所有輸入都要驗證。
- 角色名稱需限制長度並避免空白名稱。
- 更新採白名單欄位，不接受任意物件覆蓋。
- 刪除角色前由 UI 二次確認。
- 儲存失敗時顯示明確錯誤，不得假裝存檔成功。
