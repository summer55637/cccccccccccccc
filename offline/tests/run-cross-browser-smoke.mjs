import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { firefox, webkit } from "playwright";
import { runCharacterUITests } from "./character-ui.test.mjs";
import { runBackupUITests } from "./backup-ui.test.mjs";

const baseUrl = "http://127.0.0.1:8081";
const baseOrigin = new URL(baseUrl).origin;
const python = process.env.PYTHON || "python3";
const server = spawn(python, ["-m", "http.server", "8081", "--bind", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: "ignore",
});

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("相容性測試網站提前結束。");
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("等待相容性測試網站逾時。");
}

async function runIndexedDBTests(browser, browserName) {
  const page = await browser.newPage();
  const pageErrors = [];
  const externalRequests = [];

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    try {
      const requestUrl = new URL(request.url());
      if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
          requestUrl.origin !== baseOrigin) {
        externalRequests.push(request.url());
      }
    } catch {
      // Non-HTTP requests are not remote web connections.
    }
  });

  try {
    const response = await page.goto(baseUrl + "/offline/tests/indexeddb-test.html", {
      waitUntil: "load",
      timeout: 30000,
    });
    assert.equal(response?.status(), 200, browserName + " IndexedDB 測試頁必須載入成功");
    await page.locator("#run").click();
    try {
      await page.locator("#status")
        .filter({ hasText: "成功：17 項測試全部通過" })
        .waitFor({ timeout: 60000 });
    } catch (error) {
      const statusText = await page.locator("#status").textContent();
      const testLog = await page.locator("#log").textContent();
      throw new Error(browserName + " IndexedDB 測試失敗。狀態：" + statusText +
        "\n測試紀錄：\n" + testLog + "\n原始錯誤：" + error.message);
    }

    const log = await page.locator("#log").textContent();
    assert.match(log || "", /全部通過：17 項測試/);
    assert.deepEqual(pageErrors, [],
      browserName + " IndexedDB 發生 JavaScript 錯誤：" + pageErrors.join("; "));
    assert.deepEqual(externalRequests, [],
      browserName + " IndexedDB 測試產生外部網路請求：" + externalRequests.join("; "));
    process.stdout.write("PASS：" + browserName + " 17 項 IndexedDB 持續存檔與中斷復原測試\n");
  } finally {
    await page.close();
  }
}

const targets = [
  { name: "Firefox", engine: firefox },
  { name: "WebKit", engine: webkit },
];

try {
  await waitForServer();

  for (const target of targets) {
    const browser = await target.engine.launch({ headless: true });
    try {
      await runIndexedDBTests(browser, target.name);

      const uiResult = await runCharacterUITests({
        browser,
        baseUrl,
        onLog: line => process.stdout.write("[" + target.name + "] " + line + "\n"),
      });
      assert.equal(uiResult.failed, 0, target.name + " 角色管理與遊戲整合測試不得失敗");
      process.stdout.write("PASS：" + target.name + " " + uiResult.passed +
        " 角色／遊戲 UI 整合檢查\n");

      const backupResult = await runBackupUITests({
        browser,
        baseUrl,
        onLog: line => process.stdout.write("[" + target.name + "] " + line + "\n"),
      });
      assert.equal(backupResult.failed, 0, target.name + " 備份／還原 UI 測試不得失敗");
      process.stdout.write("PASS：" + target.name + " " + backupResult.passed +
        " 備份／還原 UI 檢查\n");
    } finally {
      await browser.close();
    }
  }

  process.stdout.write("PASS：Firefox 與 WebKit 完整存檔及遊戲 UI 相容性測試\n");
} catch (error) {
  process.stderr.write("FAIL：" + (error?.stack || error) + "\n");
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
