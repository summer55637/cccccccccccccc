import { OfflineCharacterDB } from "../storage/indexeddb.js";
import {
  getMapDefinition,
  getMapSpawn,
  getMapTile,
  isInsideMap,
} from "../game/world/map.js";
import {
  calculateMovement,
  moveCharacter,
} from "../game/world/movement.js";

const assert = {
  equal(actual, expected, message = "數值不相符。") {
    if (actual !== expected) throw new Error(message + " 實際：" + actual + "；預期：" + expected);
  },
  deepEqual(actual, expected, message = "資料內容不相符。") {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message + " 實際：" + JSON.stringify(actual) + "；預期：" + JSON.stringify(expected));
    }
  },
};

function temporaryName() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "offline-world-test-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除地圖測試資料庫。"));
    request.onblocked = () => reject(new Error("地圖測試資料庫清除被阻擋。"));
  });
}

export async function runWorldTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  const database = new OfflineCharacterDB({ dbName });
  const results = [];
  const pass = label => {
    results.push(label);
    onLog("✓ 地圖移動：" + label);
  };

  try {
    const map = getMapDefinition("start");
    assert.equal(map.width, 20);
    assert.equal(map.height, 12);
    assert.deepEqual(getMapSpawn("start"), { x: 9, y: 5 });
    pass("讀取新手村地圖尺寸及出生座標");

    assert.equal(getMapTile("start", 11, 5).type, "tree");
    assert.equal(getMapTile("start", 11, 5).solid, true);
    assert.equal(getMapTile("start", 7, 3).type, "rock");
    assert.equal(getMapTile("start", 16, 7).type, "water");
    assert.equal(getMapTile("start", 9, 5).solid, false);
    pass("辨識樹木、岩石、水域及可通行地面");

    const spawn = getMapSpawn("start");
    const right = calculateMovement(spawn, "right");
    assert.equal(right.moved, true);
    assert.deepEqual(right.position, { x: 10, y: 5 });
    pass("角色可依方向移動一格");

    const collision = calculateMovement(right.position, "right");
    assert.equal(collision.moved, false);
    assert.deepEqual(collision.position, right.position);
    assert.match(collision.reason, /樹木/);
    pass("碰到樹木時停止且座標不變");

    const boundary = calculateMovement({ x: 0, y: 0 }, "left");
    assert.equal(boundary.moved, false);
    assert.equal(boundary.reason, "已到達地圖邊界。");
    assert.equal(isInsideMap(map, { x: 19, y: 11 }), true);
    assert.equal(isInsideMap(map, { x: 20, y: 11 }), false);
    pass("阻擋地圖外移動並檢查地圖範圍");

    let invalidDirectionRejected = false;
    try { calculateMovement(spawn, "teleport"); }
    catch (error) { invalidDirectionRejected = /不支援的移動方向/.test(error.message); }
    assert.equal(invalidDirectionRejected, true);
    pass("拒絕不支援的移動方向");

    await database.open();
    const character = await database.createCharacter({ name: "地圖測試者", classId: "knight" });
    await database.updateCharacter(character.characterId, { position: spawn, mapId: "start" });
    const moved = await moveCharacter(database, character.characterId, "right");
    assert.equal(moved.moved, true);
    assert.deepEqual(moved.character.position, { x: 10, y: 5 });
    pass("移動服務更新角色 IndexedDB 座標");

    const blocked = await moveCharacter(database, character.characterId, "right");
    assert.equal(blocked.moved, false);
    assert.deepEqual(blocked.character.position, { x: 10, y: 5 });
    pass("碰撞不會寫入錯誤座標");

    database.close();
    const reopened = new OfflineCharacterDB({ dbName });
    try {
      const saved = await reopened.getCharacter(character.characterId);
      assert.deepEqual(saved.position, { x: 10, y: 5 });
      pass("關閉並重新開啟資料庫後仍保留移動位置");
      let missingCharacterRejected = false;
      try { await moveCharacter(reopened, "missing-character", "up"); }
      catch (error) { missingCharacterRejected = /找不到要移動的角色/.test(error.message); }
      assert.equal(missingCharacterRejected, true);
      pass("拒絕移動不存在的角色");
    } finally {
      reopened.close();
    }

    onLog("全部通過：" + results.length + " 項世界地圖測試");
    return { passed: results.length, failed: 0, results };
  } finally {
    database.close();
    await deleteDatabase(dbName);
    onLog("已清除地圖測試用臨時資料庫。");
  }
}
