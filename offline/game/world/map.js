export const START_MAP_ID = "start";

const treeTiles = [
  [2, 1], [3, 1], [3, 2], [4, 2],
  [15, 1], [16, 1], [16, 2], [17, 2],
  [11, 5], [5, 8], [6, 8], [6, 9],
  [13, 10], [14, 10],
];
const rockTiles = [
  [7, 3], [7, 4], [12, 8], [13, 8],
  [2, 9], [3, 9],
];
const waterTiles = [
  [16, 7], [17, 7], [18, 7],
  [16, 8], [17, 8], [18, 8], [17, 9],
];
const pathTiles = [
  [8, 5], [7, 5], [6, 5], [5, 5], [4, 5], [3, 5],
  [10, 5], [10, 6], [10, 7], [10, 8], [10, 9],
  [9, 6], [8, 7], [7, 8], [6, 9],
  [11, 4], [12, 4], [13, 4], [14, 4], [14, 5],
];

function coordinates(items) {
  return new Map(items.map(([x, y]) => [x + "," + y, true]));
}

const startMap = Object.freeze({
  id: START_MAP_ID,
  name: "新手村",
  width: 20,
  height: 12,
  spawn: Object.freeze({ x: 9, y: 5 }),
  trees: coordinates(treeTiles),
  rocks: coordinates(rockTiles),
  water: coordinates(waterTiles),
  paths: coordinates(pathTiles),
});

export function getMapDefinition(mapId = START_MAP_ID) {
  if (mapId !== START_MAP_ID) throw new Error("找不到地圖：" + String(mapId));
  return startMap;
}

export function isInsideMap(map, position) {
  return Number.isSafeInteger(position?.x)
    && Number.isSafeInteger(position?.y)
    && position.x >= 0
    && position.y >= 0
    && position.x < map.width
    && position.y < map.height;
}

export function getMapTile(mapId, x, y) {
  const map = getMapDefinition(mapId);
  const key = x + "," + y;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
      x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { type: "boundary", solid: true };
  }
  if (map.trees.has(key)) return { type: "tree", solid: true };
  if (map.rocks.has(key)) return { type: "rock", solid: true };
  if (map.water.has(key)) return { type: "water", solid: true };
  if (map.paths.has(key)) return { type: "path", solid: false };
  return { type: "grass", solid: false };
}

export function getMapSpawn(mapId = START_MAP_ID) {
  const map = getMapDefinition(mapId);
  return { ...map.spawn };
}
