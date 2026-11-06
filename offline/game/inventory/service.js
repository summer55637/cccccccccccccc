import { ITEM_DEFINITIONS, getEquipmentBonuses, getItemDefinition } from "./items.js";

function assertDatabase(database) {
  if (!database ||
      typeof database.loadCharacterSave !== "function" ||
      typeof database.saveCharacterData !== "function" ||
      typeof database.updateCharacterAndSaveData !== "function") {
    throw new TypeError("請提供支援背包原子存檔的角色資料庫。");
  }
}

function checkedCount(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 2_000_000_000) {
    throw new RangeError("道具數量必須是正整數。");
  }
  return count;
}

function findInventoryItem(items, itemId) {
  return items.find(item => item.itemId === itemId);
}

function addToItems(items, itemId, count) {
  const definition = getItemDefinition(itemId);
  const existing = findInventoryItem(items, itemId);
  const currentCount = existing?.count || 0;
  if (currentCount + count > definition.stackLimit) {
    throw new Error("道具堆疊已達上限：" + definition.name);
  }
  if (existing) {
    existing.count += count;
  } else {
    items.push({ itemId, count });
  }
}

function removeFromItems(items, itemId, count) {
  const item = findInventoryItem(items, itemId);
  if (!item || item.count < count) {
    throw new Error("背包中的道具數量不足。");
  }
  item.count -= count;
  if (item.count === 0) items.splice(items.indexOf(item), 1);
}

function assertCapacity(items, capacity) {
  if (items.length > capacity) throw new Error("背包空間不足，無法放入道具。");
}

function copyInventory(save) {
  return {
    capacity: save.inventory.capacity,
    items: save.inventory.items.map(item => ({ ...item })),
  };
}

function copyEquipment(save) {
  return { slots: { ...save.equipment.slots } };
}

export async function getInventorySave(database, characterId) {
  assertDatabase(database);
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色背包。");
  return {
    character: save.character,
    inventory: save.inventory,
    equipment: save.equipment,
    equipmentBonuses: getEquipmentBonuses(save.equipment),
    itemDefinitions: ITEM_DEFINITIONS,
  };
}

export async function grantItem(database, characterId, itemId, count = 1) {
  assertDatabase(database);
  checkedCount(count);
  getItemDefinition(itemId);
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色背包。");
  const inventory = copyInventory(save);
  addToItems(inventory.items, itemId, count);
  assertCapacity(inventory.items, inventory.capacity);
  const updated = await database.saveCharacterData(characterId, { inventory });
  return updated.inventory;
}

export async function useItem(database, characterId, itemId, count = 1) {
  assertDatabase(database);
  checkedCount(count);
  const definition = getItemDefinition(itemId);
  if (definition.type !== "consumable" || !definition.effect) {
    throw new Error("這個道具不能直接使用。");
  }
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色背包。");
  const inventory = copyInventory(save);
  removeFromItems(inventory.items, itemId, count);
  const gaugeName = definition.effect.gauge;
  const gauge = save.character[gaugeName];
  if (!gauge) throw new Error("道具效果無法套用到角色狀態。");
  if (gauge.current >= gauge.max) {
    throw new Error((gaugeName === "hp" ? "HP" : "MP") + " 已經全滿，沒有消耗藥水。");
  }
  const updatedCurrent = Math.min(
    gauge.max,
    gauge.current + definition.effect.amount * count,
  );
  const updated = await database.updateCharacterAndSaveData(
    characterId,
    { [gaugeName]: { current: updatedCurrent, max: gauge.max } },
    { inventory },
  );
  return {
    character: updated.character,
    inventory: updated.inventory,
    restored: updatedCurrent - gauge.current,
    gauge: gaugeName,
  };
}

export async function dropItem(database, characterId, itemId, count = 1) {
  assertDatabase(database);
  checkedCount(count);
  getItemDefinition(itemId);
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色背包。");
  const inventory = copyInventory(save);
  removeFromItems(inventory.items, itemId, count);
  const updated = await database.saveCharacterData(characterId, { inventory });
  return updated.inventory;
}

export async function equipItem(database, characterId, itemId) {
  assertDatabase(database);
  const definition = getItemDefinition(itemId);
  if (definition.type !== "equipment" || !definition.slot) {
    throw new Error("這個道具不能裝備。");
  }
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色存檔。");
  const inventory = copyInventory(save);
  const equipment = copyEquipment(save);
  const current = equipment.slots[definition.slot] || null;
  if (current === itemId) throw new Error("這件裝備已經穿戴中。");

  removeFromItems(inventory.items, itemId, 1);
  if (current) addToItems(inventory.items, current, 1);
  assertCapacity(inventory.items, inventory.capacity);
  equipment.slots[definition.slot] = itemId;

  const updated = await database.saveCharacterData(characterId, { inventory, equipment });
  return {
    inventory: updated.inventory,
    equipment: updated.equipment,
    equipmentBonuses: getEquipmentBonuses(updated.equipment),
  };
}

export async function unequipItem(database, characterId, slot) {
  assertDatabase(database);
  if (!["weapon", "armor"].includes(slot)) throw new Error("未知裝備欄位。");
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色存檔。");
  const inventory = copyInventory(save);
  const equipment = copyEquipment(save);
  const itemId = equipment.slots[slot];
  if (!itemId) throw new Error("這個裝備欄目前是空的。");
  addToItems(inventory.items, itemId, 1);
  assertCapacity(inventory.items, inventory.capacity);
  delete equipment.slots[slot];
  const updated = await database.saveCharacterData(characterId, { inventory, equipment });
  return {
    inventory: updated.inventory,
    equipment: updated.equipment,
    equipmentBonuses: getEquipmentBonuses(updated.equipment),
  };
}
