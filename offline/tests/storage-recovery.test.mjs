import assert from "node:assert/strict";

function deleteDatabase(page, name) {
  return page.evaluate(dbName => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除存檔復原測試資料庫。"));
    request.onblocked = () => reject(new Error("清除存檔復原測試資料庫遭其他連線阻擋。"));
  }), name);
}

export async function runStorageRecoveryTests({ browser, baseUrl, onLog = () => {} }) {
  let passed = 0;
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const quotaDbName = "offline-quota-recovery-" + Date.now();

  try {
    const response = await page.goto(baseUrl + "/offline/tests/indexeddb-test.html", {
      waitUntil: "load",
      timeout: 30000,
    });
    assert.equal(response?.status(), 200, "儲存錯誤測試頁必須載入成功");

    const setup = await page.evaluate(async dbName => {
      const { OfflineCharacterDB } = await import("../storage/indexeddb.js");
      const database = new OfflineCharacterDB({ dbName });
      await database.open();
      const character = await database.createCharacter({ name: "配額保護測試", classId: "knight" });
      await database.updateCharacterAndSaveData(character.characterId, { level: 1 }, {
        inventory: { capacity: 100, items: [{ itemId: "baseline-potion", count: 3 }] },
        equipment: { slots: { weapon: "baseline-sword" } },
      });
      window.__quotaTestDatabase = database;
      return { characterId: character.characterId };
    }, quotaDbName);

    const injected = await page.evaluate(async characterId => {
      const prototype = IDBObjectStore.prototype;
      const originalPut = prototype.put;
      let quotaInjected = false;
      prototype.put = function (...args) {
        if (!quotaInjected && this.name === "inventories") {
          quotaInjected = true;
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        return originalPut.apply(this, args);
      };
      try {
        await window.__quotaTestDatabase.updateCharacterAndSaveData(characterId, { level: 2 }, {
          inventory: { capacity: 100, items: [{ itemId: "replacement-potion", count: 99 }] },
          equipment: { slots: { weapon: "replacement-sword" } },
        });
        return { quotaInjected, succeeded: true, message: "" };
      } catch (error) {
        return {
          quotaInjected,
          succeeded: false,
          name: error?.name || "",
          message: error?.message || "",
        };
      } finally {
        prototype.put = originalPut;
      }
    }, setup.characterId);

    assert.equal(injected.quotaInjected, true, "必須在 IndexedDB 寫入邊界注入 QuotaExceededError");
    assert.equal(injected.succeeded, false, "配額錯誤必須使原子存檔失敗");
    assert.equal(injected.message, "瀏覽器儲存空間不足。", "配額錯誤必須轉成繁體中文提示");
    const preserved = await page.evaluate(characterId =>
      window.__quotaTestDatabase.loadCharacterSave(characterId), setup.characterId);
    assert.equal(preserved.character.level, 1, "配額錯誤時角色等級必須回滾");
    assert.deepEqual(preserved.inventory.items, [{ itemId: "baseline-potion", count: 3 }],
      "配額錯誤時背包必須保留舊資料");
    assert.equal(preserved.equipment.slots.weapon, "baseline-sword",
      "配額錯誤時裝備必須保留舊資料");
    passed += 1;
    onLog("PASS：注入 QuotaExceededError，角色、背包及裝備整批回滾並顯示正確訊息");

    await page.evaluate(async characterId => {
      await window.__quotaTestDatabase.updateCharacterAndSaveData(characterId, { level: 2 }, {
        inventory: { capacity: 100, items: [{ itemId: "recovered-potion", count: 4 }] },
      });
    }, setup.characterId);
    const recovered = await page.evaluate(characterId =>
      window.__quotaTestDatabase.loadCharacterSave(characterId), setup.characterId);
    assert.equal(recovered.character.level, 2, "配額錯誤後角色應能再次寫入");
    assert.equal(recovered.inventory.items[0].count, 4, "配額錯誤後背包應能再次寫入");
    passed += 1;
    onLog("PASS：配額錯誤後解除故障注入，可再次正常存檔");

    await page.evaluate(async () => window.__quotaTestDatabase.close());
    await deleteDatabase(page, quotaDbName);
  } finally {
    try {
      await page.evaluate(async () => window.__quotaTestDatabase?.close());
      await deleteDatabase(page, quotaDbName);
    } catch { /* The page may already be closed. */ }
    await context.close();
  }

  const crashContext = await browser.newContext({ serviceWorkers: "block" });
  const writer = await crashContext.newPage();
  const verifier = await crashContext.newPage();
  const crashDbName = "offline-abrupt-close-" + Date.now();

  try {
    await Promise.all([
      writer.goto(baseUrl + "/offline/tests/indexeddb-test.html", { waitUntil: "load" }),
      verifier.goto(baseUrl + "/offline/tests/indexeddb-test.html", { waitUntil: "load" }),
    ]);

    const started = await writer.evaluate(async dbName => {
      function openDatabase() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, 1);
          request.onupgradeneeded = () => {
            const database = request.result;
            database.createObjectStore("checkpoint", { keyPath: "key" });
            database.createObjectStore("pendingWrites", { keyPath: "id" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error || new Error("交易已中止"));
          transaction.onerror = () => {};
        });
      }

      const database = await openDatabase();
      const baseline = database.transaction("checkpoint", "readwrite");
      baseline.objectStore("checkpoint").put({ key: "current", value: "last-good-save" });
      await transactionDone(baseline);

      const transaction = database.transaction(["checkpoint", "pendingWrites"], "readwrite");
      transaction.objectStore("checkpoint").put({ key: "current", value: "must-not-commit" });
      const store = transaction.objectStore("pendingWrites");
      const payload = "x".repeat(4096);
      for (let id = 0; id < 3000; id += 1) store.put({ id, payload });
      window.__pendingCrashDatabase = database;
      window.__pendingCrashTransaction = transaction;
      return { queued: 3000 };
    }, crashDbName);

    assert.equal(started.queued, 3000, "必須成功排入大量未完成寫入");
    await writer.close({ runBeforeUnload: false });

    const afterClose = await verifier.evaluate(async dbName => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(["checkpoint", "pendingWrites"], "readonly");
      const checkpointRequest = transaction.objectStore("checkpoint").get("current");
      const pendingRequest = transaction.objectStore("pendingWrites").count();
      const result = await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve({
          checkpoint: checkpointRequest.result?.value,
          pendingCount: pendingRequest.result,
        });
        transaction.onabort = () => reject(transaction.error || new Error("復原讀取交易中止"));
        transaction.onerror = () => {};
      });
      database.close();
      return result;
    }, crashDbName);

    assert.equal(afterClose.checkpoint, "last-good-save",
      "寫入頁面關閉時，未完成交易不可覆蓋最後成功存檔");
    assert.equal(afterClose.pendingCount, 0,
      "寫入頁面關閉時，未完成交易不可留下部分資料");
    passed += 1;
    onLog("PASS：大量 IndexedDB 寫入途中關閉分頁，重開後保留最後成功存檔且沒有半套資料");

    await deleteDatabase(verifier, crashDbName);
  } finally {
    await writer.close().catch(() => {});
    await verifier.close().catch(() => {});
    await crashContext.close();
  }

  return { passed, failed: 0 };
}
