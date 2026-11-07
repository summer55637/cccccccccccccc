import assert from "node:assert/strict";

const PROFILES = [
  { width: 390, height: 844, label: "手機直向 390×844" },
  { width: 844, height: 390, label: "手機橫向 844×390" },
];

async function waitUntilReady(page, label) {
  await page.waitForFunction(() => {
    const state = document.documentElement.dataset.ready;
    return state === "true" || state === "error" || state === "empty";
  }, { timeout: 30000 });
  const state = await page.evaluate(() => ({
    ready: document.documentElement.dataset.ready,
    message: document.querySelector("#gameStatus")?.textContent ||
      document.querySelector("#appStatus")?.textContent || "",
  }));
  assert.equal(state.ready, "true", label + " 初始化失敗：" + state.ready + "；" + state.message);
}

async function readSavedPosition(page, dbName, characterId) {
  return page.evaluate(async ({ name, id }) => {
    const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
    const database = new OfflineCharacterDB({ dbName: name });
    try {
      const character = await database.getCharacter(id);
      if (!character) throw new Error("長時操作測試角色不見了。");
      return {
        position: character.position,
        updatedAt: character.updatedAt,
        mapId: character.mapId,
      };
    } finally {
      database.close();
    }
  }, { name: dbName, id: characterId });
}

async function deleteDatabase(browser, baseUrl, dbName) {
  const cleanupContext = await browser.newContext();
  const page = await cleanupContext.newPage();
  try {
    await page.goto(baseUrl + "/", { waitUntil: "load", timeout: 15000 });
    await page.evaluate(name => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("無法清除長時操作測試資料庫。"));
      request.onblocked = () => reject(new Error("長時操作測試資料庫仍有分頁開啟。"));
    }), dbName);
  } finally {
    await cleanupContext.close();
  }
}

export async function runMobileSessionSoakTests({ browser, baseUrl, onLog = () => {} }) {
  let passed = 0;
  let totalMoves = 0;
  let totalReloads = 0;

  for (const profile of PROFILES) {
    const dbName = "offline-mobile-soak-" + profile.width + "-" + Date.now();
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    const slowMoves = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") pageErrors.push("console: " + message.text());
    });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(baseUrl)) return route.continue();
      externalRequests.push(url);
      return route.abort();
    });

    try {
      const lobbyResponse = await page.goto(
        baseUrl + "/offline/character/ui/index.html?dbName=" + encodeURIComponent(dbName),
        { waitUntil: "load", timeout: 30000 },
      );
      assert.equal(lobbyResponse?.status(), 200, profile.label + " 角色管理頁必須載入成功");
      await waitUntilReady(page, profile.label + " 角色管理頁");
      await page.locator("#characterName").fill("長時操作測試角色");
      await page.locator("#classId").selectOption("knight");
      await page.locator("#createButton").tap();
      await page.locator(".character-card").filter({ hasText: "長時操作測試角色" })
        .waitFor({ state: "visible" });
      const enterButton = page.locator("#enterButton");
      await enterButton.tap();
      await page.waitForURL(url => url.pathname.endsWith("/offline/game/index.html"), {
        timeout: 20000,
      });
      await waitUntilReady(page, profile.label + " 遊戲主畫面");

      const characterId = await page.evaluate(async name => {
        const { OfflineCharacterDB } = await import("/offline/storage/indexeddb.js");
        const database = new OfflineCharacterDB({ dbName: name });
        try {
          const characters = await database.listCharacters();
          const target = characters.find(item => item.name === "長時操作測試角色");
          if (!target) throw new Error("找不到剛建立的長時操作角色。");
          return target.characterId;
        } finally {
          database.close();
        }
      }, dbName);

      assert.equal(await page.locator("#positionText").textContent(), "9, 5");
      assert.equal(await page.locator("#movementControls button[data-move]").count(), 4);
      const startTime = Date.now();
      let moves = 0;

      // 10 round trips per checkpoint = 20 actual touch moves.
      // The test stays on the clear (9,5) <-> (10,5) corridor.
      for (let checkpoint = 1; checkpoint <= 3; checkpoint += 1) {
        for (let cycle = 0; cycle < 10; cycle += 1) {
          for (const step of [
            { direction: "right", position: "10, 5" },
            { direction: "left", position: "9, 5" },
          ]) {
            const moveStartedAt = Date.now();
            await page.locator('#movementControls button[data-move="' + step.direction + '"]').tap();
            await page.waitForFunction(expected => {
              const position = document.querySelector("#positionText")?.textContent;
              const status = document.querySelector("#gameStatus")?.textContent || "";
              return position === expected && status.includes("位置已自動保存");
            }, step.position, { timeout: 5000 });
            const elapsed = Date.now() - moveStartedAt;
            if (elapsed > 2000) slowMoves.push({ move: moves + 1, elapsed });
            moves += 1;
          }
        }

        const saved = await readSavedPosition(page, dbName, characterId);
        assert.equal(saved.mapId, "start", profile.label + " 角色地圖不可改變");
        assert.deepEqual(saved.position, { x: 9, y: 5 },
          profile.label + " 每個存檔檢查點必須與最新畫面座標一致");
        await page.reload({ waitUntil: "load", timeout: 30000 });
        await waitUntilReady(page, profile.label + " 第 " + checkpoint + " 次重新載入");
        assert.equal(await page.locator("#positionText").textContent(), "9, 5",
          profile.label + " 重新載入後必須恢復最後保存座標");
        const reloaded = await readSavedPosition(page, dbName, characterId);
        assert.deepEqual(reloaded.position, { x: 9, y: 5 },
          profile.label + " 重新載入不得產生資料偏差");
        totalReloads += 1;
      }

      // One more round trip after the final reload proves the controls remain responsive.
      await page.locator('#movementControls button[data-move="right"]').tap();
      await page.waitForFunction(() => document.querySelector("#positionText")?.textContent === "10, 5",
        { timeout: 5000 });
      await page.locator('#movementControls button[data-move="left"]').tap();
      await page.waitForFunction(() => document.querySelector("#positionText")?.textContent === "9, 5",
        { timeout: 5000 });
      moves += 2;

      const finalSave = await readSavedPosition(page, dbName, characterId);
      assert.deepEqual(finalSave.position, { x: 9, y: 5 });
      assert.deepEqual(pageErrors, [],
        profile.label + " 長時操作有 JavaScript／Console 錯誤：" + pageErrors.join("; "));
      assert.deepEqual(externalRequests, [],
        profile.label + " 長時操作出現外部網路請求：" + externalRequests.join("; "));
      assert.ok(Date.now() - startTime < 120000,
        profile.label + " 120 次觸控操作及存檔檢查不應超過 120 秒");

      totalMoves += moves;
      passed += 1;
      onLog("PASS：" + profile.label + " " + moves +
        " 次方向觸控、" + (checkpointCount = 3) + " 次重新載入；座標及 IndexedDB 一致" +
        "；最慢操作 " + Math.max(0, ...slowMoves.map(item => item.elapsed)) + " ms");
    } finally {
      await context.close();
      await deleteDatabase(browser, baseUrl, dbName);
    }
  }

  return { passed, failed: 0, totalMoves, totalReloads };
}
