export const BASIC_ATTACK_COOLDOWN_MS = 700;
export const PLAYER_HIT_CHANCE = 0.9;

export function getManhattanDistance(first, second) {
  if (!first || !second ||
      !Number.isSafeInteger(first.x) || !Number.isSafeInteger(first.y) ||
      !Number.isSafeInteger(second.x) || !Number.isSafeInteger(second.y)) {
    throw new TypeError("戰鬥座標格式不正確。");
  }
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function checkedRoll(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("隨機判定值必須介於 0（含）到 1（不含）。");
  }
  return value;
}

export function getMonsterBrainState(definition, monsterState, playerPosition) {
  if (!definition || !monsterState) throw new TypeError("怪物 AI 缺少必要資料。");
  if (monsterState.hp <= 0) {
    return { state: "defeated", label: "倒下", distance: null };
  }
  const distance = getManhattanDistance(monsterState.position, playerPosition);
  if (distance <= definition.attackRange) return { state: "attack", label: "攻擊", distance };
  if (distance <= definition.aggroRange) return { state: "alert", label: "警戒", distance };
  return { state: "idle", label: "待機", distance };
}

export function calculateBasicAttack(character, definition, roll) {
  if (!character?.stats || !definition) throw new TypeError("普通攻擊缺少角色或怪物資料。");
  const hit = checkedRoll(roll) < PLAYER_HIT_CHANCE;
  const attackPower = Math.max(
    1,
    character.stats.str * 2 + character.level + Math.floor((character.stats.dex || 0) / 5),
  );
  return {
    hit,
    damage: hit ? Math.max(1, attackPower - definition.defense) : 0,
    attackPower,
  };
}

export function calculateMonsterAttack(character, definition, roll) {
  if (!character?.stats || !definition) throw new TypeError("怪物反擊缺少角色或怪物資料。");
  const hit = checkedRoll(roll) < definition.hitChance;
  const mitigation = Math.floor((character.stats.vit || 0) / 5);
  return {
    hit,
    damage: hit ? Math.max(1, definition.attack - mitigation) : 0,
  };
}
