import { getMapDefinition, getMapTile, isInsideMap } from "./map.js";

const DIRECTIONS = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -1, label: "上方" }),
  down: Object.freeze({ dx: 0, dy: 1, label: "下方" }),
  left: Object.freeze({ dx: -1, dy: 0, label: "左方" }),
  right: Object.freeze({ dx: 1, dy: 0, label: "右方" }),
});

export function calculateMovement(position, direction, mapId = "start") {
  const map = getMapDefinition(mapId);
  if (!isInsideMap(map, position)) throw new RangeError("角色目前座標不在地圖範圍內。");
  const vector = DIRECTIONS[direction];
  if (!vector) throw new Error("不支援的移動方向：" + String(direction));

  const next = { x: position.x + vector.dx, y: position.y + vector.dy };
  const tile = getMapTile(mapId, next.x, next.y);
  if (tile.solid) {
    return {
      moved: false,
      position: { x: position.x, y: position.y },
      direction,
      reason: tile.type === "boundary" ? "已到達地圖邊界。" : "前方有" + ({
        tree: "樹木", rock: "岩石", water: "水域",
      }[tile.type] || "障礙") + "，無法通過。",
    };
  }
  return {
    moved: true,
    position: next,
    direction,
    reason: null,
  };
}

export async function moveCharacter(database, characterId, direction) {
  if (!database || typeof database.getCharacter !== "function" ||
      typeof database.updateCharacter !== "function") {
    throw new TypeError("請提供本機角色資料庫。");
  }
  const character = await database.getCharacter(characterId);
  if (!character) throw new Error("找不到要移動的角色。");
  const result = calculateMovement(character.position, direction, character.mapId);
  if (!result.moved) return { ...result, character };
  const updated = await database.updateCharacter(characterId, { position: result.position });
  return { ...result, character: updated };
}
