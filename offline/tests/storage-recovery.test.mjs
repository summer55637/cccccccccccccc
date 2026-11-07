import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function runStorageRecoveryTests({ chromium, baseUrl, onLog = () => {} }) {
  let passed = 0;
  const profileDirectory = await mkdtemp(join(tmpdir(), "offline-storage-recovery-"));
  let context;

  try {
    // Use a disposable, non-incognito profile so Chromium's quota override is
    // enforced by the normal QuotaManager path.
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const origin = new URL(baseUrl).origin;
    const quotaDbName = "offline-quota-recovery-" + Date.now();

    try {
      const response = await page.goto(baseUrl + "/offline/tests/indexeddb-test.html", {
        waitUntil: "load",
        timeout: 30000,
      });
      assert.equal(response?.status(), 200, "儲存配額測試頁必須載入成功");

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

      const usageBefore = await cdp.send("Storage.getUsageAndQuota", { origin });
      const forcedQuota = Math.ceil(usageBefore.usage + 128 * 1024);
      await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: forcedQuota });
      const quotaAfter = await cdp.send("Storage.getUsageAndQuota", { origin });
      assert.equal(quotaAfter.overrideActive, true, "Chromium 必須啟用測試用配額限制");
      assert.ok(quotaAfter.quota <= forcedQuota + 1, "測試來源儲存上限必須已降低");
      passed += 1;
      onLog("PASS：持久化測試 Profile 已套用 Chromium IndexedDB 配額限制");

      const quotaResult = await page.evaluate(async characterId => {
        const items = Array.from({ length: 5000 }, (_, index) => {
          const bytes = new Uint8Array(63);
          crypto.getRandomValues(bytes);
          const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
          return { itemId: "q" + token, count: 1 };
        });
        const serializedLength = JSON.stringify({ capacity: 100, items }).length;
        try {
          await window.__quotaTestDatabase.updateCharacterAndSaveData(characterId, { level: 2 }, {
            inventory: { capacity: 100, items },
          });
          return { succeeded: true, serializedLength };
        } catch (error) {
          return { succeeded: false, name: error?.name || "", message: error?.message || "", serializedLength };
        }
      }, setup.characterId);

      assert.ok(quotaResult.serializedLength < 1_000_000,
        "測試資料必須低於應用程式本身的 1 MB 輸入限制");
      assert.equal(quotaResult.succeeded, false,
        "降低儲存配額後的大型寫入必須失敗（資料 " + quotaResult.serializedLength +
        " bytes；quota " + quotaAfter.quota + " bytes；usage " + quotaAfter.usage + " bytes）");
      assert.equal(quotaResult.message, "瀏覽器儲存空間不足。",
        "QuotaExceededError 必須轉成清楚的繁體中文訊息");

      const preserved = await page.evaluate(characterId =>
        window.__quotaTestDatabase.loadCharacterSave(characterId), setup.characterId);
      assert.equal(preserved.character.level, 1, "配額耗盡時角色等級必須原子回滾");
      assert.deepEqual(preserved.inventory.items, [{ itemId: "baseline-potion", count: 3 }],
        "配額耗盡時背包必須保留舊資料");
      assert.equal(preserved.equipment.slots.weapon, "baseline-sword",
        "配額耗盡時裝備必須保留舊資料");
      passed += 1;
      onLog("PASS：實際觸發 QuotaExceededError，角色、背包及裝備均保留原存檔");

      await cdp.send("Storage.overrideQuotaForOrigin", { origin });
      await page.evaluate(async characterId => {
        await window.__quotaTestDatabase.updateCharacterAndSaveData(characterId, { level: 2 }, {
          inventory: { capacity: 100, items: [{ itemId: "recovered-potion", count: 4 }] },
        });
      }, setup.characterId);
      const recovered = await page.evaluate(characterId =>
        window.__quotaTestDatabase.loadCharacterSave(characterId), setup.characterId);
      assert.equal(recovered.character.level, 2, "恢復配額後角色應能再次寫入");
      assert.equal(recovered.inventory.items[0].count, 4, "恢復配額後背包應能再次寫入");
      passed += 1;
      onLog("PASS：解除配額限制後可再次正常存檔");

      await page.evaluate(async () => window.__quotaTestDatabase.close());
      await page.evaluate(dbName => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("測試資料庫清除被阻擋。"));
      }), quotaDbName);
    } finally {
      try { await cdp.send("Storage.overrideQuotaForOrigin", { origin }); } catch { /* Reset quota if the session is still alive. */ }
      try {
        await page.evaluate(async () => window.__quotaTestDatabase?.close());
        await page.evaluate(dbName => new Promise(resolve => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }), quotaDbName);
      } catch { /* The page may already be closed. */ }
      await cdp.detach().catch(() => {});
      await page.close().catch(() => {});
    }

    const writer = await context.newPage();
    const verifier = await context.newPage();
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
      onLog("PASS：交易寫入途中直接關閉分頁，重新開啟後保留最後成功存檔且沒有半套資料");

      await verifier.evaluate(dbName => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("中斷交易測試資料庫清除被阻擋。"));
      }), crashDbName);
    } finally {
      await writer.close().catch(() => {});
      await verifier.close().catch(() => {});
    }

    return { passed, failed: 0 };
  } finally {
    await context?.close().catch(() => {});
    await rm(profileDirectory, { recursive: true, force: true });
  }
}
