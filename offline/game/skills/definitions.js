const definitions = {
  knight: [
    {
      skillId: "power-strike",
      name: "強力斬擊",
      classId: "knight",
      requiredLevel: 1,
      maxLevel: 3,
      prerequisite: null,
      mpCost: 5,
      cooldownMs: 2200,
      range: 1,
      attribute: "str",
      multiplier: 2.4,
      hitChance: 0.96,
      description: "凝聚力量的一擊，對近身怪物造成大量傷害。",
    },
    {
      skillId: "shield-break",
      name: "破盾重擊",
      classId: "knight",
      requiredLevel: 3,
      maxLevel: 3,
      prerequisite: { skillId: "power-strike", level: 2 },
      mpCost: 8,
      cooldownMs: 3500,
      range: 1,
      attribute: "str",
      multiplier: 3.2,
      hitChance: 0.94,
      description: "突破防禦的重擊，需要先將強力斬擊提升至 2 級。",
    },
  ],
  elf: [
    {
      skillId: "wind-arrow",
      name: "疾風箭",
      classId: "elf",
      requiredLevel: 1,
      maxLevel: 3,
      prerequisite: null,
      mpCost: 4,
      cooldownMs: 1800,
      range: 4,
      attribute: "dex",
      multiplier: 2.2,
      hitChance: 0.97,
      description: "射出迅捷箭矢，可攻擊四格內的怪物。",
    },
    {
      skillId: "double-shot",
      name: "連環箭",
      classId: "elf",
      requiredLevel: 3,
      maxLevel: 3,
      prerequisite: { skillId: "wind-arrow", level: 2 },
      mpCost: 7,
      cooldownMs: 3000,
      range: 4,
      attribute: "dex",
      multiplier: 3.0,
      hitChance: 0.94,
      description: "連續射出兩支箭矢，需要先將疾風箭提升至 2 級。",
    },
  ],
  wizard: [
    {
      skillId: "firebolt",
      name: "火焰箭",
      classId: "wizard",
      requiredLevel: 1,
      maxLevel: 3,
      prerequisite: null,
      mpCost: 6,
      cooldownMs: 2200,
      range: 4,
      attribute: "int",
      multiplier: 2.6,
      hitChance: 0.96,
      description: "以魔力凝聚火焰，攻擊四格內的怪物。",
    },
    {
      skillId: "frost-lance",
      name: "冰霜長矛",
      classId: "wizard",
      requiredLevel: 3,
      maxLevel: 3,
      prerequisite: { skillId: "firebolt", level: 2 },
      mpCost: 10,
      cooldownMs: 3500,
      range: 4,
      attribute: "int",
      multiplier: 3.5,
      hitChance: 0.93,
      description: "以寒冰魔力貫穿敵人，需要先將火焰箭提升至 2 級。",
    },
  ],
  lord: [
    {
      skillId: "royal-strike",
      name: "王者斬",
      classId: "lord",
      requiredLevel: 1,
      maxLevel: 3,
      prerequisite: null,
      mpCost: 5,
      cooldownMs: 2200,
      range: 1,
      attribute: "str",
      multiplier: 2.4,
      hitChance: 0.96,
      description: "領主的近身攻擊，對相鄰怪物造成強力傷害。",
    },
    {
      skillId: "command-blast",
      name: "號令衝擊",
      classId: "lord",
      requiredLevel: 3,
      maxLevel: 3,
      prerequisite: { skillId: "royal-strike", level: 2 },
      mpCost: 8,
      cooldownMs: 3200,
      range: 3,
      attribute: "str",
      multiplier: 3.1,
      hitChance: 0.94,
      description: "以領主威勢發動遠距衝擊，需要先將王者斬提升至 2 級。",
    },
  ],
};

export const SKILL_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(definitions).map(([classId, skills]) => [
      classId,
      Object.freeze(skills.map(skill => Object.freeze({
        ...skill,
        prerequisite: skill.prerequisite ? Object.freeze({ ...skill.prerequisite }) : null,
      }))),
    ]),
  ),
);
export const SKILL_SHORTCUT_COUNT = 4;
export const SKILL_POINT_COST = 1;

export function getClassSkills(classId) {
  return SKILL_DEFINITIONS[classId] || [];
}

export function getSkillDefinition(skillId) {
  for (const skills of Object.values(SKILL_DEFINITIONS)) {
    const definition = skills.find(skill => skill.skillId === skillId);
    if (definition) return definition;
  }
  throw new Error("找不到技能資料：" + String(skillId));
}
