import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const SOURCE_ROOTS = [
  "offline/character/ui",
  "offline/game",
  "offline/storage",
];
const SOURCE_EXTENSIONS = new Set([".js", ".html", ".css"]);
const NETWORK_APIS = [
  ["fetch()", /\bfetch\s*\(/i],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/i],
  ["WebSocket", /\bWebSocket\b/i],
  ["EventSource", /\bEventSource\b/i],
  ["sendBeacon()", /\bsendBeacon\s*\(/i],
  ["Service Worker registration", /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/i],
];
const REMOTE_REFERENCE = /https?:\/\/|(?:^|["'=\s(])\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[:/"']|$)/i;

function collectSourceFiles(root, directory) {
  const absolute = join(root, directory);
  return readdirSync(absolute).flatMap(name => {
    const path = join(absolute, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      return collectSourceFiles(root, relative(root, path));
    }
    return SOURCE_EXTENSIONS.has(extname(name).toLowerCase())
      ? [path]
      : [];
  });
}

export function runOfflineBoundaryTests(repositoryRoot = process.cwd()) {
  const files = SOURCE_ROOTS.flatMap(directory => collectSourceFiles(repositoryRoot, directory));
  assert.ok(files.length >= 10, "離線正式程式檔案數量異常，請確認掃描路徑。");

  const violations = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const label = relative(repositoryRoot, file).replaceAll("\\", "/");

    for (const [api, pattern] of NETWORK_APIS) {
      if (pattern.test(content)) violations.push(label + " 使用連網 API：" + api);
    }
    if (REMOTE_REFERENCE.test(content)) {
      violations.push(label + " 含有外部 HTTP 或 protocol-relative URL。");
    }

    if (file.endsWith(".html")) {
      const policyTags = [...content.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)];
      if (!policyTags.some(match => /connect-src\s+'none'/i.test(match[0]))) {
        violations.push(label + " 缺少 connect-src 'none' 的內容安全政策。");
      }
      const attributes = content.matchAll(/\b(?:src|href|action|poster)\s*=\s*["']([^"']+)["']/gi);
      for (const match of attributes) {
        if (/^(?:https?:)?\/\//i.test(match[1].trim())) {
          violations.push(label + " 含外部 HTML 資源或表單網址：" + match[1]);
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "離線邊界檢查失敗：\n" + violations.join("\n"),
  );

  return { passed: files.length, scannedFiles: files.length };
}
