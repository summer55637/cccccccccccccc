import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const siteDir = process.env.SITE_DIR;
const screenshotPath = process.env.SCREENSHOT_PATH || "original-client-smoke.png";
if (!siteDir) throw new Error("SITE_DIR is required");

const port = 8765;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", siteDir], {
  stdio: "ignore",
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/client/index.html`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error("Local Pages preview server did not start");

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const responses = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("response", response => {
    const url = response.url();
    if (url.startsWith(`http://127.0.0.1:${port}/client/`)) {
      responses.push({ path: new URL(url).pathname, status: response.status() });
    }
  });
  page.on("pageerror", error => pageErrors.push(String(error).slice(0, 500)));
  page.on("requestfailed", request => {
    const url = request.url();
    // These endpoints are intentionally absent on GitHub Pages; the static client
    // smoke test distinguishes those known backend requirements from missing files.
    if (!/\/api\/wsnonce|\/api\/packkey|\/ws(?:\?|$)/.test(url)) {
      failedRequests.push({ url, error: request.failure()?.errorText || "unknown" });
    }
  });

  const response = await page.goto(`http://127.0.0.1:${port}/client/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  if (!response?.ok()) throw new Error(`Original client entry returned HTTP ${response?.status()}`);

  await page.waitForFunction(() => {
    const canvas = document.querySelector("#GameCanvas");
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  }, { timeout: 30000 });

  // Give Cocos time to import its engine, initialize bundles and render its launch scene.
  await delay(20000);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const state = await page.evaluate(async () => {
    const canvas = document.querySelector("#GameCanvas");
    const rect = canvas?.getBoundingClientRect();
    let cocos = { imported: false, sceneName: null, version: null, error: null };
    try {
      const engine = await window.System.import("cc");
      cocos = {
        imported: true,
        sceneName: engine.director?.getScene?.()?.name || null,
        version: engine.ENGINE_VERSION || engine.VERSION || null,
        error: null,
      };
    } catch (error) {
      cocos.error = String(error).slice(0, 500);
    }
    return {
      title: document.title,
      systemJsLoaded: typeof window.System !== "undefined",
      cocosCanvas: !!canvas,
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      canvasCssWidth: Math.round(rect?.width || 0),
      canvasCssHeight: Math.round(rect?.height || 0),
      cocos,
      bodyText: (document.body?.innerText || "").trim().slice(0, 500),
    };
  });

  const required = [
    "/client/src/polyfills.bundle.5adbf.js",
    "/client/src/system.bundle.543e6.js",
    "/client/src/import-map.4e643.json",
    "/client/index.1d55c.js",
    "/client/application.23610.js",
    "/client/src/settings.57846.json",
    "/client/cocos-js/cc.03aac.js",
    "/client/cocos-js/_virtual_cc-Bp5iGE8z.js",
    "/client/assets/internal/config.9e58a.json",
    "/client/assets/resources/config.caeb6.json",
    "/client/assets/main/config.3e757.json",
    "/client/assets/scripts/net/goline-adapter.8231b.js",
  ];
  const missing = required.filter(path => !responses.some(item => item.path === path && item.status === 200));
  const badStaticResponses = responses.filter(item => item.status >= 400);
  console.log(JSON.stringify({ state, requiredResponses: responses.filter(item => required.includes(item.path)), missing, badStaticResponses, pageErrors, failedRequests, screenshotPath }, null, 2));

  if (!state.cocosCanvas || state.canvasWidth < 100 || state.canvasHeight < 100) {
    throw new Error("Cocos canvas was not initialized");
  }
  if (!state.systemJsLoaded) throw new Error("SystemJS did not initialize");
  if (!state.cocos.imported) throw new Error(`Cocos engine import failed: ${state.cocos.error}`);
  if (!state.cocos.sceneName) throw new Error("Original Cocos launch scene did not become active");
  if (missing.length) throw new Error(`Missing required Cocos runtime responses: ${missing.join(", ")}`);
  if (badStaticResponses.length) throw new Error(`Static client assets returned HTTP errors: ${JSON.stringify(badStaticResponses)}`);
  if (failedRequests.length) throw new Error(`Unexpected static resource failures: ${JSON.stringify(failedRequests)}`);
  if (pageErrors.length) throw new Error(`Original client raised browser errors: ${JSON.stringify(pageErrors)}`);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
