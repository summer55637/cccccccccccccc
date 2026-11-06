export const ITEM_DEFINITIONS = Object.freeze({
  "red-potion": Object.freeze({
    itemId: "red-potion",
    name: "紅色藥水",
    type: "consumable",
    description: "恢復 30 HP。",
    effect: Object.freeze({ gauge: "hp", amount: 30 }),
    stackLimit: 99,
  }),
  "blue-potion": Object.freeze({
    itemId: "blue-potion",
    name: "藍色藥水",
    type: "consumable",
    description: "恢復 20 MP。",
    effect: Object.freeze({ gauge: "mp", amount: 20 }),
    stackLimit: 99,
  }),
  "slime-gel": Object.freeze({
    itemId: "slime-gel",
    name: "透明凝膠",
    type: "material",
    description: "從森林史萊姆取得的材料。",
    stackLimit: 999,
  }),
  "rough-hide": Object.freeze({
    itemId: "rough-hide",
    name: "粗糙獸皮",
    type: "material",
    description: "從苔原幼獸取得的材料。",
    stackLimit: 999,
  }),
  "iron-sword": Object.freeze({
    itemId: "iron-sword",
    name: "鐵劍",
    type: "equipment",
    slot: "weapon",
    description: "普通攻擊傷害 +4。",
    attackBonus: 4,
    stackLimit: 1,
  }),
  "bronze-sword": Object.freeze({
    itemId: "bronze-sword",
    name: "青銅短劍",
    type: "equipment",
    slot: "weapon",
    description: "普通攻擊傷害 +2。",
    attackBonus: 2,
    stackLimit: 1,
  }),
  "leather-armor": Object.freeze({
    itemId: "leather-armor",
    name: "皮革護甲",
    type: "equipment",
    slot: "armor",
    description: "受到怪物攻擊時，傷害 -2。",
    defenseBonus: 2,
    stackLimit: 1,
  }),
});

export const STARTER_ITEMS = Object.freeze([
  Object.freeze({ itemId: "red-potion", count: 2 }),
  Object.freeze({ itemId: "blue-potion", count: 1 }),
  Object.freeze({ itemId: "iron-sword", count: 1 }),
  Object.freeze({ itemId: "leather-armor", count: 1 }),
]);

export const EQUIPMENT_SLOTS = Object.freeze([
  Object.freeze({ slot: "weapon", label: "武器" }),
  Object.freeze({ slot: "armor", label: "防具" }),
]);

export function getItemDefinition(itemId) {
  if (typeof itemId !== "string" || !Object.hasOwn(ITEM_DEFINITIONS, itemId)) {
    throw new Error("未知道具：" + String(itemId));
  }
  const definition = ITEM_DEFINITIONS[itemId];
  return definition;
}

export function getEquipmentBonuses(equipment) {
  const slots = equipment?.slots || {};
  let attackBonus = 0;
  let defenseBonus = 0;
  for (const { slot } of EQUIPMENT_SLOTS) {
    const itemId = slots[slot];
    if (!itemId) continue;
    const item = getItemDefinition(itemId);
    if (item.type !== "equipment" || item.slot !== slot) {
      throw new Error("裝備欄位資料不正確：" + slot);
    }
    attackBonus += item.attackBonus || 0;
    defenseBonus += item.defenseBonus || 0;
  }
  return { attackBonus, defenseBonus };
}
