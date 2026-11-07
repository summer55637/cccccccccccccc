import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function deleteDatabase(page, name) {
  return page.evaluate(dbName => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除存檔復原測試資料庫。"));
    request.onblocked = () => reject(new Error("清除存檔復原測試資料庫遭其他連線阻擋。"));
  }), name);
}

export async function runStorageRecoveryTests({ browser, browserType, baseUrl, onLog = () => {} }) {
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


  const workerContext = await browser.newContext({ serviceWorkers: "block" });
  const workerPage = await workerContext.newPage();
  const workerVerifier = await workerContext.newPage();
  const workerDbName = "offline-worker-termination-" + Date.now();

  try {
    await Promise.all([
      workerPage.goto(baseUrl + "/offline/tests/indexeddb-test.html", { waitUntil: "load" }),
      workerVerifier.goto(baseUrl + "/offline/tests/indexeddb-test.html", { waitUntil: "load" }),
    ]);

    const termination = await workerPage.evaluate(async dbName => {
      const workerSource = "\nself.onmessage = event => {\n  const request = indexedDB.open(event.data, 1);\n  request.onupgradeneeded = () => {\n    request.result.createObjectStore(\"checkpoint\", { keyPath: \"key\" });\n    request.result.createObjectStore(\"pendingWrites\", { keyPath: \"id\" });\n  };\n  request.onerror = () => self.postMessage({ type: \"error\", stage: \"open\" });\n  request.onsuccess = () => {\n    const database = request.result;\n    const baseline = database.transaction(\"checkpoint\", \"readwrite\");\n    baseline.objectStore(\"checkpoint\").put({\n      key: \"current\",\n      value: \"last-good-save\",\n    });\n    baseline.oncomplete = () => {\n      const transaction = database.transaction(\n        [\"checkpoint\", \"pendingWrites\"],\n        \"readwrite\",\n      );\n      transaction.objectStore(\"checkpoint\").put({\n        key: \"current\",\n        value: \"must-not-commit\",\n      });\n      const store = transaction.objectStore(\"pendingWrites\");\n      const payload = \"x\".repeat(4096);\n      for (let id = 0; id < 3000; id += 1) {\n        store.put({ id, payload });\n      }\n      self.postMessage({ type: \"queued\", count: 3000 });\n\n      // Keep this worker task alive until the parent terminates its context.\n      const deadline = Date.now() + 30000;\n      while (Date.now() < deadline) { /* intentional termination window */ }\n    };\n  };\n};\n";
      const workerUrl = URL.createObjectURL(new Blob([workerSource], {
        type: "text/javascript",
      }));
      const worker = new Worker(workerUrl);

      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error("等待 Worker 排入 IndexedDB 寫入逾時。"));
          }, 15000);
          worker.onerror = () => {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error("IndexedDB Worker 測試發生錯誤。"));
          };
          worker.onmessage = event => {
            if (event.data?.type === "error") {
              clearTimeout(timeout);
              worker.terminate();
              reject(new Error("Worker 無法建立測試資料庫。"));
              return;
            }
            if (event.data?.type === "queued") {
              clearTimeout(timeout);
              worker.terminate();
              resolve({ queued: event.data.count, terminated: true });
            }
          };
          worker.postMessage(dbName);
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    }, workerDbName);

    assert.equal(termination.queued, 3000, "Worker 必須先排入 3,000 筆未完成寫入");
    assert.equal(termination.terminated, true, "必須強制終止寫入 Worker");

    const afterTermination = await workerVerifier.evaluate(async dbName => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("無法重新開啟 Worker 測試資料庫。"));
      });
      const transaction = database.transaction(
        ["checkpoint", "pendingWrites"],
        "readonly",
      );
      const checkpointRequest = transaction.objectStore("checkpoint").get("current");
      const pendingRequest = transaction.objectStore("pendingWrites").count();
      const result = await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve({
          checkpoint: checkpointRequest.result?.value,
          pendingCount: pendingRequest.result,
        });
        transaction.onabort = () => reject(transaction.error || new Error("Worker 復原讀取交易中止。"));
        transaction.onerror = () => {};
      });
      database.close();
      return result;
    }, workerDbName);

    assert.equal(afterTermination.checkpoint, "last-good-save",
      "Worker 強制終止時，不可覆蓋最後成功存檔");
    assert.equal(afterTermination.pendingCount, 0,
      "Worker 強制終止時，不可留下部分寫入");
    passed += 1;
    onLog("PASS：強制終止正在大量寫入的 Worker，重開後保留最後成功存檔且沒有半套資料");

    await deleteDatabase(workerVerifier, workerDbName);
  } finally {
    await workerPage.close().catch(() => {});
    await workerVerifier.close().catch(() => {});
    await workerContext.close();
  }


  if (process.platform === "win32") {
    onLog("SKIP：整個瀏覽器程序強制終止測試需在 POSIX CI 執行，避免只終止 Chrome 主程序而留下子程序");
  } else {
    const profileDir = await mkdtemp(join(tmpdir(), "offline-browser-crash-"));
    const databaseName = "offline-browser-process-crash-" + Date.now();
    const executablePath = browserType.executablePath();
    let chromeProcess;
    let connectedBrowser;
    let restartProcess;
    let restartedBrowser;

    function startChrome() {
      return spawn(executablePath, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profileDir,
        "about:blank",
      ], {
        detached: true,
        stdio: "ignore",
      });
    }

    async function waitForDevTools(child) {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          throw new Error("Chromium 在啟動遠端除錯介面前就已結束。");
        }
        try {
          const activePort = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
          const port = Number(activePort.split(/\r?\n/)[0]);
          if (Number.isInteger(port) && port > 0) return port;
        } catch {
          // Chromium has not written DevToolsActivePort yet.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("等待 Chromium 遠端除錯連線逾時。");
    }

    async function connectChrome(child) {
      const port = await waitForDevTools(child);
      return browserType.connectOverCDP("http://127.0.0.1:" + port);
    }

    async function killChromeProcessGroup(child) {
      if (!child?.pid || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("Chromium 程序群組未在期限內結束。")),
          10000,
        )),
      ]);
    }

    try {
      chromeProcess = startChrome();
      connectedBrowser = await connectChrome(chromeProcess);
      const persistentContext = connectedBrowser.contexts()[0];
      assert.ok(persistentContext, "必須取得 Chromium 的持久化預設 Context");
      const crashPage = await persistentContext.newPage();
      const response = await crashPage.goto(baseUrl + "/offline/tests/indexeddb-test.html", {
        waitUntil: "load",
        timeout: 30000,
      });
      assert.equal(response?.status(), 200, "程序中斷測試頁必須載入成功");

      let signalReady;
      const ready = new Promise(resolve => { signalReady = resolve; });
      await crashPage.exposeBinding("__notifyProcessCrashReady", (_source, data) => {
        signalReady(data);
      });

      await crashPage.evaluate(dbName => {
        const source = "\nself.onmessage = event => {\n  const request = indexedDB.open(event.data, 1);\n  request.onupgradeneeded = () => {\n    request.result.createObjectStore(\"checkpoint\", { keyPath: \"key\" });\n    request.result.createObjectStore(\"pendingWrites\", { keyPath: \"id\" });\n  };\n  request.onerror = () => self.postMessage({ type: \"error\" });\n  request.onsuccess = () => {\n    const database = request.result;\n    const baseline = database.transaction(\"checkpoint\", \"readwrite\");\n    baseline.objectStore(\"checkpoint\").put({\n      key: \"current\",\n      value: \"last-good-save\",\n    });\n    baseline.oncomplete = () => {\n      const transaction = database.transaction(\n        [\"checkpoint\", \"pendingWrites\"],\n        \"readwrite\",\n      );\n      transaction.objectStore(\"checkpoint\").put({\n        key: \"current\",\n        value: \"must-not-commit\",\n      });\n      const store = transaction.objectStore(\"pendingWrites\");\n      const payload = \"x\".repeat(4096);\n      for (let id = 0; id < 3000; id += 1) {\n        store.put({ id, payload });\n      }\n      self.postMessage({ type: \"queued\", count: 3000 });\n\n      // Keep this event handler active. IndexedDB request completion\n      // events cannot run until this worker event handler returns.\n      const deadline = Date.now() + 30000;\n      while (Date.now() < deadline) { /* intentional crash window */ }\n    };\n  };\n};\n";
        const workerUrl = URL.createObjectURL(new Blob([source], {
          type: "text/javascript",
        }));
        const worker = new Worker(workerUrl);
        worker.onmessage = event => {
          void window.__notifyProcessCrashReady(event.data);
        };
        worker.onerror = () => {
          void window.__notifyProcessCrashReady({ type: "error" });
        };
        worker.postMessage(dbName);
      }, databaseName);

      const queued = await Promise.race([
        ready,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("等待程序中斷測試 Worker 排入寫入逾時。")),
          20000,
        )),
      ]);
      assert.equal(queued?.type, "queued", "Worker 必須先排入未完成 IndexedDB 交易");
      assert.equal(queued.count, 3000, "Worker 必須排入 3,000 筆未完成寫入");
      onLog("INFO：已排入未完成 IndexedDB 交易，現在強制終止整個 Chromium 程序群組");

      await killChromeProcessGroup(chromeProcess);
      await connectedBrowser.close().catch(() => {});
      connectedBrowser = undefined;
      chromeProcess = undefined;

      // The browser process and all renderer/worker children are gone.
      for (const marker of ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"]) {
        await rm(join(profileDir, marker), { force: true }).catch(() => {});
      }

      restartProcess = startChrome();
      restartedBrowser = await connectChrome(restartProcess);
      const restoredContext = restartedBrowser.contexts()[0];
      assert.ok(restoredContext, "重新啟動後必須取得持久化 Chromium Context");
      const verifier = await restoredContext.newPage();
      const verifyResponse = await verifier.goto(baseUrl + "/offline/tests/indexeddb-test.html", {
        waitUntil: "load",
        timeout: 30000,
      });
      assert.equal(verifyResponse?.status(), 200, "重新啟動後復原頁面必須載入成功");

      const restored = await verifier.evaluate(async dbName => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("無法重新開啟瀏覽器中斷測試資料庫。"));
        });
        const transaction = database.transaction(
          ["checkpoint", "pendingWrites"],
          "readonly",
        );
        const checkpointRequest = transaction.objectStore("checkpoint").get("current");
        const pendingRequest = transaction.objectStore("pendingWrites").count();
        const result = await new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve({
            checkpoint: checkpointRequest.result?.value,
            pendingCount: pendingRequest.result,
          });
          transaction.onabort = () => reject(transaction.error || new Error("程序重啟後復原讀取交易中止。"));
          transaction.onerror = () => {};
        });
        database.close();
        return result;
      }, databaseName);

      assert.equal(restored.checkpoint, "last-good-save",
        "整個 Chromium 程序強制終止後必須保留最後成功存檔");
      assert.equal(restored.pendingCount, 0,
        "整個 Chromium 程序強制終止後不可留下未完成交易的部分資料");
      passed += 1;
      onLog("PASS：強制終止整個 Chromium 程序群組並重啟，最後成功存檔保留且沒有半套資料");

      await deleteDatabase(verifier, databaseName);
      await verifier.close();
    } finally {
      await killChromeProcessGroup(chromeProcess).catch(() => {});
      await connectedBrowser?.close().catch(() => {});
      await killChromeProcessGroup(restartProcess).catch(() => {});
      await restartedBrowser?.close().catch(() => {});
      await rm(profileDir, { recursive: true, force: true });
    }
  }


  const quotaTestRoot = process.env.CHROME_QUOTA_TEST_ROOT;
  if (!quotaTestRoot) {
    onLog("SKIP：未設定 CHROME_QUOTA_TEST_ROOT，略過真實儲存配額耗盡測試");
  } else {
    const profileDir = await mkdtemp(join(quotaTestRoot, "offline-real-quota-profile-"));
    const realQuotaContext = await browserType.launchPersistentContext(profileDir, {
      headless: true,
      serviceWorkers: "block",
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const quotaPage = await realQuotaContext.newPage();
    const appDbName = "offline-real-quota-app-" + Date.now();
    const fillerDbName = "offline-real-quota-filler-" + Date.now();
    let appDatabaseReady = false;
    let fillerDatabaseReady = false;

    try {
      const response = await quotaPage.goto(
        baseUrl + "/offline/tests/indexeddb-test.html",
        { waitUntil: "load", timeout: 30000 },
      );
      assert.equal(response?.status(), 200, "真實配額測試頁必須載入成功");

      const baseline = await quotaPage.evaluate(async dbName => {
        const { OfflineCharacterDB } = await import("../storage/indexeddb.js");
        const database = new OfflineCharacterDB({ dbName });
        await database.open();
        const character = await database.createCharacter({
          name: "真實配額測試",
          classId: "knight",
        });
        await database.updateCharacterAndSaveData(
          character.characterId,
          { level: 1 },
          {
            inventory: {
              capacity: 100,
              items: [{ itemId: "baseline-potion", count: 3 }],
            },
            equipment: { slots: { weapon: "baseline-sword" } },
          },
        );
        window.__realQuotaAppDatabase = database;
        return { characterId: character.characterId };
      }, appDbName);
      appDatabaseReady = true;

      const fillResult = await quotaPage.evaluate(async dbName => {
        const MB = 1024 * 1024;
        const initialEstimate = await navigator.storage.estimate();
        const quota = Number(initialEstimate.quota || 0);
        const usage = Number(initialEstimate.usage || 0);
        if (!Number.isFinite(quota) || quota < 1024 * 1024) {
          throw new Error("瀏覽器未回報有效的來源儲存配額。");
        }

        function openDatabase() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => {
              request.result.createObjectStore("payloads", { keyPath: "id" });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("無法建立實際配額填充資料庫。"));
          });
        }

        function randomBytes(length) {
          const bytes = new Uint8Array(length);
          for (let offset = 0; offset < length; offset += 65536) {
            crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, length)));
          }
          return bytes;
        }

        function writeOneBatch(database, id) {
          return new Promise(resolve => {
            let requestErrorName = "";
            let synchronousErrorName = "";
            let settled = false;
            const transaction = database.transaction("payloads", "readwrite");
            const request = transaction.objectStore("payloads").add({
              id,
              payload: new Blob([randomBytes(512 * 1024)], {
                type: "application/octet-stream",
              }),
            });
            request.onerror = () => {
              requestErrorName = request.error?.name || "";
            };
            transaction.oncomplete = () => {
              if (settled) return;
              settled = true;
              resolve({ committed: true, errorName: "" });
            };
            transaction.onabort = () => {
              if (settled) return;
              settled = true;
              resolve({
                committed: false,
                errorName: requestErrorName || transaction.error?.name || synchronousErrorName,
              });
            };
            transaction.onerror = () => {};
          });
        }

        const database = await openDatabase();
        window.__realQuotaFillerDatabase = database;
        const maximumFillBytes = Math.min(
          Math.max(quota - usage + 32 * MB, 64 * MB),
          400 * MB,
        );
        const batchBytes = 512 * 1024;
        let bytesWritten = 0;
        let nextId = 1;
        let quotaExceeded = false;
        let errorName = "";

        while (bytesWritten + batchBytes <= maximumFillBytes) {
          let result;
          try {
            result = await writeOneBatch(database, nextId);
          } catch (error) {
            result = { committed: false, errorName: error?.name || "" };
          }
          if (!result.committed) {
            errorName = result.errorName;
            quotaExceeded = errorName === "QuotaExceededError";
            break;
          }
          bytesWritten += batchBytes;
          nextId += 1;
        }

        database.close();
        window.__realQuotaFillerDatabase = null;
        const afterEstimate = await navigator.storage.estimate();
        return {
          quota,
          usage,
          afterUsage: Number(afterEstimate.usage || 0),
          bytesWritten,
          maximumFillBytes,
          quotaExceeded,
          errorName,
        };
      }, fillerDbName);
      fillerDatabaseReady = true;

      onLog(
        "INFO：真實配額測試初始估算 " +
        fillResult.usage + "/" + fillResult.quota +
        " bytes；實際完成寫入 " + fillResult.bytesWritten + " bytes；錯誤 " +
        (fillResult.errorName || "未觸發"),
      );
      assert.equal(
        fillResult.quotaExceeded,
        true,
        "必須由瀏覽器實際 IndexedDB 配額檢查觸發 QuotaExceededError，而非故障注入",
      );
      passed += 1;
      onLog("PASS：持久化 Chromium 實際寫入資料直到 IndexedDB 回報 QuotaExceededError");

      const appWrite = await quotaPage.evaluate(async characterId => {
        const items = Array.from({ length: 5000 }, () => ({
          itemId: "x".repeat(128),
          count: 1,
          extra: "y".repeat(37),
        }));
        const payloadSize = JSON.stringify({
          capacity: 5000,
          items,
        }).length;
        try {
          await window.__realQuotaAppDatabase.updateCharacterAndSaveData(
            characterId,
            { level: 2 },
            {
              inventory: { capacity: 5000, items },
              equipment: { slots: { weapon: "replacement-sword" } },
            },
          );
          return { succeeded: true, name: "", message: "", payloadSize };
        } catch (error) {
          return {
            succeeded: false,
            name: error?.name || "",
            message: error?.message || "",
            payloadSize,
          };
        }
      }, baseline.characterId);

      assert.ok(
        appWrite.payloadSize < 1_000_000,
        "應用程式存檔測試資料必須留在存檔格式允許的 1 MB 範圍內",
      );
      assert.equal(
        appWrite.succeeded,
        false,
        "儲存配額耗盡後，應用程式的原子存檔必須被瀏覽器拒絕",
      );
      assert.equal(appWrite.name, "QuotaExceededError",
        "應用程式原子存檔應收到真實 QuotaExceededError");
      assert.equal(appWrite.message, "瀏覽器儲存空間不足。",
        "真實配額耗盡必須顯示正確繁體中文提示");

      const preserved = await quotaPage.evaluate(characterId =>
        window.__realQuotaAppDatabase.loadCharacterSave(characterId),
      baseline.characterId);
      assert.equal(preserved.character.level, 1, "真實配額耗盡時角色資料必須回滾");
      assert.deepEqual(
        preserved.inventory.items,
        [{ itemId: "baseline-potion", count: 3 }],
        "真實配額耗盡時背包必須保留舊資料",
      );
      assert.equal(
        preserved.equipment.slots.weapon,
        "baseline-sword",
        "真實配額耗盡時裝備必須保留舊資料",
      );
      passed += 1;
      onLog("PASS：真實儲存配額耗盡時，角色、背包及裝備原子存檔整批回滾並顯示正確訊息");

      await deleteDatabase(quotaPage, fillerDbName);
      fillerDatabaseReady = false;
      await quotaPage.evaluate(async characterId => {
        await window.__realQuotaAppDatabase.updateCharacterAndSaveData(
          characterId,
          { level: 2 },
          {
            inventory: {
              capacity: 100,
              items: [{ itemId: "recovered-potion", count: 4 }],
            },
          },
        );
      }, baseline.characterId);
      const recovered = await quotaPage.evaluate(characterId =>
        window.__realQuotaAppDatabase.loadCharacterSave(characterId),
      baseline.characterId);
      assert.equal(recovered.character.level, 2, "釋放空間後角色必須可再次存檔");
      assert.deepEqual(
        recovered.inventory.items,
        [{ itemId: "recovered-potion", count: 4 }],
        "釋放空間後背包必須可再次存檔",
      );
      passed += 1;
      onLog("PASS：刪除配額填充資料釋放空間後，遊戲存檔可再次成功");

      await quotaPage.evaluate(async () => window.__realQuotaAppDatabase.close());
      appDatabaseReady = false;
      await deleteDatabase(quotaPage, appDbName);
    } finally {
      try {
        await quotaPage.evaluate(async () => {
          window.__realQuotaFillerDatabase?.close();
          await window.__realQuotaAppDatabase?.close();
        });
        if (fillerDatabaseReady) await deleteDatabase(quotaPage, fillerDbName);
        if (appDatabaseReady) await deleteDatabase(quotaPage, appDbName);
      } catch {
        // The context may already have been closed after an assertion failure.
      }
      await realQuotaContext.close();
      await rm(profileDir, { recursive: true, force: true });
    }
  }

  return { passed, failed: 0 };
}
