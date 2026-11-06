function checkedRoll(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("技能命中判定值必須介於 0（含）到 1（不含）。");
  }
  return value;
}

export function calculateSkillAttack(character, definition, skillLevel, equipmentBonus, roll, targetDefense = 0) {
  if (!character?.stats || !definition) throw new TypeError("技能攻擊缺少角色或技能資料。");
  if (!Number.isSafeInteger(skillLevel) || skillLevel < 1 || skillLevel > definition.maxLevel) {
    throw new RangeError("技能等級超出可用範圍。");
  }
  if (!Number.isSafeInteger(equipmentBonus) || equipmentBonus < 0 || equipmentBonus > 100_000) {
    throw new RangeError("裝備攻擊加成格式不正確。");
  }
  if (!Number.isSafeInteger(targetDefense) || targetDefense < 0 || targetDefense > 100_000) {
    throw new RangeError("目標防禦值格式不正確。");
  }
  const hit = checkedRoll(roll) < definition.hitChance;
  const attributeValue = character.stats[definition.attribute];
  if (!Number.isSafeInteger(attributeValue) || attributeValue < 1) {
    throw new Error("技能主屬性資料不正確。");
  }
  const rankScale = 1 + (skillLevel - 1) * 0.35;
  const rawDamage = Math.floor(
    (attributeValue * definition.multiplier + character.level * 1.2 + equipmentBonus) * rankScale,
  );
  return {
    hit,
    damage: hit ? Math.max(1, rawDamage - targetDefense) : 0,
    rawDamage,
  };
}
