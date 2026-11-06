import { OfflineCharacterDB } from "../../storage/indexeddb.js";
import {
  calculateExperienceGain,
  calculateStatAllocation,
  getClassBaseStats,
} from "./rules.js";
import { getMapSpawn } from "../world/map.js";
import { STARTER_ITEMS } from "../inventory/items.js";

export async function createProgressionCharacter(database, input) {
  if (!(database instanceof OfflineCharacterDB)) throw new TypeError("請提供 OfflineCharacterDB 資料庫。");
  const character = await database.createCharacter(input);
  try {
    await database.updateCharacter(character.characterId, {
      stats: getClassBaseStats(character.classId),
      statPoints: 0,
      position: getMapSpawn(character.mapId),
    });
    const save = await database.saveCharacterData(character.characterId, {
      inventory: {
        capacity: 100,
        items: STARTER_ITEMS.map(item => ({ ...item })),
      },
    });
    return save.character;
  } catch (error) {
    await database.deleteCharacter(character.characterId);
    throw error;
  }
}

export async function awardExperience(database, characterId, amount) {
  if (!(database instanceof OfflineCharacterDB)) throw new TypeError("請提供 OfflineCharacterDB 資料庫。");
  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到要增加經驗值的角色。");
  const character = save.character;
  const result = calculateExperienceGain(character, amount);
  const patch = {
    experience: result.experience,
    level: result.level,
    statPoints: result.statPoints,
    hp: result.hp,
    mp: result.mp,
  };
  let updated;
  if (result.levelUps.length > 0) {
    const skills = {
      points: save.skills.points ?? 1,
      learned: save.skills.learned ?? [],
      shortcuts: save.skills.shortcuts ?? [],
      cooldowns: save.skills.cooldowns ?? {},
    };
    const updatedSave = await database.updateCharacterAndSaveData(
      characterId,
      patch,
      { skills: { ...skills, points: skills.points + result.levelUps.length } },
    );
    updated = updatedSave.character;
  } else {
    updated = await database.updateCharacter(characterId, patch);
  }
  return {
    character: updated,
    gained: result.gained,
    levelUps: result.levelUps,
    skillPointsGained: result.levelUps.length,
    reachedLevelCap: result.reachedLevelCap,
  };
}

export async function allocateStatPoints(database, characterId, stat, points = 1) {
  if (!(database instanceof OfflineCharacterDB)) throw new TypeError("請提供 OfflineCharacterDB 資料庫。");
  const character = await database.getCharacter(characterId);
  if (!character) throw new Error("找不到要分配能力點數的角色。");
  const allocation = calculateStatAllocation(character, stat, points);
  return database.updateCharacter(characterId, allocation);
}
