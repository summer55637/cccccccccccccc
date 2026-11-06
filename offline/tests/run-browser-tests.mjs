import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:8081";
const testUrl = `${baseUrl}/offline/tests/indexeddb-test.html`;
const repoRoot = process.cwd();
const python = process.env.PYTHON || "python3";
const server = spawn(python, ["-m", "http.server", "8081", "--bind", "127.0.0.1"], {
  cwd: repoRoot,
  stdio: "ignore",
});

let browser;
const pageErrors = [];

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`本機測試網站提前結束，退出碼：${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/`);
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
  const page = await browser.newPage();

  page.on("pageerror", error => pageErrors.push(error.message));

  // The database test must not need the original game server or any external host.
  await page.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(baseUrl) ? route.continue() : route.abort();
  });

  const response = await page.goto(testUrl, { waitUntil: "load", timeout: 30_000 });
  assert.equal(response?.status(), 200, "測試頁必須正常載入");
  await page.locator("#run").click();
  await page.locator("#status").filter({ hasText: "成功：10 項測試全部通過" }).waitFor({ timeout: 30_000 });

  const log = await page.locator("#log").textContent();
  assert.match(log || "", /全部通過：10 項測試/);
  assert.deepEqual(pageErrors, [], `瀏覽器發生 JavaScript 錯誤：${pageErrors.join("; ")}`);

  process.stdout.write(log || "10 項 IndexedDB 測試全部通過。\n");
  process.stdout.write("\nPASS：Chromium IndexedDB browser tests\n");
} catch (error) {
  process.stderr.write(`\nFAIL：${error?.stack || error}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
