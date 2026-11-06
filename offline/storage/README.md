# 本機存檔

主要使用 IndexedDB 保存結構化遊戲資料。少量畫面偏好設定可另行使用 LocalStorage。

## 預定資料表

- `characters`
- `inventories`
- `equipment`
- `skills`
- `quests`
- `settings`

## 必要能力

- 建立及升級資料庫版本。
- 使用交易確保相關資料一致寫入。
- 自動存檔與錯誤處理。
- 存檔匯出及匯入。
- 匯入前驗證格式及版本。
- 不保存帳密、Token、Cookie 或伺服器金鑰。

存檔只屬於目前瀏覽器與裝置；跨裝置同步不在第一版範圍。
