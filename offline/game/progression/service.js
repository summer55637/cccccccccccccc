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
  const character = await database.getCharacter(characterId);
  if (!character) throw new Error("找不到要增加經驗值的角色。");
  const result = calculateExperienceGain(character, amount);
  const updated = await database.updateCharacter(characterId, {
    experience: result.experience,
    level: result.level,
    statPoints: result.statPoints,
    hp: result.hp,
    mp: result.mp,
  });
  return {
    character: updated,
    gained: result.gained,
    levelUps: result.levelUps,
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
