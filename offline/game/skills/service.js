import { castSkillOnMonster } from "../combat/service.js";
import {
  getClassSkills,
  getSkillDefinition,
  SKILL_POINT_COST,
  SKILL_SHORTCUT_COUNT,
} from "./definitions.js";

function assertDatabase(database) {
  if (!database ||
      typeof database.loadCharacterSave !== "function" ||
      typeof database.saveCharacterData !== "function") {
    throw new TypeError("請提供本機技能存檔資料庫。");
  }
}

function skillRecord(save) {
  return {
    points: save.skills.points ?? 1,
    learned: save.skills.learned ?? [],
    shortcuts: save.skills.shortcuts ?? [],
    cooldowns: save.skills.cooldowns ?? {},
  };
}

function learnedLevel(skills, skillId) {
  return skills.learned.find(item => item.skillId === skillId)?.level || 0;
}

function checkPrerequisite(definition, skills) {
  if (!definition.prerequisite) return true;
  return learnedLevel(skills, definition.prerequisite.skillId) >= definition.prerequisite.level;
}

export async function getSkillBook(database, characterId) {
  assertDatabase(database);
  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到角色技能存檔。");
  const skills = skillRecord(save);
  const definitions = getClassSkills(save.character.classId).map(definition => {
    const level = learnedLevel(skills, definition.skillId);
    const prerequisiteMet = checkPrerequisite(definition, skills);
    const levelMet = save.character.level >= definition.requiredLevel;
    return {
      ...definition,
      level,
      nextLevel: level > 0 && level < definition.maxLevel ? level + 1 : (level === 0 ? 1 : null),
      learned: level > 0,
      maxed: level >= definition.maxLevel,
      prerequisiteMet,
      levelMet,
      canLearn: level < definition.maxLevel &&
        skills.points >= SKILL_POINT_COST &&
        prerequisiteMet &&
        levelMet,
      canCast: level > 0,
    };
  });
  return {
    character: save.character,
    points: skills.points,
    skills: definitions,
    shortcuts: skills.shortcuts.slice().sort((a, b) => a.slot - b.slot),
    cooldowns: { ...skills.cooldowns },
  };
}

export async function learnSkill(database, characterId, skillId) {
  assertDatabase(database);
  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到角色技能存檔。");
  const definition = getSkillDefinition(skillId);
  if (definition.classId !== save.character.classId) {
    throw new Error("這個技能不屬於目前角色的職業。");
  }
  if (save.character.level < definition.requiredLevel) {
    throw new Error("角色等級不足，需要 Lv." + definition.requiredLevel + "。");
  }
  const skills = skillRecord(save);
  if (!checkPrerequisite(definition, skills)) {
    throw new Error("尚未達成前置技能條件。");
  }
  const currentLevel = learnedLevel(skills, skillId);
  if (currentLevel >= definition.maxLevel) throw new Error("技能已達最高等級。");
  if (skills.points < SKILL_POINT_COST) throw new Error("技能點數不足。");

  if (currentLevel === 0) {
    skills.learned.push({ skillId, level: 1 });
  } else {
    const entry = skills.learned.find(item => item.skillId === skillId);
    entry.level += 1;
  }
  skills.points -= SKILL_POINT_COST;
  const updated = await database.saveCharacterData(characterId, { skills });
  return updated.skills;
}

export async function assignSkillShortcut(database, characterId, skillId, slot) {
  assertDatabase(database);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > SKILL_SHORTCUT_COUNT) {
    throw new RangeError("技能快捷欄位必須是 1 到 4。");
  }
  const definition = getSkillDefinition(skillId);
  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到角色技能存檔。");
  if (definition.classId !== save.character.classId) {
    throw new Error("無法將其他職業的技能放入快捷欄。");
  }
  const skills = skillRecord(save);
  if (!learnedLevel(skills, skillId)) throw new Error("只能將已學習的技能放入快捷欄。");
  const existing = skills.shortcuts.filter(item => item.slot !== slot);
  existing.push({ slot, skillId });
  const updated = await database.saveCharacterData(characterId, {
    skills: { ...skills, shortcuts: existing },
  });
  return updated.skills;
}

export async function castSkill(database, characterId, skillId, spawnId, options = {}) {
  assertDatabase(database);
  const save = await database.loadCharacterSave(characterId);
  if (!save?.character) throw new Error("找不到角色技能存檔。");
  const definition = getSkillDefinition(skillId);
  if (definition.classId !== save.character.classId) {
    throw new Error("目前職業無法施放這個技能。");
  }
  const skills = skillRecord(save);
  const level = learnedLevel(skills, skillId);
  if (!level) throw new Error("尚未學習這個技能。");
  return castSkillOnMonster(database, characterId, spawnId, definition, level, options);
}

export { SKILL_SHORTCUT_COUNT };
