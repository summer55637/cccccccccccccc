# 背包與裝備

本模組只使用本專案自製道具資料，所有狀態保存在角色 IndexedDB 存檔。

## 道具種類

- 消耗品：紅色藥水恢復 30 HP；藍色藥水恢復 20 MP。HP／MP 已滿時不會消耗道具。
- 材料：透明凝膠、粗糙獸皮，可堆疊並丟棄。
- 武器：鐵劍提供普通攻擊 +4；青銅短劍提供普通攻擊 +2。
- 防具：皮革護甲提供受到怪物攻擊時傷害 -2。
- 新建立角色會取得紅色藥水 ×2、藍色藥水 ×1、鐵劍 ×1、皮革護甲 ×1，玩家可自行決定是否裝備。

## 背包規則

- 背包容量以道具種類／格數計算；相同道具會合併堆疊。
- 消耗品、材料有各自堆疊上限；裝備物品每格一件。
- 背包滿格時不能加入新的道具種類。
- 道具可使用、逐件丟棄；武器與防具可裝備及卸下。
- 更換裝備時，原裝備會放回背包；若背包無空位且無法堆疊，操作會被拒絕。

## 存檔一致性

- 使用藥水時，角色 HP／MP 與背包數量透過同一筆 IndexedDB readwrite transaction 原子更新。
- 裝備資料與背包道具移動透過同一筆 saveCharacterData 交易更新。
- 背包及裝備沿用原有存檔資料表與 JSON 備份格式，不需升級資料庫版本。
- 裝備加成套用到普通攻擊傷害與怪物反擊減傷。
- 匯入的未知道具仍可顯示及丟棄，但不會被當作可使用或裝備的本專案道具。

## 主要 API

- `getInventorySave(database, characterId)`
- `grantItem(database, characterId, itemId, count)`
- `useItem(database, characterId, itemId, count)`
- `dropItem(database, characterId, itemId, count)`
- `equipItem(database, characterId, itemId)`
- `unequipItem(database, characterId, slot)`

所有道具數值及效果皆為原創原型，不代表既有遊戲伺服器的正式數值。
