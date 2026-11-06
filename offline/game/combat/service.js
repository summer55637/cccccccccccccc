import { awardExperience } from "../progression/service.js";
import { getEquipmentBonuses } from "../inventory/items.js";
import { calculateSkillAttack } from "../skills/rules.js";
import { getMonsterDefinition, getMonsterSpawns } from "./monsters.js";
import {
  BASIC_ATTACK_COOLDOWN_MS,
  calculateBasicAttack,
  calculateMonsterAttack,
  getManhattanDistance,
  getMonsterBrainState,
} from "./rules.js";

function stateKey(characterId) {
  return "combatState:" + characterId;
}

function newMonsterState(spawn) {
  return {
    spawnId: spawn.spawnId,
    monsterId: spawn.monsterId,
    hp: spawn.definition.maxHp,
    maxHp: spawn.definition.maxHp,
    respawnAt: 0,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readCombatState(database, characterId, spawns, now) {
  const saved = await database.getSetting(stateKey(characterId), null);
  const monsters = isRecord(saved?.monsters) ? { ...saved.monsters } : {};
  let changed = !saved || !isRecord(saved.monsters);
  for (const spawn of spawns) {
    const current = monsters[spawn.spawnId];
    if (!isRecord(current) ||
        current.monsterId !== spawn.monsterId ||
        !Number.isSafeInteger(current.hp) ||
        !Number.isSafeInteger(current.maxHp) ||
        !Number.isSafeInteger(current.respawnAt)) {
      monsters[spawn.spawnId] = newMonsterState(spawn);
      changed = true;
      continue;
    }
    if (current.hp <= 0 && current.respawnAt <= now) {
      monsters[spawn.spawnId] = newMonsterState(spawn);
      changed = true;
    }
  }
  const state = {
    lastPlayerAttackAt: Number.isSafeInteger(saved?.lastPlayerAttackAt) ? saved.lastPlayerAttackAt : 0,
    monsters,
  };
  if (changed) await database.setSetting(stateKey(characterId), state);
  return state;
}

function assertDatabase(database) {
  if (!database ||
      typeof database.getCharacter !== "function" ||
      typeof database.getSetting !== "function" ||
      typeof database.setSetting !== "function" ||
      typeof database.loadCharacterSave !== "function" ||
      typeof database.saveCharacterData !== "function") {
    throw new TypeError("請提供支援本機存檔的角色資料庫。");
  }
}

function checkedRandom(random) {
  if (typeof random !== "function") throw new TypeError("隨機判定必須是函式。");
  const value = random();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("隨機判定值必須介於 0（含）到 1（不含）。");
  }
  return value;
}

export async function getMonsterWorldState(database, characterId, now = Date.now()) {
  assertDatabase(database);
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("目前時間格式不正確。");
  const character = await database.getCharacter(characterId);
  if (!character) throw new Error("找不到要讀取戰鬥狀態的角色。");
  const spawns = getMonsterSpawns(character.mapId);
  const state = await readCombatState(database, characterId, spawns, now);
  return spawns.map(spawn => {
    const monsterState = state.monsters[spawn.spawnId];
    const definition = getMonsterDefinition(spawn.monsterId);
    const ai = getMonsterBrainState(
      definition,
      { ...monsterState, position: spawn.position },
      character.position,
    );
    return {
      spawnId: spawn.spawnId,
      monsterId: spawn.monsterId,
      name: definition.name,
      level: definition.level,
      icon: definition.icon,
      position: { ...spawn.position },
      hp: monsterState.hp,
      maxHp: monsterState.maxHp,
      state: ai.state,
      stateLabel: ai.label,
      distance: ai.distance,
      respawnAt: monsterState.respawnAt,
      respawnRemainingMs: monsterState.hp <= 0 ? Math.max(0, monsterState.respawnAt - now) : 0,
    };
  });
}

async function addLootToInventory(database, characterId, loot) {
  const save = await database.loadCharacterSave(characterId);
  if (!save) throw new Error("找不到角色背包。");
  const inventory = save.inventory;
  const items = inventory.items.map(item => ({ ...item }));
  const existing = items.find(item => item.itemId === loot.itemId);
  if (existing) {
    existing.count += loot.count;
  } else {
    if (items.length >= inventory.capacity) return { added: false, inventory };
    items.push({ ...loot });
  }
  const updated = await database.saveCharacterData(characterId, {
    inventory: { capacity: inventory.capacity, items },
  });
  return { added: true, inventory: updated.inventory };
}

export async function attackMonster(database, characterId, spawnId, options = {}) {
  assertDatabase(database);
  if (!isRecord(options)) throw new TypeError("戰鬥選項格式不正確。");
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("目前時間格式不正確。");

  const character = await database.getCharacter(characterId);
  if (!character) throw new Error("找不到要戰鬥的角色。");
  if (character.hp.current <= 0) throw new Error("角色 HP 為 0，請先恢復體力。");

  const spawns = getMonsterSpawns(character.mapId);
  const spawn = spawns.find(item => item.spawnId === spawnId);
  if (!spawn) throw new Error("這張地圖沒有該怪物。");

  const state = await readCombatState(database, characterId, spawns, now);
  const monsterState = state.monsters[spawnId];
  if (monsterState.hp <= 0) throw new Error("這隻怪物正在重生中。");
  if (now - state.lastPlayerAttackAt < BASIC_ATTACK_COOLDOWN_MS) {
    throw new Error("普通攻擊冷卻中，請稍後再攻擊。");
  }

  const distance = getManhattanDistance(character.position, spawn.position);
  if (distance > spawn.definition.attackRange) {
    throw new Error("距離太遠，請移動到怪物旁邊再攻擊。");
  }

  const characterSave = await database.loadCharacterSave(characterId);
  if (!characterSave) throw new Error("找不到角色存檔。");
  const bonuses = getEquipmentBonuses(characterSave.equipment);
  const playerAttack = calculateBasicAttack(
    character,
    spawn.definition,
    checkedRandom(random),
    bonuses.attackBonus,
  );
  monsterState.hp = Math.max(0, monsterState.hp - playerAttack.damage);
  state.lastPlayerAttackAt = now;

  let experienceReward = 0;
  let lootAdded = false;
  let lootName = null;
  let levelUps = [];
  let counterAttack = { hit: false, damage: 0 };

  if (monsterState.hp <= 0) {
    monsterState.respawnAt = now + spawn.definition.respawnMs;
    const progress = await awardExperience(database, characterId, spawn.definition.experience);
    experienceReward = progress.gained;
    levelUps = progress.levelUps;
    const loot = spawn.definition.loot;
    if (loot) {
      const inventoryResult = await addLootToInventory(database, characterId, loot);
      lootAdded = inventoryResult.added;
      lootName = loot.name;
    }
  } else {
    const ai = getMonsterBrainState(
      spawn.definition,
      { ...monsterState, position: spawn.position },
      character.position,
    );
    if (ai.state === "attack") {
      counterAttack = calculateMonsterAttack(character, spawn.definition, checkedRandom(random), bonuses.defenseBonus);
      if (counterAttack.hit) {
        await database.updateCharacter(characterId, {
          hp: {
            current: Math.max(0, character.hp.current - counterAttack.damage),
            max: character.hp.max,
          },
        });
      }
    }
  }

  await database.setSetting(stateKey(characterId), state);
  const updatedCharacter = await database.getCharacter(characterId);
  const updatedMonster = {
    ...monsterState,
    position: { ...spawn.position },
    state: monsterState.hp <= 0 ? "defeated" : "alive",
  };

  return {
    hit: playerAttack.hit,
    damage: playerAttack.damage,
    monster: updatedMonster,
    defeated: monsterState.hp <= 0,
    experience: experienceReward,
    levelUps,
    loot: lootName ? { name: lootName, added: lootAdded } : null,
    counterAttack,
    character: updatedCharacter,
  };
}

/** Cast a learned skill against a monster and persist MP, cooldown and combat state. */
export async function castSkillOnMonster(database, characterId, spawnId, skill, skillLevel, options = {}) {
  assertDatabase(database);
  if (!isRecord(options)) throw new TypeError("技能施放選項格式不正確。");
  if (!isRecord(skill) ||
      typeof skill.skillId !== "string" ||
      !Number.isSafeInteger(skill.mpCost) ||
      !Number.isSafeInteger(skill.cooldownMs) ||
      !Number.isSafeInteger(skill.range)) {
    throw new TypeError("技能資料格式不正確。");
  }
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("目前時間格式不正確。");

  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到要施放技能的角色。");
  const character = save.character;
  if (character.hp.current <= 0) throw new Error("角色 HP 為 0，無法施放技能。");
  if (character.mp.current < skill.mpCost) throw new Error("MP 不足，無法施放此技能。");

  const cooldowns = save.skills.cooldowns || {};
  const readyAt = cooldowns[skill.skillId] || 0;
  if (now < readyAt) {
    const remaining = Math.ceil((readyAt - now) / 1000);
    throw new Error("技能冷卻中，還需要 " + remaining + " 秒。");
  }

  const spawns = getMonsterSpawns(character.mapId);
  const spawn = spawns.find(item => item.spawnId === spawnId);
  if (!spawn) throw new Error("這張地圖沒有該怪物。");
  const state = await readCombatState(database, characterId, spawns, now);
  const monsterState = state.monsters[spawnId];
  if (monsterState.hp <= 0) throw new Error("這隻怪物正在重生中。");
  const distance = getManhattanDistance(character.position, spawn.position);
  if (distance > skill.range) throw new Error("技能距離不足，請靠近目標。");

  const bonuses = getEquipmentBonuses(save.equipment);
  const attack = calculateSkillAttack(
    character,
    skill,
    skillLevel,
    bonuses.attackBonus,
    checkedRandom(random),
    spawn.definition.defense,
  );

  const skills = {
    points: save.skills.points ?? 0,
    learned: save.skills.learned ?? [],
    shortcuts: save.skills.shortcuts ?? [],
    cooldowns: { ...cooldowns, [skill.skillId]: now + skill.cooldownMs },
  };
  const updatedSave = await database.updateCharacterAndSaveData(
    characterId,
    {
      mp: {
        current: character.mp.current - skill.mpCost,
        max: character.mp.max,
      },
    },
    { skills },
  );

  monsterState.hp = Math.max(0, monsterState.hp - attack.damage);
  let experienceReward = 0;
  let loot = null;
  let levelUps = [];
  let counterAttack = { hit: false, damage: 0 };

  if (monsterState.hp <= 0) {
    monsterState.respawnAt = now + spawn.definition.respawnMs;
    const progress = await awardExperience(database, characterId, spawn.definition.experience);
    experienceReward = progress.gained;
    levelUps = progress.levelUps;
    const drop = spawn.definition.loot;
    if (drop) {
      const inventoryResult = await addLootToInventory(database, characterId, drop);
      loot = { name: drop.name, added: inventoryResult.added };
    }
  } else {
    const ai = getMonsterBrainState(
      spawn.definition,
      { ...monsterState, position: spawn.position },
      character.position,
    );
    if (ai.state === "attack") {
      counterAttack = calculateMonsterAttack(
        updatedSave.character,
        spawn.definition,
        checkedRandom(random),
        bonuses.defenseBonus,
      );
      if (counterAttack.hit) {
        await database.updateCharacter(characterId, {
          hp: {
            current: Math.max(0, updatedSave.character.hp.current - counterAttack.damage),
            max: updatedSave.character.hp.max,
          },
        });
      }
    }
  }

  await database.setSetting(stateKey(characterId), state);
  const updatedCharacter = await database.getCharacter(characterId);
  return {
    skillId: skill.skillId,
    skillName: skill.name,
    skillLevel,
    hit: attack.hit,
    damage: attack.damage,
    mpCost: skill.mpCost,
    cooldownUntil: now + skill.cooldownMs,
    monster: {
      ...monsterState,
      position: { ...spawn.position },
      state: monsterState.hp <= 0 ? "defeated" : "alive",
    },
    defeated: monsterState.hp <= 0,
    experience: experienceReward,
    levelUps,
    loot,
    counterAttack,
    character: updatedCharacter,
  };
}
