# 角色資料模型

此處日後放置角色資料結構與驗證規則。

## 初版欄位建議

- `schemaVersion`：資料格式版本。
- `characterId`：本機唯一識別碼。
- `name`：角色名稱。
- `classId`：職業識別碼。
- `level`、`jobLevel`、`experience`：等級與經驗。
- `stats`：STR、DEX、INT、AGI、VIT、LUK。
- `hp`、`mp`：目前及最大生命／魔力。
- `mapId`、`position`：最後所在位置。
- `createdAt`、`updatedAt`：建立與更新時間。

正式欄位須依實際遊戲規則確認；本文件不是對既有遊戲資料的擷取或解讀。
