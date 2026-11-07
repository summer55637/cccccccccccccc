import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { runCharacterUITests } from "./character-ui.test.mjs";
import { runBackupUITests } from "./backup-ui.test.mjs";
import { runOfflineBoundaryTests } from "./offline-boundary.test.mjs";
import { runServiceWorkerTests } from "./service-worker.test.mjs";
import { runStorageRecoveryTests } from "./storage-recovery.test.mjs";

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
  const boundaryResult = runOfflineBoundaryTests(repoRoot);
  process.stdout.write("PASS：" + boundaryResult.passed + " offline boundary source files scanned\n");
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
  await dbPage.locator("#status").filter({ hasText: "成功：17 項測試全部通過" }).waitFor({ timeout: 30000 });

  const log = await dbPage.locator("#log").textContent();
  assert.match(log || "", /全部通過：17 項測試/);
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

  const worldPage = await browser.newPage();
  const worldErrors = [];
  worldPage.on("pageerror", error => worldErrors.push(error.message));
  await worldPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });
  const worldResponse = await worldPage.goto(baseUrl + "/offline/tests/world-test.html", {
    waitUntil: "load",
    timeout: 30000,
  });
  assert.equal(worldResponse?.status(), 200, "地圖移動測試頁必須正常載入");
  await worldPage.locator("#run").click();
  try {
    await worldPage.locator("#status").filter({
      hasText: "成功：11 項世界地圖測試全部通過",
    }).waitFor({ timeout: 30000 });
  } catch (error) {
    const statusText = await worldPage.locator("#status").textContent();
    const testLog = await worldPage.locator("#log").textContent();
    throw new Error("地圖移動測試失敗。狀態：" + statusText + "\n測試紀錄：\n" + testLog + "\n原始錯誤：" + error.message);
  }
  const worldLog = await worldPage.locator("#log").textContent();
  assert.match(worldLog || "", /全部通過：11 項世界地圖測試/);
  assert.deepEqual(worldErrors, [], "地圖移動測試頁發生 JavaScript 錯誤：" + worldErrors.join("; "));
  process.stdout.write(worldLog || "");
  process.stdout.write("\nPASS：11 world movement checks\n");
  await worldPage.close();

  const combatPage = await browser.newPage();
  const combatErrors = [];
  combatPage.on("pageerror", error => combatErrors.push(error.message));
  await combatPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });
  const combatResponse = await combatPage.goto(baseUrl + "/offline/tests/combat-test.html", {
    waitUntil: "load",
    timeout: 30000,
  });
  assert.equal(combatResponse?.status(), 200, "戰鬥測試頁必須正常載入");
  await combatPage.locator("#run").click();
  try {
    await combatPage.locator("#status").filter({
      hasText: "成功：11 項戰鬥測試全部通過",
    }).waitFor({ timeout: 30000 });
  } catch (error) {
    const statusText = await combatPage.locator("#status").textContent();
    const testLog = await combatPage.locator("#log").textContent();
    throw new Error("戰鬥測試失敗。狀態：" + statusText + "\n測試紀錄：\n" + testLog + "\n原始錯誤：" + error.message);
  }
  const combatLog = await combatPage.locator("#log").textContent();
  assert.match(combatLog || "", /全部通過：11 項戰鬥測試/);
  assert.deepEqual(combatErrors, [], "戰鬥測試頁發生 JavaScript 錯誤：" + combatErrors.join("; "));
  process.stdout.write(combatLog || "");
  process.stdout.write("\nPASS：11 monster and combat checks\n");
  await combatPage.close();

  const inventoryPage = await browser.newPage();
  const inventoryErrors = [];
  inventoryPage.on("pageerror", error => inventoryErrors.push(error.message));
  await inventoryPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });
  const inventoryResponse = await inventoryPage.goto(baseUrl + "/offline/tests/inventory-test.html", {
    waitUntil: "load",
    timeout: 30000,
  });
  assert.equal(inventoryResponse?.status(), 200, "背包測試頁必須正常載入");
  await inventoryPage.locator("#run").click();
  try {
    await inventoryPage.locator("#status").filter({
      hasText: "成功：16 項背包測試全部通過",
    }).waitFor({ timeout: 30000 });
  } catch (error) {
    const statusText = await inventoryPage.locator("#status").textContent();
    const testLog = await inventoryPage.locator("#log").textContent();
    throw new Error("背包測試失敗。狀態：" + statusText + "\n測試紀錄：\n" + testLog + "\n原始錯誤：" + error.message);
  }
  const inventoryLog = await inventoryPage.locator("#log").textContent();
  assert.match(inventoryLog || "", /全部通過：16 項背包與裝備測試/);
  assert.deepEqual(inventoryErrors, [], "背包測試頁發生 JavaScript 錯誤：" + inventoryErrors.join("; "));
  process.stdout.write(inventoryLog || "");
  process.stdout.write("\nPASS：16 inventory and equipment checks\n");
  await inventoryPage.close();

  const skillPage = await browser.newPage();
  const skillErrors = [];
  skillPage.on("pageerror", error => skillErrors.push(error.message));
  await skillPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });
  const skillResponse = await skillPage.goto(baseUrl + "/offline/tests/skills-test.html", {
    waitUntil: "load",
    timeout: 30000,
  });
  assert.equal(skillResponse?.status(), 200, "技能測試頁必須正常載入");
  await skillPage.locator("#run").click();
  try {
    await skillPage.locator("#status").filter({
      hasText: "成功：14 項技能測試全部通過",
    }).waitFor({ timeout: 30000 });
  } catch (error) {
    const statusText = await skillPage.locator("#status").textContent();
    const testLog = await skillPage.locator("#log").textContent();
    throw new Error("技能測試失敗。狀態：" + statusText + "\n測試紀錄：\n" + testLog + "\n原始錯誤：" + error.message);
  }
  const skillLog = await skillPage.locator("#log").textContent();
  assert.match(skillLog || "", /全部通過：14 項技能測試/);
  assert.deepEqual(skillErrors, [], "技能測試頁發生 JavaScript 錯誤：" + skillErrors.join("; "));
  process.stdout.write(skillLog || "");
  process.stdout.write("\nPASS：14 class skill checks\n");
  await skillPage.close();

  const progressionPage = await browser.newPage();
  const progressionErrors = [];
  progressionPage.on("pageerror", error => progressionErrors.push(error.message));
  await progressionPage.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });
  const progressionResponse = await progressionPage.goto(baseUrl + "/offline/tests/progression-test.html", {
    waitUntil: "load",
    timeout: 30000,
  });
  assert.equal(progressionResponse?.status(), 200, "角色成長系統測試頁必須正常載入");
  await progressionPage.locator("#run").click();
  try {
    await progressionPage.locator("#status").filter({
      hasText: "成功：10 項成長系統測試全部通過",
    }).waitFor({ timeout: 30000 });
  } catch (error) {
    const statusText = await progressionPage.locator("#status").textContent();
    const testLog = await progressionPage.locator("#log").textContent();
    throw new Error("角色成長測試失敗。狀態：" + statusText + "\\n測試紀錄：\\n" + testLog + "\\n原始錯誤：" + error.message);
  }
  const progressionLog = await progressionPage.locator("#log").textContent();
  assert.match(progressionLog || "", /全部通過：10 項成長系統測試/);
  assert.deepEqual(progressionErrors, [], "角色成長測試頁發生 JavaScript 錯誤：" + progressionErrors.join("; "));
  process.stdout.write(progressionLog || "");
  process.stdout.write("\nPASS：10 character progression checks\n");
  await progressionPage.close();

  const backupResult = await runBackupUITests({
    browser,
    baseUrl,
    onLog: line => process.stdout.write(line + "\n"),
  });
  assert.equal(backupResult.failed, 0, "存檔備份 UI 測試不得失敗");
  process.stdout.write("PASS：" + backupResult.passed + " backup and restore UI checks\n");

  const serviceWorkerResult = await runServiceWorkerTests({
    browser,
    baseUrl,
    onLog: line => process.stdout.write(line + "\n"),
  });
  process.stdout.write("PASS：" + serviceWorkerResult.passed + " offline service worker checks\n");
  const storageRecoveryResult = await runStorageRecoveryTests({
    browser,
    browserType: chromium,
    baseUrl,
    onLog: line => process.stdout.write(line + "\n"),
  });
  process.stdout.write("PASS：" + storageRecoveryResult.passed + " storage quota and interruption recovery checks\n");
  process.stdout.write("\nPASS：All offline character browser tests\n");
} catch (error) {
  process.stderr.write("\nFAIL：" + (error?.stack || error) + "\n");
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
