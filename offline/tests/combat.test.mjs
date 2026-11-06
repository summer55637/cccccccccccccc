import { OfflineCharacterDB } from "../storage/indexeddb.js";
import { getMonsterDefinition, getMonsterSpawns } from "../game/combat/monsters.js";
import { getMonsterBrainState } from "../game/combat/rules.js";
import { attackMonster, getMonsterWorldState } from "../game/combat/service.js";

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
  return "offline-combat-test-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除戰鬥測試資料庫。"));
    request.onblocked = () => reject(new Error("戰鬥測試資料庫清除被阻擋。"));
  });
}
function sequence(values) {
  const remaining = [...values];
  return () => remaining.length ? remaining.shift() : 0.1;
}

export async function runCombatTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  const database = new OfflineCharacterDB({ dbName });
  const results = [];
  const pass = label => {
    results.push(label);
    onLog("✓ 戰鬥：" + label);
  };

  try {
    const spawns = getMonsterSpawns("start");
    assert.equal(spawns.length, 3);
    assert.equal(getMonsterDefinition("forest-slime").name, "森林史萊姆");
    assert.equal(spawns[0].position.x, 8);
    assert.equal(spawns[1].position.y, 6);
    pass("載入自製怪物資料及三個新手村出生點");

    const slime = getMonsterDefinition("forest-slime");
    const sample = { hp: slime.maxHp, position: { x: 8, y: 4 } };
    assert.equal(getMonsterBrainState(slime, sample, { x: 18, y: 10 }).state, "idle");
    assert.equal(getMonsterBrainState(slime, sample, { x: 8, y: 6 }).state, "alert");
    assert.equal(getMonsterBrainState(slime, sample, { x: 8, y: 5 }).state, "attack");
    pass("怪物 AI 會依玩家距離切換待機、警戒及攻擊狀態");

    await database.open();
    const character = await database.createCharacter({ name: "戰鬥測試者", classId: "knight" });
    await database.updateCharacter(character.characterId, {
      position: { x: 8, y: 5 },
      mapId: "start",
      stats: { str: 1, dex: 1, int: 1, agi: 1, vit: 1, luk: 1 },
    });
    const initialWorld = await getMonsterWorldState(database, character.characterId, 10_000);
    assert.equal(initialWorld.length, 3);
    assert.equal(initialWorld.find(monster => monster.spawnId === "slime-west").state, "attack");
    pass("首次讀取會初始化怪物狀態並保存至 IndexedDB");

    let rangeRejected = false;
    try {
      await attackMonster(database, character.characterId, "boar-east", {
        now: 10_000,
        random: () => 0.1,
      });
    } catch (error) {
      rangeRejected = /距離太遠/.test(error.message);
    }
    assert.equal(rangeRejected, true);
    pass("超出攻擊距離時拒絕普通攻擊");

    const miss = await attackMonster(database, character.characterId, "slime-west", {
      now: 10_000,
      random: sequence([0.99, 0.1]),
    });
    assert.equal(miss.hit, false);
    assert.equal(miss.damage, 0);
    assert.equal(miss.counterAttack.hit, true);
    assert.equal(miss.counterAttack.damage, 3);
    assert.equal(miss.character.hp.current, 97);
    pass("攻擊落空時怪物會反擊並扣除角色 HP");

    let cooldownRejected = false;
    try {
      await attackMonster(database, character.characterId, "slime-west", {
        now: 10_300,
        random: () => 0.1,
      });
    } catch (error) {
      cooldownRejected = /冷卻中/.test(error.message);
    }
    assert.equal(cooldownRejected, true);
    pass("普通攻擊冷卻時間會生效");

    const hit = await attackMonster(database, character.characterId, "slime-west", {
      now: 10_800,
      random: sequence([0.1, 0.1]),
    });
    assert.equal(hit.hit, true);
    assert.equal(hit.damage, 2);
    assert.equal(hit.monster.hp, 26);
    assert.equal(hit.counterAttack.hit, true);
    assert.equal(hit.character.hp.current, 94);
    pass("命中後正確計算傷害、怪物 HP 及反擊傷害");

    const beforeKill = await database.getCharacter(character.characterId);
    await database.updateCharacter(character.characterId, {
      stats: { ...beforeKill.stats, str: 100 },
    });
    const defeated = await attackMonster(database, character.characterId, "slime-west", {
      now: 11_600,
      random: () => 0.1,
    });
    assert.equal(defeated.defeated, true);
    assert.equal(defeated.experience, 18);
    assert.equal(defeated.loot.added, true);
    assert.equal(defeated.loot.name, "透明凝膠");
    assert.equal(defeated.character.experience, 18);
    pass("擊敗怪物後獲得經驗值及背包掉落物");

    const saved = await database.loadCharacterSave(character.characterId);
    assert.equal(saved.inventory.items[0].itemId, "slime-gel");
    assert.equal(saved.inventory.items[0].count, 1);
    const deadWorld = await getMonsterWorldState(database, character.characterId, 11_601);
    assert.equal(deadWorld.find(monster => monster.spawnId === "slime-west").hp, 0);
    assert.equal(deadWorld.find(monster => monster.spawnId === "slime-west").state, "defeated");
    pass("背包道具、死亡狀態及重生倒數已保存");

    database.close();
    const reopened = new OfflineCharacterDB({ dbName });
    try {
      const restoredCharacter = await reopened.getCharacter(character.characterId);
      const restoredSave = await reopened.loadCharacterSave(character.characterId);
      const restoredWorld = await getMonsterWorldState(reopened, character.characterId, 11_700);
      assert.equal(restoredCharacter.experience, 18);
      assert.equal(restoredSave.inventory.items[0].count, 1);
      assert.equal(restoredWorld.find(monster => monster.spawnId === "slime-west").hp, 0);
      pass("重新開啟資料庫後，經驗、掉落及怪物死亡狀態仍存在");

      const respawnedWorld = await getMonsterWorldState(reopened, character.characterId, 31_600);
      const respawned = respawnedWorld.find(monster => monster.spawnId === "slime-west");
      assert.equal(respawned.hp, slime.maxHp);
      assert.equal(respawned.state, "attack");
      pass("重生時間到達後怪物會恢復完整 HP");
    } finally {
      reopened.close();
    }

    onLog("全部通過：" + results.length + " 項戰鬥測試");
    return { passed: results.length, failed: 0, results };
  } finally {
    database.close();
    await deleteDatabase(dbName);
    onLog("已清除戰鬥測試用臨時資料庫。");
  }
}
