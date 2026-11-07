import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const SOURCE_ROOTS = [
  "offline/character/ui",
  "offline/game",
  "offline/storage",
];
const SOURCE_FILES = ["offline/service-worker.js"];
const SOURCE_EXTENSIONS = new Set([".js", ".html", ".css"]);
const NETWORK_APIS = [
  ["fetch()", /\bfetch\s*\(/i],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/i],
  ["WebSocket", /\bWebSocket\b/i],
  ["EventSource", /\bEventSource\b/i],
  ["sendBeacon()", /\bsendBeacon\s*\(/i],
];
const REMOTE_REFERENCE = /https?:\/\/|(?:^|["'=\s(])\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[:/"']|$)/i;
const SECRET_PATTERNS = [
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["GitHub personal access token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["AWS access key ID", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["hard-coded credential assignment", /\b(?:api[_-]?key|client[_-]?secret|password|passwd|token|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|encryption[_-]?key|secret)\b\s*[:=]\s*(["'])([^"']{16,})\1/gi],
];

const SECRET_PATTERN_FIXTURES = [
  ["private key material", "-----BEGIN PRIVATE KEY-----"],
  ["GitHub personal access token", "ghp_" + "A".repeat(36)],
  ["AWS access key ID", "AKIA" + "A".repeat(16)],
  ["JWT", "eyJ" + "a".repeat(20) + "." + "b".repeat(20) + "." + "c".repeat(20)],
  ["hard-coded credential assignment", 'const apiKey = "fixture-only-not-a-real-secret-123456";'],
];
for (const [patternName, fixture] of SECRET_PATTERN_FIXTURES) {
  const pattern = SECRET_PATTERNS.find(([name]) => name === patternName)?.[1];
  assert.ok(pattern, "機密掃描規則不存在：" + patternName);
  pattern.lastIndex = 0;
  assert.ok(pattern.test(fixture), "機密掃描規則未能辨識測試樣本：" + patternName);
}

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
  const files = [
    ...SOURCE_ROOTS.flatMap(directory => collectSourceFiles(repositoryRoot, directory)),
    ...SOURCE_FILES.map(path => join(repositoryRoot, path)),
  ];
  assert.ok(files.length >= 10, "離線正式程式檔案數量異常，請確認掃描路徑。");

  const violations = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const label = relative(repositoryRoot, file).replaceAll("\\", "/");

    for (const [api, pattern] of NETWORK_APIS) {
      if (pattern.test(content)) violations.push(label + " 使用連網 API：" + api);
    }
    for (const [secretType, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        violations.push(label + " 疑似包含硬編碼機密：" + secretType);
      }
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

  const workerPath = join(repositoryRoot, "offline/service-worker.js");
  const worker = readFileSync(workerPath, "utf8");
  for (const asset of [
    "./character/ui/index.html",
    "./game/index.html",
    "./character/ui/app.js",
    "./game/main.js",
    "./storage/indexeddb.js",
  ]) {
    if (!worker.includes(JSON.stringify(asset))) {
      violations.push("離線快取清單缺少必要資源：" + asset);
    }
  }
  if (!/cache\.addAll\s*\(/i.test(worker) || !/event\.respondWith\s*\(/i.test(worker)) {
    violations.push("Service Worker 缺少安裝預快取或離線回應處理。");
  }

  assert.deepEqual(
    violations,
    [],
    "離線邊界檢查失敗：\n" + violations.join("\n"),
  );

  return { passed: files.length, scannedFiles: files.length };
}
