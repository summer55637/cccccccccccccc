#!/usr/bin/env node
/**
 * Create the original Cocos asset-pack key wrapper for the accountless local
 * client. The raw server key is read only during CI packaging and is never
 * written to the release artifact or logged.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("Missing value for " + name);
  return value;
}

function main() {
  const serverPath = argument("--server");
  const outputPath = argument("--output");
  const token = argument("--token", "xiaoshu-offline-singleplayer-v1");
  if (!serverPath || !outputPath) {
    throw new Error("Usage: node create-local-packkey.mjs --server <server.js> --output <json> [--token <token>]");
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(token)) {
    throw new Error("The local pack token has an invalid format.");
  }

  const source = readFileSync(serverPath, "utf8");
  const match = source.match(
    /const\s+MASTER_PACK_KEY\s*=\s*Buffer\.from\(\s*(['"])([0-9a-f]{64})\1\s*,\s*(['"])hex\3\s*\)\s*;/i,
  );
  if (!match) {
    throw new Error("The expected 32-byte MASTER_PACK_KEY declaration was not found.");
  }

  const masterKey = Buffer.from(match[2], "hex");
  if (masterKey.length !== 32) throw new Error("The original pack key is not 32 bytes.");

  const wrappingKey = createHash("sha256")
    .update("goline-packkey-v1|" + token, "utf8")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = Buffer.concat([iv, ciphertext, tag]).toString("base64");

  const output = {
    ok: true,
    v: 2,
    token,
    wrap: wrapped,
  };
  writeFileSync(outputPath, JSON.stringify(output) + "\n", { encoding: "utf8", mode: 0o600 });
  process.stdout.write(JSON.stringify({ output: outputPath, wrappedBytes: Buffer.from(wrapped, "base64").length }) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write("Local pack-key wrapper build failed: " + error.message + "\n");
  process.exitCode = 2;
}
