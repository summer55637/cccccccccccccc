# 角色能力值與成長系統

此資料夾是單機原型自行設計的角色規則，不宣稱重現任何特定天堂伺服器的公式。若日後要對齊經授權的版本，再把職業數值、升級曲線及成長幅度調整為有文件依據的設定。

## 目前規則

- 職業：騎士、精靈、法師、領主。
- 能力值：STR 力量、DEX 敏捷、INT 智力、AGI 靈巧、VIT 體質、LUK 幸運。
- 最高等級：Lv.99。
- 每次升級獲得 3 點能力點數。
- 經驗需求：每級為 floor(100 × level^1.65)，最低 100。
- 升級時增加職業對應的 HP／MP 最大值與目前值。
- 經驗超過升級門檻的部分會保留到下一級。
- 達到最高等級後不再增加經驗或升級。

## 檔案

- rules.js：職業初始能力值、經驗曲線、升級計算及點數分配驗證。
- service.js：建立成長角色、增加經驗值及分配能力點數，並保存回 IndexedDB。

## 使用範例

    import { OfflineCharacterDB } from "../../storage/indexeddb.js";
    import {
      createProgressionCharacter,
      awardExperience,
      allocateStatPoints,
    } from "./service.js";

    const database = new OfflineCharacterDB();
    await database.open();

    const character = await createProgressionCharacter(database, {
      name: "本機騎士",
      classId: "knight",
    });

    const reward = await awardExperience(database, character.characterId, 120);
    const updated = await allocateStatPoints(database, character.characterId, "str", 1);

## 測試

offline/tests/progression-test.html 會使用一次性 IndexedDB 測試資料庫，驗證職業初始值、經驗進度、跨級及溢出經驗、能力點數、錯誤輸入、職業 HP／MP 差異、等級上限與重新開啟資料庫後資料持續存在。

## 後續整合

下一個階段會把這套規則接到遊戲主畫面、地圖及戰鬥獎勵。屆時怪物的 EXP 獎勵會呼叫 awardExperience；不使用臨時測試按鈕當作正式戰鬥功能。
