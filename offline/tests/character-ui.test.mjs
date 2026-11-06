import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

function logPass(onLog, label) {
  onLog(`✓ UI：${label}`);
}
async function deleteDatabase(page, dbName) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除 UI 臨時測試資料庫。"));
    request.onblocked = () => reject(new Error("UI 測試資料庫仍被其他分頁開啟。"));
  }), dbName);
}

export async function runCharacterUITests({ browser, baseUrl, onLog = () => {} }) {
  const dbName = `offline-character-ui-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const page = await browser.newPage();
  const pageErrors = [];
  const externalRequests = [];
  let cleanupPage;

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(baseUrl)) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });

  try {
    const url = `${baseUrl}/offline/character/ui/index.html?dbName=${encodeURIComponent(dbName)}`;
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    assert.equal(response?.status(), 200, "角色管理頁必須正常載入");
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15_000 });
    assert.match(await page.locator("#appStatus").textContent(), /本機角色資料庫已就緒/);
    assert.equal(await page.locator("#characterCount").textContent(), "0 位");
    assert.equal(await page.locator("#emptyState").isVisible(), true);
    logPass(onLog, "開啟角色管理頁及顯示空角色清單");

    await page.locator("#characterName").fill("測試勇士");
    await page.locator("#classId").selectOption("knight");
    await page.locator("#createButton").click();
    const firstCard = page.locator(".character-card").filter({ hasText: "測試勇士" });
    await firstCard.waitFor({ state: "visible" });
    assert.match(await firstCard.textContent(), /騎士/);
    assert.match(await firstCard.textContent(), /Lv\.1/);
    assert.equal(await page.locator("#selectedTitle").textContent(), "測試勇士");
    assert.match(await page.locator("#statDetails").textContent(), /STR 力量 12/);
    assert.match(await page.locator("#statDetails").textContent(), /VIT 體質 12/);
    logPass(onLog, "建立角色、初始化職業與自動選擇");

    await page.evaluate(async ({ name, id }) => {
      const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
      const { awardExperience } = await import("/offline/game/progression/service.js");
      const database = new OfflineCharacterDB({ dbName: name });
      try { await awardExperience(database, id, 100); }
      finally { database.close(); }
    }, { name: dbName, id: await firstCard.getAttribute("data-character-id") });
    await page.reload({ waitUntil: "load" });
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    await page.locator(".character-card").filter({ hasText: "測試勇士" }).waitFor({ state: "visible" });
    assert.match(await page.locator(".character-card").filter({ hasText: "測試勇士" }).textContent(), /Lv\.2/);
    assert.equal(await page.locator("#statPointsLabel").textContent(), "可用能力點數：3");
    assert.match(await page.locator("#experienceText").textContent(), /0 \/ 313|0\/313/);
    await page.locator('#statAllocation button[data-stat="str"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#statDetails")?.textContent?.includes("STR 力量 13") &&
      document.querySelector("#statPointsLabel")?.textContent === "可用能力點數：2"
    );
    assert.match(await page.locator("#statDetails").textContent(), /STR 力量 13/);
    assert.equal(await page.locator("#statPointsLabel").textContent(), "可用能力點數：2");
    logPass(onLog, "經驗升級、能力點數獲得及分配後重新載入保存");

    await firstCard.getByRole("button", { name: "編輯角色 測試勇士" }).click();
    await page.locator("#editName").fill("測試魔導師");
    await page.locator("#editClassId").selectOption("wizard");
    await page.locator('#editForm button[type="submit"]').click();
    const renamedCard = page.locator(".character-card").filter({ hasText: "測試魔導師" });
    await renamedCard.waitFor({ state: "visible" });
    assert.match(await renamedCard.textContent(), /法師/);
    assert.equal(await page.locator("#selectedTitle").textContent(), "測試魔導師");
    logPass(onLog, "編輯角色名稱及職業");

    await page.reload({ waitUntil: "load" });
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15_000 });
    const reloadedCard = page.locator(".character-card").filter({ hasText: "測試魔導師" });
    await reloadedCard.waitFor({ state: "visible" });
    assert.equal(await page.locator("#selectedTitle").textContent(), "測試魔導師");
    assert.equal(await page.locator("#characterCount").textContent(), "1 位");
    logPass(onLog, "重新載入頁面後恢復角色及最後選擇");

    await page.locator("#enterButton").click();
    await page.waitForURL(url => url.pathname.endsWith("/offline/game/index.html"));
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator("#characterName").textContent(), "測試魔導師");
    assert.equal(await page.locator("#characterLevel").textContent(), "Lv.2");
    assert.match(await page.locator("#hpText").textContent(), /112 \/ 112/);
    assert.match(await page.locator("#mpText").textContent(), /53 \/ 53/);
    assert.match(await page.locator("#statGrid").textContent(), /STR 力量 13/);
    assert.match(await page.locator("#gameStatus").textContent(), /本機角色存檔/);
    await page.locator("#returnToCharacters").click();
    await page.waitForURL(url => url.pathname.endsWith("/offline/character/ui/index.html"));
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    logPass(onLog, "進入遊戲主畫面讀取角色狀態，再返回角色選擇");

    await page.locator("#characterName").fill("試驗精靈");
    await page.locator("#classId").selectOption("elf");
    await page.locator("#createButton").click();
    const secondCard = page.locator(".character-card").filter({ hasText: "試驗精靈" });
    await secondCard.waitFor({ state: "visible" });
    assert.equal(await page.locator("#characterCount").textContent(), "2 位");
    assert.equal(await page.locator("#selectedTitle").textContent(), "試驗精靈");
    logPass(onLog, "建立第二位角色並切換目前選擇");

    await secondCard.getByRole("button", { name: "刪除角色 試驗精靈" }).click();
    await secondCard.waitFor({ state: "detached" });
    assert.equal(await page.locator("#characterCount").textContent(), "1 位");
    assert.equal(await page.locator("#selectedPanel").isVisible(), false);
    logPass(onLog, "刪除目前選擇角色並清除選擇狀態");

    const finalCard = page.locator(".character-card").filter({ hasText: "測試魔導師" });
    await finalCard.getByRole("button", { name: "刪除角色 測試魔導師" }).click();
    await finalCard.waitFor({ state: "detached" });
    assert.equal(await page.locator("#characterCount").textContent(), "0 位");
    assert.equal(await page.locator("#emptyState").isVisible(), true);
    logPass(onLog, "刪除最後角色並恢復空清單");

    assert.deepEqual(pageErrors, [], `角色 UI 發生 JavaScript 錯誤：${pageErrors.join("; ")}`);
    assert.deepEqual(externalRequests, [], `角色 UI 不應連線外部服務：${externalRequests.join("; ")}`);
    onLog("PASS：角色 UI 建立、編輯、選擇、重新載入及刪除測試");
    return { passed: 9, failed: 0 };
  } finally {
    await page.close();
    cleanupPage = await browser.newPage();
    await cleanupPage.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 15_000 });
    await deleteDatabase(cleanupPage, dbName);
    await cleanupPage.close();
    await delay(50);
    onLog("已清除角色 UI 的臨時測試資料庫。");
  }
}
