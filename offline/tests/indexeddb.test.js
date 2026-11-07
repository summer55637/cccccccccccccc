import { OfflineCharacterDB } from "../storage/indexeddb.js";

function assert(condition, message) {
  if (!condition) throw new Error(`測試失敗：${message}`);
}
function temporaryName() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `offline-character-test-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}
function deleteDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("無法清除臨時測試資料庫。"));
    req.onblocked = () => reject(new Error("清除測試資料庫被其他分頁阻擋。"));
  });
}

export async function runIndexedDBTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  let db = new OfflineCharacterDB({ dbName });
  const results = [];
  const pass = label => { results.push(label); onLog(`✓ ${label}`); };

  try {
    await db.open();
    pass("開啟 IndexedDB 並建立資料表");

    const created = await db.createCharacter({ name: "測試騎士", classId: "knight" });
    assert(created.characterId && created.level === 1, "新角色應取得 ID 並使用預設等級");
    pass("建立角色及初始化附屬資料");

    const found = await db.getCharacter(created.characterId);
    assert(found?.name === "測試騎士", "應讀取剛建立的角色");
    pass("依角色 ID 讀取角色");

    let duplicateRejected = false;
    try { await db.createCharacter({ name: "測試騎士", classId: "knight" }); }
    catch (error) { duplicateRejected = /名稱已存在/.test(error.message); }
    assert(duplicateRejected, "不應允許重複角色名稱");
    pass("阻止重複角色名稱");

    let protectedFieldRejected = false;
    try { await db.updateCharacter(created.characterId, { characterId: "overwrite-id" }); }
    catch (error) { protectedFieldRejected = /不允許更新/.test(error.message); }
    assert(protectedFieldRejected, "不應允許修改角色 ID");
    pass("阻止修改角色識別碼");

    const updated = await db.updateCharacter(created.characterId, {
      level: 8, experience: 12345, stats: { str: 12, agi: 10 }, position: { x: 120.5, y: 88 },
    });
    assert(updated.level === 8 && updated.experience === 12345, "等級與經驗應更新");
    assert(updated.stats.str === 12 && updated.stats.dex === 1, "部分能力更新應保留其他能力");
    pass("更新角色資料及能力值");

    await db.saveCharacterData(created.characterId, {
      inventory: { capacity: 80, items: [{ itemId: "test-potion", count: 5 }] },
      equipment: { slots: { weapon: "test-sword" } },
      skills: { learned: [{ skillId: "test-slash", level: 2 }] },
      quests: { entries: [{ questId: "test-001", status: "active" }] },
    });
    const saved = await db.loadCharacterSave(created.characterId);
    assert(saved.inventory.items[0].count === 5, "背包應保存");
    assert(saved.equipment.slots.weapon === "test-sword", "裝備應保存");
    assert(saved.skills.learned[0].level === 2, "技能應保存");
    assert(saved.quests.entries[0].status === "active", "任務應保存");
    pass("保存及讀取背包、裝備、技能和任務");

    const list = await db.listCharacters();
    assert(list.length === 1 && list[0].characterId === created.characterId, "角色清單應包含角色");
    pass("列出本機角色");

    db.close();
    db = new OfflineCharacterDB({ dbName });
    const reopened = await db.loadCharacterSave(created.characterId);
    assert(reopened?.character.level === 8, "重新開啟後應保留角色");
    assert(reopened.inventory.items[0].itemId === "test-potion", "重新開啟後應保留背包");
    pass("關閉並重新開啟資料庫，確認存檔持續存在");

    assert(await db.deleteCharacter(created.characterId) === true, "刪除既有角色應回傳 true");
    assert(await db.getCharacter(created.characterId) === null, "刪除後角色應不存在");
    assert((await db.listCharacters()).length === 0, "刪除後清單應為空");
    assert(await db.deleteCharacter(created.characterId) === false, "重複刪除應回傳 false");
    pass("刪除角色及其附屬資料");

    const quotaDatabase = new OfflineCharacterDB({
      dbName: temporaryName(),
      indexedDB: {
        open() {
          const request = { error: new DOMException("Quota exceeded", "QuotaExceededError") };
          queueMicrotask(() => request.onerror?.());
          return request;
        },
      },
    });
    let quotaMessage = "";
    try {
      await quotaDatabase.open();
    } catch (error) {
      quotaMessage = error.message;
    } finally {
      quotaDatabase.close();
    }
    assert(quotaMessage === "瀏覽器儲存空間不足。", "儲存配額錯誤應轉成清楚提示");
    pass("瀏覽器儲存配額錯誤會顯示可理解的提示");

    const guardedCharacter = await db.createCharacter({ name: "大小限制測試", classId: "knight" });
    await db.saveCharacterData(guardedCharacter.characterId, {
      inventory: { capacity: 80, items: [{ itemId: "test-potion", count: 5 }] },
    });
    let oversizedRejected = false;
    try {
      await db.saveCharacterData(guardedCharacter.characterId, {
        inventory: { capacity: 80, items: [], note: "x".repeat(1_000_010) },
      });
    } catch (error) {
      oversizedRejected = /太大/.test(error.message);
    }
    const preservedSave = await db.loadCharacterSave(guardedCharacter.characterId);
    assert(oversizedRejected, "超過資料大小限制的存檔必須拒絕");
    assert(preservedSave.inventory.items[0].count === 5, "拒絕大資料時不可破壞原有背包");
    assert(await db.deleteCharacter(guardedCharacter.characterId), "清理大小限制測試角色");
    pass("拒絕超過 1 MB 的存檔資料並保留原有資料");

    const stressStartedAt = performance.now();
    const batch = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      db.createCharacter({
        name: "批次角色" + String(index + 1).padStart(2, "0"),
        classId: index % 2 === 0 ? "knight" : "elf",
      })
    ));
    assert(batch.length === 40, "應能批次建立 40 位角色");
    assert((await db.listCharacters()).length === 40, "批次建立後清單應包含 40 位角色");
    db.close();
    db = new OfflineCharacterDB({ dbName });
    const stressList = await db.listCharacters();
    assert(stressList.length === 40, "重新開啟後應保留全部 40 位角色");
    const sampleSave = await db.loadCharacterSave(batch[19].characterId);
    assert(sampleSave?.character?.name === batch[19].name, "批次角色附屬存檔應可讀取");
    await Promise.all(batch.map(item => db.deleteCharacter(item.characterId)));
    assert((await db.listCharacters()).length === 0, "批次刪除後角色清單應為空");
    const stressDuration = Math.round(performance.now() - stressStartedAt);
    assert(stressDuration < 10000, "40 位角色的批次存取不應超過 10 秒");
    pass("批次建立、重新開啟、讀取及刪除 40 位角色（" + stressDuration + " ms）");

    onLog(`全部通過：${results.length} 項測試`);
    return { passed: results.length, failed: 0, results };
  } finally {
    db.close();
    await deleteDatabase(globalThis.indexedDB, dbName);
    onLog("已清除臨時測試資料庫；不影響正式存檔。");
  }
}
