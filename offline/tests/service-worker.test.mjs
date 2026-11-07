import assert from "node:assert/strict";

export async function runServiceWorkerTests({ browser, baseUrl, onLog = () => {} }) {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  try {
    const lobbyUrl = baseUrl + "/offline/character/ui/index.html?dbName=offline-sw-test";
    const response = await page.goto(lobbyUrl, { waitUntil: "load", timeout: 30000 });
    assert.equal(response?.status(), 200, "角色管理頁必須能安裝離線快取");
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 20000 });
    assert.match(await page.locator("#appStatus").textContent(), /離線快取已完成/);

    const workerState = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("目前瀏覽器不支援 Service Worker。");
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Service Worker 未接管目前頁面。")), 10000);
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }
      const cacheNames = await caches.keys();
      const cacheName = cacheNames.find(name => name === "offline-adventure-shell-v1");
      if (!cacheName) throw new Error("找不到已安裝的單機版快取。");
      const cache = await caches.open(cacheName);
      const entries = await cache.keys();
      return {
        scope: registration.scope,
        controlled: Boolean(navigator.serviceWorker.controller),
        cacheName,
        entryCount: entries.length,
      };
    });
    assert.ok(workerState.scope.endsWith("/offline/"), "Service Worker 範圍必須限制在 /offline/ 子目錄");
    assert.equal(workerState.controlled, true, "Service Worker 必須接管角色管理頁");
    assert.ok(workerState.entryCount >= 21, "必須預先快取遊戲頁面與所有執行模組");
    onLog("PASS：Service Worker 安裝並預快取 " + workerState.entryCount + " 個本機資源");

    await page.locator("#characterName").fill("離線勇者");
    await page.locator("#classId").selectOption("knight");
    await page.locator("#createButton").click();
    await page.locator(".character-card").filter({ hasText: "離線勇者" }).waitFor({ state: "visible" });
    await page.locator("#enterButton").click();
    await page.waitForURL(url => url.pathname.endsWith("/offline/game/index.html"), { timeout: 15000 });
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 20000 });
    assert.equal((await page.locator("#characterName").textContent()).trim(), "離線勇者");
    assert.match(await page.locator("#gameStatus").textContent(), /離線快取已完成/);

    await context.setOffline(true);
    const offlineResponse = await page.reload({ waitUntil: "load", timeout: 15000 });
    assert.equal(offlineResponse?.status(), 200, "完全斷網後遊戲主畫面仍必須從快取載入");
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    assert.equal((await page.locator("#characterName").textContent()).trim(), "離線勇者");
    assert.equal(await page.evaluate(() => navigator.onLine), false, "瀏覽器必須處於斷網狀態");
    onLog("PASS：斷網重新整理後，遊戲及 IndexedDB 角色資料仍可載入");

    await page.locator("#returnToCharacters").click();
    await page.waitForURL(url => url.pathname.endsWith("/offline/character/ui/index.html"), { timeout: 15000 });
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    await page.locator(".character-card").filter({ hasText: "離線勇者" }).waitFor({ state: "visible" });
    onLog("PASS：斷網後角色管理頁仍可開啟並讀取角色");

    assert.deepEqual(errors, [], "Service Worker 測試發生 JavaScript 錯誤：" + errors.join("; "));
    return { passed: 3 };
  } finally {
    await context.close();
  }
}
