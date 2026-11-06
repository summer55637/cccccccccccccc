import assert from "node:assert/strict";

function logPass(onLog, label) {
  onLog("✓ 備份：" + label);
}

async function deleteDatabase(page, dbName) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除備份 UI 測試資料庫。"));
    request.onblocked = () => reject(new Error("備份 UI 測試資料庫仍被其他分頁開啟。"));
  }), dbName);
}

export async function runBackupUITests({ browser, baseUrl, onLog = () => {} }) {
  const dbName = "offline-character-backup-test-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const page = await browser.newPage();
  const pageErrors = [];
  const externalRequests = [];
  const dialogs = [];

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", async dialog => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(baseUrl)) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });

  try {
    const url = baseUrl + "/offline/character/ui/index.html?dbName=" + encodeURIComponent(dbName);
    const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
    assert.equal(response?.status(), 200, "角色管理頁必須正常載入");
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 15000 });
    await page.locator("#exportBackupButton:not([disabled])").waitFor({ timeout: 10000 });
    await page.locator("#importBackupButton:not([disabled])").waitFor({ timeout: 10000 });
    logPass(onLog, "備份按鈕在資料庫就緒後啟用");

    await page.locator("#characterName").fill("備份騎士");
    await page.locator("#classId").selectOption("knight");
    await page.locator("#createButton").click();
    const card = page.locator(".character-card").filter({ hasText: "備份騎士" });
    await card.waitFor({ state: "visible" });
    const characterId = await card.getAttribute("data-character-id");

    await page.evaluate(async ({ dbName: name, id }) => {
      const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
      const database = new OfflineCharacterDB({ dbName: name });
      await database.saveCharacterData(id, {
        inventory: { capacity: 80, items: [{ itemId: "red-potion", count: 12 }] },
        equipment: { slots: { weapon: "iron-sword" } },
        skills: {
          points: 2,
          learned: [{ skillId: "power-strike", level: 3 }],
          shortcuts: [{ slot: 1, skillId: "power-strike" }],
          cooldowns: { "power-strike": 123456789 },
        },
        quests: { entries: [{ questId: "first-journey", status: "done" }] },
      });
      await database.setSetting("selectedCharacterId", id);
      await database.setSetting("backupPreference", { theme: "night", compact: true });
      database.close();
    }, { dbName, id: characterId });
    logPass(onLog, "角色背包、裝備、技能、任務及設定均寫入測試資料");

    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.locator("#exportBackupButton").click();
    let download;
    try {
      download = await downloadPromise;
    } catch (error) {
      const statusText = await page.locator("#appStatus").textContent();
      throw new Error("備份下載沒有產生檔案；畫面狀態：" + statusText + "；原因：" + error.message);
    }
    assert.match(download.suggestedFilename(), /^offline-adventure-save-.*\.json$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const backupText = Buffer.concat(chunks).toString("utf8");
    const backup = JSON.parse(backupText);
    assert.equal(backup.format, "offline-adventure-save");
    assert.equal(backup.version, 1);
    assert.equal(backup.data.characters.length, 1);
    assert.equal(backup.data.inventories[0].items[0].count, 12);
    assert.equal(backup.data.equipment[0].slots.weapon, "iron-sword");
    assert.equal(backup.data.skills[0].learned[0].level, 3);
    assert.equal(backup.data.skills[0].points, 2);
    assert.deepEqual(backup.data.skills[0].shortcuts, [{ slot: 1, skillId: "power-strike" }]);
    assert.equal(backup.data.skills[0].cooldowns["power-strike"], 123456789);
    assert.equal(backup.data.quests[0].entries[0].status, "done");
    assert.equal(backup.data.settings.find(item => item.key === "selectedCharacterId").value, characterId);
    assert.deepEqual(backup.data.settings.find(item => item.key === "backupPreference").value, {
      theme: "night", compact: true,
    });
    logPass(onLog, "下載 JSON 備份並確認六類資料完整");

    const permissionCheck = await page.evaluate(async ({ dbName: name, backupData }) => {
      const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
      const { importCharacterBackup } = await import("/offline/storage/backup.js");
      const database = new OfflineCharacterDB({ dbName: name });
      try {
        await importCharacterBackup(database, backupData);
        return "unexpected-success";
      } catch (error) {
        return error.message;
      } finally {
        database.close();
      }
    }, { dbName, backupData: backup });
    assert.match(permissionCheck, /取得使用者確認/);
    logPass(onLog, "未經明確確認的程式匯入會被拒絕");

    await card.getByRole("button", { name: "刪除角色 備份騎士" }).click();
    await card.waitFor({ state: "detached" });
    assert.equal(await page.locator("#characterCount").textContent(), "0 位");
    logPass(onLog, "匯入前先刪除角色，準備驗證還原");

    await page.locator("#importBackupFile").setInputFiles({
      name: "player-save-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText, "utf8"),
    });
    const restoredCard = page.locator(".character-card").filter({ hasText: "備份騎士" });
    await restoredCard.waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#appStatus").filter({ hasText: "備份還原成功" }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator("#selectedTitle").textContent(), "備份騎士");
    logPass(onLog, "選擇備份檔並確認後還原角色");

    const restoredData = await page.evaluate(async ({ dbName: name, id }) => {
      const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
      const database = new OfflineCharacterDB({ dbName: name });
      try {
        const save = await database.loadCharacterSave(id);
        return {
          count: save.inventory.items[0].count,
          weapon: save.equipment.slots.weapon,
          skillLevel: save.skills.learned[0].level,
          skillPoints: save.skills.points,
          shortcut: save.skills.shortcuts[0],
          cooldown: save.skills.cooldowns["power-strike"],
          questStatus: save.quests.entries[0].status,
          preference: await database.getSetting("backupPreference", null),
        };
      } finally {
        database.close();
      }
    }, { dbName, id: characterId });
    assert.deepEqual(restoredData, {
      count: 12,
      weapon: "iron-sword",
      skillLevel: 3,
      skillPoints: 2,
      shortcut: { slot: 1, skillId: "power-strike" },
      cooldown: 123456789,
      questStatus: "done",
      preference: { theme: "night", compact: true },
    });
    logPass(onLog, "還原後驗證角色附屬存檔及自訂設定");

    await page.locator("#importBackupFile").setInputFiles({
      name: "invalid-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from("{invalid json", "utf8"),
    });
    await page.locator("#appStatus").filter({ hasText: "備份 JSON 格式錯誤" }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator(".character-card").count(), 1);
    assert.equal(await page.locator("#selectedTitle").textContent(), "備份騎士");
    logPass(onLog, "拒絕無效 JSON，且不影響已還原角色");

    assert.ok(dialogs.some(message => message.includes("會取代這個瀏覽器目前的所有角色")), "匯入前必須提示覆蓋風險");
    assert.deepEqual(pageErrors, [], "備份 UI 不得發生 JavaScript 錯誤：" + pageErrors.join("; "));
    assert.deepEqual(externalRequests, [], "備份 UI 不應連線外部服務：" + externalRequests.join("; "));
    onLog("PASS：完整備份匯出、確認後匯入及無效檔案防護");
    return { passed: 8, failed: 0 };
  } finally {
    await page.close();
    const cleanupPage = await browser.newPage();
    await cleanupPage.goto(baseUrl + "/", { waitUntil: "load", timeout: 15000 });
    await deleteDatabase(cleanupPage, dbName);
    await cleanupPage.close();
    onLog("已清除備份 UI 的臨時測試資料庫。");
  }
}
