export const CHARACTER_LEVEL_CAP = 99;
export const STAT_KEYS = Object.freeze(["str", "dex", "int", "agi", "vit", "luk"]);
export const STAT_LABELS = Object.freeze({
  str: "STR 力量",
  dex: "DEX 敏捷",
  int: "INT 智力",
  agi: "AGI 靈巧",
  vit: "VIT 體質",
  luk: "LUK 幸運",
});

// These are original prototype values, not copied from any server database.
export const CLASS_RULES = Object.freeze({
  knight: Object.freeze({
    label: "騎士",
    baseStats: Object.freeze({ str: 12, dex: 9, int: 8, agi: 10, vit: 12, luk: 8 }),
    hpPerLevel: 12,
    mpPerLevel: 3,
  }),
  elf: Object.freeze({
    label: "精靈",
    baseStats: Object.freeze({ str: 9, dex: 12, int: 10, agi: 12, vit: 9, luk: 9 }),
    hpPerLevel: 9,
    mpPerLevel: 6,
  }),
  wizard: Object.freeze({
    label: "法師",
    baseStats: Object.freeze({ str: 8, dex: 10, int: 12, agi: 8, vit: 8, luk: 11 }),
    hpPerLevel: 5,
    mpPerLevel: 12,
  }),
  lord: Object.freeze({
    label: "領主",
    baseStats: Object.freeze({ str: 10, dex: 10, int: 10, agi: 10, vit: 10, luk: 10 }),
    hpPerLevel: 10,
    mpPerLevel: 5,
  }),
});

export function getClassRules(classId) {
  const rule = CLASS_RULES[classId];
  if (!rule) throw new Error("不支援的職業：" + String(classId));
  return rule;
}

export function getClassBaseStats(classId) {
  return { ...getClassRules(classId).baseStats };
}

// Project-owned prototype curve: EXP needed to advance from this level.
export function getExperienceToNextLevel(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level >= CHARACTER_LEVEL_CAP) return 0;
  return Math.max(100, Math.floor(100 * Math.pow(level, 1.65)));
}

export function getExperienceProgress(character) {
  if (!character || !Number.isSafeInteger(character.level)) throw new TypeError("角色等級資料不正確。");
  const required = getExperienceToNextLevel(character.level);
  const current = Math.max(0, Number.isSafeInteger(character.experience) ? character.experience : 0);
  return {
    current: Math.min(current, required),
    required,
    percent: required > 0 ? Math.min(100, Math.floor((current / required) * 100)) : 100,
    isMaxLevel: character.level >= CHARACTER_LEVEL_CAP,
  };
}

export function calculateExperienceGain(character, amount) {
  if (!character || typeof character !== "object") throw new TypeError("角色資料不正確。");
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new RangeError("經驗值獎勵必須是 0 到 1,000,000,000 之間的整數。");
  }
  const rule = getClassRules(character.classId);
  if (!Number.isSafeInteger(character.level) || character.level < 1 || character.level > CHARACTER_LEVEL_CAP) {
    throw new RangeError("角色等級超出目前規則範圍。");
  }
  const next = {
    experience: character.experience,
    level: character.level,
    statPoints: character.statPoints ?? 0,
    hp: { ...character.hp },
    mp: { ...character.mp },
  };
  let remaining = amount;
  const levelUps = [];
  if (next.level >= CHARACTER_LEVEL_CAP) {
    next.experience = 0;
    return { ...next, gained: 0, levelUps, reachedLevelCap: true };
  }

  remaining += next.experience;
  next.experience = 0;
  while (next.level < CHARACTER_LEVEL_CAP) {
    const required = getExperienceToNextLevel(next.level);
    if (remaining < required) {
      next.experience = remaining;
      break;
    }
    remaining -= required;
    next.level += 1;
    next.statPoints += 3;
    next.hp.max += rule.hpPerLevel;
    next.hp.current = Math.min(next.hp.max, next.hp.current + rule.hpPerLevel);
    next.mp.max += rule.mpPerLevel;
    next.mp.current = Math.min(next.mp.max, next.mp.current + rule.mpPerLevel);
    levelUps.push(next.level);
  }
  if (next.level >= CHARACTER_LEVEL_CAP) next.experience = 0;
  return {
    ...next,
    gained: amount,
    levelUps,
    reachedLevelCap: next.level >= CHARACTER_LEVEL_CAP,
  };
}

export function calculateStatAllocation(character, stat, points = 1) {
  if (!character || typeof character !== "object") throw new TypeError("角色資料不正確。");
  if (!STAT_KEYS.includes(stat)) throw new Error("未知的能力值欄位。");
  if (!Number.isSafeInteger(points) || points < 1 || points > 9999) {
    throw new RangeError("分配點數必須是正整數。");
  }
  const available = character.statPoints ?? 0;
  if (!Number.isSafeInteger(available) || available < points) {
    throw new Error("能力點數不足。");
  }
  const current = character.stats?.[stat];
  if (!Number.isSafeInteger(current) || current < 1 || current + points > 9999) {
    throw new RangeError("能力值已達上限或資料不正確。");
  }
  return {
    stats: { ...character.stats, [stat]: current + points },
    statPoints: available - points,
  };
}
