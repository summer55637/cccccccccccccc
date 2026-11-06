import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { runCharacterUITests } from "./character-ui.test.mjs";
import { runBackupUITests } from "./backup-ui.test.mjs";

const baseUrl = "http://127.0.0.1:8081";
const testUrl = baseUrl + "/offline/tests/indexeddb-test.html";
const repoRoot = process.cwd();
const python = process.env.PYTHON || "python3";
const server = spawn(python, ["-m", "http.server", "8081", "--bind", "127.0.0.1"], {
  cwd: repoRoot,
  stdio: "ignore",
});

let browser;
const pageErrors = [];

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("本機測試網站提前結束，退出碼：" + server.exitCode);
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await delay(250);
  }
  throw new Error("等待本機測試網站逾時。");
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });

  const dbPage = await browser.newPage();
  dbPage.on("pageerror", error => pageErrors.push(error.message));
  await dbPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });

  const response = await dbPage.goto(testUrl, { waitUntil: "load", timeout: 30000 });
  assert.equal(response?.status(), 200, "IndexedDB 測試頁必須正常載入");
  await dbPage.locator("#run").click();
  await dbPage.locator("#status").filter({ hasText: "成功：10 項測試全部通過" }).waitFor({ timeout: 30000 });

  const log = await dbPage.locator("#log").textContent();
  assert.match(log || "", /全部通過：10 項測試/);
  assert.deepEqual(pageErrors, [], "IndexedDB 測試頁發生 JavaScript 錯誤：" + pageErrors.join("; "));
  process.stdout.write(log || "10 項 IndexedDB 測試全部通過。\n");
  process.stdout.write("\nPASS：IndexedDB CRUD and persistence tests\n");
  await dbPage.close();

  const uiResult = await runCharacterUITests({
    browser,
    baseUrl,
    onLog: line => process.stdout.write(line + "\n"),
  });
  assert.equal(uiResult.failed, 0, "角色 UI 測試不得失敗");
  process.stdout.write("PASS：" + uiResult.passed + " character lobby UI checks\n");

  const backupResult = await runBackupUITests({
    browser,
    baseUrl,
    onLog: line => process.stdout.write(line + "\n"),
  });
  assert.equal(backupResult.failed, 0, "存檔備份 UI 測試不得失敗");
  process.stdout.write("PASS：" + backupResult.passed + " backup and restore UI checks\n");
  process.stdout.write("\nPASS：All offline character browser tests\n");
} catch (error) {
  process.stderr.write("\nFAIL：" + (error?.stack || error) + "\n");
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
