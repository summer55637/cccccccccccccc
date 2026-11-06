export const MONSTER_DEFINITIONS = Object.freeze({
  "forest-slime": Object.freeze({
    id: "forest-slime",
    name: "森林史萊姆",
    level: 1,
    maxHp: 28,
    attack: 3,
    defense: 1,
    hitChance: 0.72,
    aggroRange: 3,
    attackRange: 1,
    experience: 18,
    respawnMs: 20_000,
    loot: Object.freeze({ itemId: "slime-gel", name: "透明凝膠", count: 1 }),
    icon: "●",
  }),
  "moss-boar": Object.freeze({
    id: "moss-boar",
    name: "苔原幼獸",
    level: 2,
    maxHp: 46,
    attack: 5,
    defense: 2,
    hitChance: 0.78,
    aggroRange: 3,
    attackRange: 1,
    experience: 36,
    respawnMs: 30_000,
    loot: Object.freeze({ itemId: "rough-hide", name: "粗糙獸皮", count: 1 }),
    icon: "◆",
  }),
});

const SPAWNS = Object.freeze([
  Object.freeze({ spawnId: "slime-west", monsterId: "forest-slime", mapId: "start", position: Object.freeze({ x: 8, y: 4 }) }),
  Object.freeze({ spawnId: "slime-south", monsterId: "forest-slime", mapId: "start", position: Object.freeze({ x: 11, y: 6 }) }),
  Object.freeze({ spawnId: "boar-east", monsterId: "moss-boar", mapId: "start", position: Object.freeze({ x: 14, y: 5 }) }),
]);

export function getMonsterDefinition(monsterId) {
  const definition = MONSTER_DEFINITIONS[monsterId];
  if (!definition) throw new Error("找不到怪物資料：" + String(monsterId));
  return definition;
}

export function getMonsterSpawns(mapId = "start") {
  return SPAWNS
    .filter(spawn => spawn.mapId === mapId)
    .map(spawn => ({
      ...spawn,
      position: { ...spawn.position },
      definition: getMonsterDefinition(spawn.monsterId),
    }));
}
