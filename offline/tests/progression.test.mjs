import assert from "node:assert/strict";
import { OfflineCharacterDB } from "../storage/indexeddb.js";
import {
  CHARACTER_LEVEL_CAP,
  calculateExperienceGain,
  calculateStatAllocation,
  getClassBaseStats,
  getExperienceProgress,
  getExperienceToNextLevel,
} from "../game/progression/rules.js";
import {
  allocateStatPoints,
  awardExperience,
  createProgressionCharacter,
} from "../game/progression/service.js";

function temporaryName() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "offline-progression-test-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除能力值測試資料庫。"));
    request.onblocked = () => reject(new Error("能力值測試資料庫清除被阻擋。"));
  });
}

export async function runProgressionTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  const database = new OfflineCharacterDB({ dbName });
  const results = [];
  const pass = label => {
    results.push(label);
    onLog("✓ 成長系統：" + label);
  };

  try {
    await database.open();
    const knight = await createProgressionCharacter(database, { name: "測試騎士", classId: "knight" });
    assert.deepEqual(knight.stats, getClassBaseStats("knight"));
    assert.equal(knight.statPoints, 0);
    pass("依職業初始化六項能力值");

    const half = await awardExperience(database, knight.characterId, 50);
    assert.equal(half.character.level, 1);
    assert.equal(half.character.experience, 50);
    assert.equal(getExperienceProgress(half.character).percent, 50);
    pass("增加經驗值並正確顯示升級進度");

    const levelUp = await awardExperience(database, knight.characterId, 60);
    assert.deepEqual(levelUp.levelUps, [2]);
    assert.equal(levelUp.character.level, 2);
    assert.equal(levelUp.character.experience, 10);
    assert.equal(levelUp.character.statPoints, 3);
    assert.equal(levelUp.character.hp.max, 112);
    assert.equal(levelUp.character.mp.max, 53);
    pass("跨越升級門檻並保留溢出經驗值");

    const allocated = await allocateStatPoints(database, knight.characterId, "str", 1);
    assert.equal(allocated.stats.str, 13);
    assert.equal(allocated.statPoints, 2);
    pass("消耗能力點數提升指定能力");

    let insufficientRejected = false;
    try { await allocateStatPoints(database, knight.characterId, "agi", 3); }
    catch (error) { insufficientRejected = /能力點數不足/.test(error.message); }
    assert.equal(insufficientRejected, true);
    pass("阻止分配超過持有數量的能力點數");

    let invalidStatRejected = false;
    try { calculateStatAllocation(allocated, "unknown", 1); }
    catch (error) { invalidStatRejected = /未知的能力值/.test(error.message); }
    assert.equal(invalidStatRejected, true);
    pass("拒絕不存在的能力欄位");

    let invalidExpRejected = false;
    try { calculateExperienceGain(allocated, -1); }
    catch (error) { invalidExpRejected = true; }
    assert.equal(invalidExpRejected, true);
    pass("拒絕負數及不合法經驗獎勵");

    const wizard = await createProgressionCharacter(database, { name: "測試法師", classId: "wizard" });
    const wizardLevel = await awardExperience(database, wizard.characterId, getExperienceToNextLevel(1));
    assert.equal(wizardLevel.character.level, 2);
    assert.equal(wizardLevel.character.hp.max, 105);
    assert.equal(wizardLevel.character.mp.max, 62);
    pass("不同職業套用各自 HP／MP 成長規則");

    const maxed = await database.updateCharacter(wizard.characterId, {
      level: CHARACTER_LEVEL_CAP,
      experience: 999999,
    });
    const capped = await awardExperience(database, wizard.characterId, 100000);
    assert.equal(capped.character.level, CHARACTER_LEVEL_CAP);
    assert.equal(capped.character.experience, 0);
    assert.equal(capped.reachedLevelCap, true);
    assert.equal(maxed.level, CHARACTER_LEVEL_CAP);
    pass("遵守最高等級限制，不會溢出等級上限");

    database.close();
    const reopened = new OfflineCharacterDB({ dbName });
    try {
      const restored = await reopened.getCharacter(knight.characterId);
      assert.equal(restored.level, 2);
      assert.equal(restored.stats.str, 13);
      assert.equal(restored.statPoints, 2);
      pass("關閉並重開資料庫後保留成長及能力點數");
    } finally {
      reopened.close();
    }

    onLog("全部通過：" + results.length + " 項成長系統測試");
    return { passed: results.length, failed: 0, results };
  } finally {
    database.close();
    await deleteDatabase(dbName);
    onLog("已清除能力值測試用臨時資料庫。");
  }
}
