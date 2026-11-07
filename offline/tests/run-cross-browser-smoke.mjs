import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { firefox, webkit } from "playwright";

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

const targets = [
  { name: "Firefox", engine: firefox },
  { name: "WebKit", engine: webkit },
];

try {
  await waitForServer();

  for (const target of targets) {
    const browser = await target.engine.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    const dbName = "offline-compat-" + target.name.toLowerCase();
    const characterName = "相容測試" + target.name;

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
      const databasePage = await context.newPage();
      const databasePageErrors = [];
      const databaseExternalRequests = [];
      databasePage.on("pageerror", error => databasePageErrors.push(error.message));
      databasePage.on("request", request => {
        try {
          const requestUrl = new URL(request.url());
          if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
              requestUrl.origin !== baseOrigin) {
            databaseExternalRequests.push(request.url());
          }
        } catch {
          // Non-HTTP requests are not remote web connections.
        }
      });
      const databaseResponse = await databasePage.goto(
        baseUrl + "/offline/tests/indexeddb-test.html",
        { waitUntil: "load", timeout: 30000 },
      );
      assert.equal(databaseResponse?.status(), 200, target.name + " IndexedDB 測試頁必須載入成功");
      await databasePage.locator("#run").click();
      try {
        await databasePage.locator("#status")
          .filter({ hasText: "成功：17 項測試全部通過" })
          .waitFor({ timeout: 60000 });
      } catch (error) {
        const statusText = await databasePage.locator("#status").textContent();
        const testLog = await databasePage.locator("#log").textContent();
        throw new Error(target.name + " IndexedDB 測試失敗。狀態：" + statusText +
          "\\n測試紀錄：\\n" + testLog + "\\n原始錯誤：" + error.message);
      }
      const databaseLog = await databasePage.locator("#log").textContent();
      assert.match(databaseLog || "", /全部通過：17 項測試/);
      assert.deepEqual(databasePageErrors, [], target.name + " IndexedDB 發生 JavaScript 錯誤：" + databasePageErrors.join("; "));
      assert.deepEqual(databaseExternalRequests, [], target.name + " IndexedDB 測試產生外部網路請求：" + databaseExternalRequests.join("; "));
      process.stdout.write("PASS：" + target.name + " 17 項 IndexedDB 持續存檔與中斷復原測試\\n");
      await databasePage.close();

      const lobbyUrl = baseUrl + "/offline/character/ui/index.html?dbName=" + encodeURIComponent(dbName);
      const lobbyResponse = await page.goto(lobbyUrl, { waitUntil: "load", timeout: 30000 });
      assert.equal(lobbyResponse?.status(), 200, target.name + " 角色管理頁必須載入成功");
      await page.locator('html[data-ready="true"]').waitFor({ timeout: 30000 });
      assert.match(await page.locator("#appStatus").textContent(), /本機角色資料庫已就緒/);

      await page.locator("#characterName").fill(characterName);
      await page.locator("#classId").selectOption("knight");
      await page.locator("#createButton").click();
      await page.locator(".character-card").filter({ hasText: characterName }).waitFor({ state: "visible" });
      await page.locator("#enterButton").click();
      await page.waitForURL(url => url.pathname.endsWith("/offline/game/index.html"), { timeout: 20000 });
      await page.locator('html[data-ready="true"]').waitFor({ timeout: 30000 });
      assert.equal((await page.locator("#characterName").textContent()).trim(), characterName);

      await page.reload({ waitUntil: "load", timeout: 30000 });
      await page.locator('html[data-ready="true"]').waitFor({ timeout: 30000 });
      assert.equal((await page.locator("#characterName").textContent()).trim(), characterName);

      await page.locator("#returnToCharacters").click();
      await page.waitForURL(url => url.pathname.endsWith("/offline/character/ui/index.html"), { timeout: 20000 });
      await page.locator('html[data-ready="true"]').waitFor({ timeout: 30000 });
      await page.locator(".character-card").filter({ hasText: characterName }).waitFor({ state: "visible" });

      assert.deepEqual(pageErrors, [], target.name + " 發生 JavaScript 錯誤：" + pageErrors.join("; "));
      assert.deepEqual(externalRequests, [], target.name + " 產生外部網路請求：" + externalRequests.join("; "));
      process.stdout.write("PASS：" + target.name + " 角色建立、遊戲載入、重新整理保存及返回角色管理\n");
    } finally {
      await context.close();
      await browser.close();
    }
  }

  process.stdout.write("PASS：Firefox 與 WebKit 相容性冒煙測試\n");
} catch (error) {
  process.stderr.write("FAIL：" + (error?.stack || error) + "\n");
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
