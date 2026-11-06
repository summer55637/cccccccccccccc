import { OfflineCharacterDB } from "../storage/indexeddb.js";
import {
  dropItem,
  equipItem,
  getInventorySave,
  grantItem,
  unequipItem,
  useItem,
} from "../game/inventory/service.js";
import { getEquipmentBonuses } from "../game/inventory/items.js";
import {
  calculateBasicAttack,
  calculateMonsterAttack,
} from "../game/combat/rules.js";
import { getMonsterDefinition } from "../game/combat/monsters.js";

const assert = {
  equal(actual, expected, message = "數值不相符。") {
    if (actual !== expected) throw new Error(message + " 實際：" + actual + "；預期：" + expected);
  },
  deepEqual(actual, expected, message = "資料內容不相符。") {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message + " 實際：" + JSON.stringify(actual) + "；預期：" + JSON.stringify(expected));
    }
  },
};

function temporaryName() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "offline-inventory-test-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除背包測試資料庫。"));
    request.onblocked = () => reject(new Error("背包測試資料庫清除被阻擋。"));
  });
}
function countOf(save, itemId) {
  return save.inventory.items.find(item => item.itemId === itemId)?.count || 0;
}
function expectReject(task, pattern, label) {
  return task().then(
    () => { throw new Error(label + "：預期拒絕但操作成功。"); },
    error => {
      if (!pattern.test(error.message)) throw new Error(label + "：錯誤訊息不符，收到 " + error.message);
    },
  );
}

export async function runInventoryTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  const database = new OfflineCharacterDB({ dbName });
  const results = [];
  const pass = label => {
    results.push(label);
    onLog("✓ 背包：" + label);
  };

  try {
    await database.open();
    const character = await database.createCharacter({ name: "背包測試者", classId: "knight" });
    await database.updateCharacter(character.characterId, {
      hp: { current: 50, max: 100 },
      mp: { current: 10, max: 50 },
    });
    pass("建立角色並初始化 HP／MP 測試狀態");

    await grantItem(database, character.characterId, "red-potion", 3);
    const stacked = await grantItem(database, character.characterId, "red-potion", 2);
    assert.equal(countOf({ inventory: stacked }, "red-potion"), 5);
    pass("相同道具會堆疊在同一格");

    await grantItem(database, character.characterId, "blue-potion", 2);
    const hpUse = await useItem(database, character.characterId, "red-potion", 2);
    assert.equal(hpUse.character.hp.current, 100);
    assert.equal(hpUse.restored, 50);
    assert.equal(countOf({ inventory: hpUse.inventory }, "red-potion"), 3);
    pass("使用紅色藥水恢復 HP 並正確扣除數量");

    const mpUse = await useItem(database, character.characterId, "blue-potion", 1);
    assert.equal(mpUse.character.mp.current, 30);
    assert.equal(mpUse.restored, 20);
    assert.equal(countOf({ inventory: mpUse.inventory }, "blue-potion"), 1);
    pass("使用藍色藥水恢復 MP 並正確扣除數量");

    await expectReject(
      () => useItem(database, character.characterId, "red-potion", 1),
      /HP 已經全滿/,
      "滿 HP 使用藥水",
    );
    let save = await database.loadCharacterSave(character.characterId);
    assert.equal(countOf(save, "red-potion"), 3);
    assert.equal(save.character.hp.current, 100);
    pass("HP 已滿時拒絕使用藥水且不消耗道具");

    await expectReject(
      () => database.updateCharacterAndSaveData(
        character.characterId,
        { hp: { current: 101, max: 100 } },
        { inventory: { capacity: save.inventory.capacity, items: [] } },
      ),
      /hp.current/,
      "原子交易輸入驗證",
    );
    save = await database.loadCharacterSave(character.characterId);
    assert.equal(countOf(save, "red-potion"), 3);
    assert.equal(save.character.hp.current, 100);
    pass("角色狀態更新失敗時背包資料不會部分寫入");

    const dropped = await dropItem(database, character.characterId, "red-potion", 1);
    assert.equal(countOf({ inventory: dropped }, "red-potion"), 2);
    pass("可丟棄指定數量道具並減少堆疊");

    await grantItem(database, character.characterId, "iron-sword", 1);
    await grantItem(database, character.characterId, "leather-armor", 1);
    const equipped = await equipItem(database, character.characterId, "iron-sword");
    assert.equal(equipped.equipment.slots.weapon, "iron-sword");
    assert.equal(countOf({ inventory: equipped.inventory }, "iron-sword"), 0);
    assert.equal(equipped.equipmentBonuses.attackBonus, 4);
    pass("裝備鐵劍並套用攻擊加成");

    const armored = await equipItem(database, character.characterId, "leather-armor");
    assert.equal(armored.equipment.slots.armor, "leather-armor");
    assert.equal(armored.equipmentBonuses.defenseBonus, 2);
    pass("裝備皮革護甲並套用防禦加成");

    await grantItem(database, character.characterId, "bronze-sword", 1);
    const swapped = await equipItem(database, character.characterId, "bronze-sword");
    assert.equal(swapped.equipment.slots.weapon, "bronze-sword");
    assert.equal(countOf({ inventory: swapped.inventory }, "iron-sword"), 1);
    assert.equal(swapped.equipmentBonuses.attackBonus, 2);
    pass("更換武器時舊裝備會自動放回背包");

    const unequippedArmor = await unequipItem(database, character.characterId, "armor");
    assert.equal(unequippedArmor.equipment.slots.armor, undefined);
    assert.equal(countOf({ inventory: unequippedArmor.inventory }, "leather-armor"), 1);
    assert.equal(unequippedArmor.equipmentBonuses.defenseBonus, 0);
    const unequippedWeapon = await unequipItem(database, character.characterId, "weapon");
    assert.equal(unequippedWeapon.equipment.slots.weapon, undefined);
    assert.equal(countOf({ inventory: unequippedWeapon.inventory }, "bronze-sword"), 1);
    pass("卸下武器與防具並返還到背包");

    const bonuses = getEquipmentBonuses({ slots: { weapon: "iron-sword", armor: "leather-armor" } });
    const slime = getMonsterDefinition("forest-slime");
    const testCharacter = { level: 1, stats: { str: 1, dex: 1, vit: 1 } };
    assert.equal(calculateBasicAttack(testCharacter, slime, 0.1, bonuses.attackBonus).damage, 6);
    assert.equal(calculateMonsterAttack(testCharacter, slime, 0.1, bonuses.defenseBonus).damage, 1);
    pass("裝備加成會實際影響玩家攻擊及受到的傷害");

    await grantItem(database, character.characterId, "slime-gel", 3);
    const removed = await dropItem(database, character.characterId, "slime-gel", 3);
    assert.equal(countOf({ inventory: removed }, "slime-gel"), 0);
    pass("丟棄整組材料後會從背包移除");

    save = await database.loadCharacterSave(character.characterId);
    const capped = {
      capacity: save.inventory.items.length,
      items: save.inventory.items.map(item => ({ ...item })),
    };
    await database.saveCharacterData(character.characterId, { inventory: capped });
    await expectReject(
      () => grantItem(database, character.characterId, "rough-hide", 1),
      /背包空間不足/,
      "背包滿格",
    );
    const full = await database.loadCharacterSave(character.characterId);
    assert.equal(full.inventory.items.some(item => item.itemId === "rough-hide"), false);
    pass("背包滿格時拒絕放入新種類道具");

    await expectReject(
      () => grantItem(database, character.characterId, "unknown-item", 1),
      /未知道具/,
      "未知道具",
    );
    pass("拒絕未定義道具");

    database.close();
    const reopened = new OfflineCharacterDB({ dbName });
    try {
      const restored = await getInventorySave(reopened, character.characterId);
      assert.equal(restored.character.hp.current, 100);
      assert.equal(restored.character.mp.current, 30);
      assert.equal(countOf(restored, "red-potion"), 2);
      assert.equal(countOf(restored, "blue-potion"), 1);
      assert.equal(countOf(restored, "iron-sword"), 1);
      assert.equal(countOf(restored, "leather-armor"), 1);
      assert.deepEqual(restored.equipment.slots, {});
      pass("重新開啟資料庫後角色、藥水、背包及裝備狀態持續保存");
    } finally {
      reopened.close();
    }

    onLog("全部通過：" + results.length + " 項背包與裝備測試");
    return { passed: results.length, failed: 0, results };
  } finally {
    database.close();
    await deleteDatabase(dbName);
    onLog("已清除背包測試用臨時資料庫。");
  }
}
