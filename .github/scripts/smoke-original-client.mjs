import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const siteDir = process.env.SITE_DIR;
const screenshotPath = process.env.SCREENSHOT_PATH || "original-client-smoke.png";
const afterEnterScreenshotPath = process.env.SCREENSHOT_AFTER_ENTER_PATH || "original-client-after-enter.png";
if (!siteDir) throw new Error("SITE_DIR is required");

const port = 8765;
const origin = `http://127.0.0.1:${port}`;
const repoPrefix = "/cccccccccccccc";
const previewRoot = await mkdtemp(join(tmpdir(), "pages-preview-"));
await symlink(siteDir, join(previewRoot, repoPrefix.slice(1)), "dir");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", previewRoot], {
  stdio: "ignore",
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${origin}${repoPrefix}/index.html`);
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
  const apiRequests = [];
  page.on("request", request => {
    const url = request.url();
    const requestPath = new URL(url).pathname;
    if (requestPath.startsWith("/api/") || requestPath === "/ws") {
      apiRequests.push({ method: request.method(), url: url.slice(0, 300) });
    }
  });
  page.on("response", response => {
    const url = response.url();
    if (url.startsWith(origin)) {
      responses.push({ path: new URL(url).pathname, status: response.status() });
    }
  });
  page.on("pageerror", error => pageErrors.push(String(error).slice(0, 500)));
  page.on("requestfailed", request => {
    const url = request.url();
    // GitHub Pages intentionally has no dynamic APIs or WebSocket backend.
    if (!/\/api\/|\/ws(?:\?|$)/.test(url)) {
      failedRequests.push({ url, error: request.failure()?.errorText || "unknown" });
    }
  });

  const response = await page.goto(`${origin}${repoPrefix}/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  if (!response?.ok()) throw new Error(`Original client entry returned HTTP ${response?.status()}`);

  await page.waitForFunction(() => {
    const canvas = document.querySelector("#GameCanvas");
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  }, { timeout: 30000 });

  // Give Cocos time to import its engine, initialize bundles and load the first scene.
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
      bodyText: (document.body?.innerText || "").trim().slice(0, 700),
    };
  });

  // Test the original title-screen button, then capture the next original UI state.
  await page.mouse.click(640, 636);
  await delay(5000);
  const afterEnter = await page.evaluate(async () => {
    const canvas = document.querySelector("#GameCanvas");
    const rect = canvas?.getBoundingClientRect();
    let sceneName = null;
    let uiNodes = [];
    try {
      const engine = await window.System.import("cc");
      const scene = engine.director?.getScene?.();
      sceneName = scene?.name || null;
      const visit = (node, parents = []) => {
        if (!node) return;
        const nextPath = [...parents, node.name || "(unnamed)"];
        const components = (node.components || []).map(component => {
          const type = component?.constructor?.name || "Component";
          const text = typeof component?.string === "string" ? component.string :
                       typeof component?.text === "string" ? component.text : "";
          const ui = component?.contentSize ? {
            width: Math.round(component.contentSize.width || 0),
            height: Math.round(component.contentSize.height || 0),
          } : undefined;
          return { type, text: text.slice(0, 100), ui };
        });
        const searchable = [node.name, ...components.map(x => x.text)].join(" ");
        if (/(login|account|pwd|password|input|enter|register|帳號|密碼|登入|進入|註冊)/i.test(searchable)) {
          uiNodes.push({
            path: nextPath.join("/"),
            active: node.activeInHierarchy,
            position: node.position ? {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
            } : null,
            components,
          });
        }
        for (const child of (node.children || [])) visit(child, nextPath);
      };
      visit(scene);
    } catch {}
    const bodyText = (document.body?.innerText || "").trim().slice(0, 700);
    return {
      title: document.title,
      systemJsLoaded: typeof window.System !== "undefined",
      cocosCanvas: !!canvas,
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      canvasCssWidth: Math.round(rect?.width || 0),
      canvasCssHeight: Math.round(rect?.height || 0),
      cocos,
      bodyText,
      mapAssetError: bodyText.includes("地圖素材下載失敗"),
      htmlInputs: [...document.querySelectorAll("input,textarea,select")].map(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          id: element.id,
          name: element.getAttribute("name"),
          type: element.getAttribute("type"),
          placeholder: element.getAttribute("placeholder"),
          valueLength: element.value?.length || 0,
          visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      }),
      localStorageKeys: Object.keys(localStorage),
    };
  });

  const requiredRelative = [
    "/pages-base-path.js",
    "/src/polyfills.bundle.5adbf.js",
    "/src/system.bundle.543e6.js",
    "/src/import-map.4e643.json",
    "/index.1d55c.js",
    "/application.23610.js",
    "/src/settings.57846.json",
    "/cocos-js/cc.03aac.js",
    "/cocos-js/_virtual_cc-Bp5iGE8z.js",
    "/assets/internal/config.9e58a.json",
    "/assets/resources/config.caeb6.json",
    "/assets/main/config.3e757.json",
    "/src/assets/scripts/net/goline-adapter.8231b.js",
    "/assets-packs/packs-manifest.json",
  ];
  const required = requiredRelative.map(path => repoPrefix + path);
  const missing = required.filter(path => !responses.some(item => item.path === path && item.status === 200));
  const badStaticResponses = responses.filter(item =>
    item.status >= 400 && !item.path.includes("/api/") && !item.path.endsWith("/ws")
  );
  const packResponses = responses.filter(item => item.path.startsWith(`${repoPrefix}/assets-packs/`));
  const badPackResponses = packResponses.filter(item => item.status >= 400);
  console.log(JSON.stringify({ state, afterEnter, apiRequests, requiredResponses: responses.filter(item => required.includes(item.path)), packResponses: packResponses.slice(0, 30), missing, badStaticResponses, badPackResponses, pageErrors, failedRequests, screenshotPath }, null, 2));

  if (!state.cocosCanvas || state.canvasWidth < 100 || state.canvasHeight < 100) {
    throw new Error("Cocos canvas was not initialized");
  }
  if (!state.systemJsLoaded) throw new Error("SystemJS did not initialize");
  if (!state.cocos.imported) throw new Error(`Cocos engine import failed: ${state.cocos.error}`);
  if (!state.cocos.sceneName) throw new Error("Original Cocos launch scene did not become active");
  if (missing.length) throw new Error(`Missing required Cocos runtime responses: ${missing.join(", ")}`);
  if (badStaticResponses.length) throw new Error(`Static client assets returned HTTP errors: ${JSON.stringify(badStaticResponses)}`);
  if (badPackResponses.length) throw new Error(`Original asset-pack files returned HTTP errors: ${JSON.stringify(badPackResponses)}`);
  if (failedRequests.length) throw new Error(`Unexpected static resource failures: ${JSON.stringify(failedRequests)}`);
  if (pageErrors.length) throw new Error(`Original client raised browser errors: ${JSON.stringify(pageErrors)}`);
  if (state.mapAssetError) throw new Error("Original client reports map asset download failure");
  if (!packResponses.some(item => item.status === 200 && item.path.endsWith(".pack"))) {
    throw new Error("No original map/art asset pack was successfully loaded");
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await rm(previewRoot, { recursive: true, force: true });
}
