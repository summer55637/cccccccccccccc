import assert from "node:assert/strict";

const VIEWPORTS = [
  { width: 320, height: 640, label: "320×640 小螢幕" },
  { width: 360, height: 800, label: "360×800 手機" },
  { width: 390, height: 844, label: "390×844 手機" },
  { width: 768, height: 1024, label: "768×1024 平板" },
];

function assertNoHorizontalOverflow(page, label) {
  return page.evaluate(({ label: viewportLabel }) => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    return {
      width,
      scrollWidth,
      message: viewportLabel + " 頁面寬度 " + scrollWidth + "px 超出可視寬度 " + width + "px",
    };
  }, { label }).then(result => {
    assert.ok(result.scrollWidth <= result.width + 1, result.message);
  });
}

function assertInsideViewport(page, selector, label) {
  return page.locator(selector).boundingBox().then(box => {
    assert.ok(box, label + " 必須有可見的版面位置");
    return page.evaluate(({ box }) => ({
      width: window.innerWidth,
      height: window.innerHeight,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }), { box }).then(viewport => {
      assert.ok(box.x >= -1 && box.y >= -1, label + " 不可超出可視區左側或上方");
      assert.ok(viewport.right <= viewport.width + 1, label + " 不可超出可視區右側");
      assert.ok(viewport.bottom <= viewport.height + 1 || box.y < viewport.height,
        label + " 必須可透過垂直捲動觸及");
    });
  });
}

async function waitUntilReady(page, label) {
  await page.waitForFunction(() => {
    const state = document.documentElement.dataset.ready;
    return state === "true" || state === "error" || state === "empty";
  }, { timeout: 30000 });
  const readiness = await page.evaluate(() => ({
    state: document.documentElement.dataset.ready || "missing",
    status: document.querySelector("#gameStatus")?.textContent ||
      document.querySelector("#appStatus")?.textContent || "",
  }));
  assert.equal(readiness.state, "true",
    label + " 初始化失敗：" + readiness.state + "；" + readiness.status);
}

export async function runMobileUITests({ browser, baseUrl, onLog = () => {} }) {
  let passed = 0;
  for (const viewport of VIEWPORTS) {
    const dbName = "offline-mobile-" + viewport.width + "-" + Date.now();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];

    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(baseUrl)) return route.continue();
      externalRequests.push(url);
      return route.abort();
    });

    try {
      const lobbyUrl = baseUrl + "/offline/character/ui/index.html?dbName=" +
        encodeURIComponent(dbName);
      const lobbyResponse = await page.goto(lobbyUrl, {
        waitUntil: "load",
        timeout: 30000,
      });
      assert.equal(lobbyResponse?.status(), 200, viewport.label + " 角色管理頁必須載入成功");
      await waitUntilReady(page, viewport.label + " 角色管理頁");
      await assertNoHorizontalOverflow(page, viewport.label + " 角色管理頁");
      await assertInsideViewport(page, "#characterName", viewport.label + " 角色名稱輸入框");

      const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
      assert.match(viewportMeta || "", /width=device-width/, "頁面必須使用裝置寬度版面");

      await page.locator("#characterName").fill("行動裝置測試角色");
      await page.locator("#classId").selectOption("knight");
      await page.locator("#createButton").tap();
      await page.locator(".character-card").filter({ hasText: "行動裝置測試角色" })
        .waitFor({ state: "visible" });
      await assertNoHorizontalOverflow(page, viewport.label + " 建立角色後");

      const enterButton = page.locator("#enterButton");
      await enterButton.tap();
      await page.waitForURL(url => url.pathname.endsWith("/offline/game/index.html"), {
        timeout: 20000,
      });
      await waitUntilReady(page, viewport.label + " 遊戲主畫面");
      assert.equal(await page.locator("#characterName").textContent(), "行動裝置測試角色");
      await assertNoHorizontalOverflow(page, viewport.label + " 遊戲主畫面");
      await assertInsideViewport(page, "#worldGrid", viewport.label + " 遊戲地圖");
      await assertInsideViewport(page, "#movementControls", viewport.label + " 觸控方向盤");

      const dpadButtons = page.locator("#movementControls button[data-move]");
      assert.equal(await dpadButtons.count(), 4, "必須顯示四個方向控制按鈕");
      for (let index = 0; index < await dpadButtons.count(); index += 1) {
        const box = await dpadButtons.nth(index).boundingBox();
        assert.ok(box && box.width >= 40 && box.height >= 40,
          "觸控方向按鈕必須有足夠大的點擊範圍：" + viewport.label);
      }

      // The left tile from the initial spawn (9, 5) is walkable.
      await page.locator('#movementControls button[data-move="left"]').tap();
      await page.locator("#positionText").filter({ hasText: "8, 5" }).waitFor({ timeout: 5000 });
      await assertNoHorizontalOverflow(page, viewport.label + " 觸控移動後");

      await page.reload({ waitUntil: "load", timeout: 30000 });
      await waitUntilReady(page, viewport.label + " 遊戲重新載入");
      assert.equal(await page.locator("#positionText").textContent(), "8, 5",
        viewport.label + " 觸控移動後的位置必須保存");
      await assertNoHorizontalOverflow(page, viewport.label + " 重新載入後");

      assert.deepEqual(pageErrors, [],
        viewport.label + " 發生 JavaScript 錯誤：" + pageErrors.join("; "));
      assert.deepEqual(externalRequests, [],
        viewport.label + " 產生外部網路請求：" + externalRequests.join("; "));
      passed += 1;
      onLog("PASS：行動版 " + viewport.label + " 版面、觸控移動及重新載入存檔");
    } finally {
      await context.close();
    }
  }
  return { passed, failed: 0 };
}
