import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const helper = join(root, "offline/tools/create-local-packkey.mjs");
const token = "xiaoshu-offline-singleplayer-v1";
const fakeKeyHex = "0123456789abcdef".repeat(4);
const fakeKey = Buffer.from(fakeKeyHex, "hex");

function run(serverText) {
  const directory = mkdtempSync(join(tmpdir(), "local-packkey-test-"));
  const serverPath = join(directory, "server.js");
  const outputPath = join(directory, "packkey.json");
  writeFileSync(serverPath, serverText, "utf8");
  const child = spawnSync(
    process.execPath,
    [helper, "--server", serverPath, "--output", outputPath, "--token", token],
    { encoding: "utf8" },
  );
  return { directory, outputPath, child };
}

{
  const result = run(
    'const MASTER_PACK_KEY = Buffer.from("' + fakeKeyHex + '", "hex");\n',
  );
  try {
    assert.equal(result.child.status, 0, result.child.stderr);
    const jsonText = readFileSync(result.outputPath, "utf8");
    const wrapper = JSON.parse(jsonText);
    assert.equal(wrapper.ok, true);
    assert.equal(wrapper.v, 2);
    assert.equal(wrapper.token, token);
    assert.equal(jsonText.includes(fakeKeyHex), false, "raw pack key must not be written to wrapper");

    const packed = Buffer.from(wrapper.wrap, "base64");
    assert.equal(packed.length, 60);
    const iv = packed.subarray(0, 12);
    const ciphertextAndTag = packed.subarray(12);
    const wrappingKey = createHash("sha256")
      .update("goline-packkey-v1|" + token, "utf8")
      .digest();
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, iv);
    decipher.setAuthTag(ciphertextAndTag.subarray(ciphertextAndTag.length - 16));
    const clear = Buffer.concat([
      decipher.update(ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16)),
      decipher.final(),
    ]);
    assert.deepEqual(clear, fakeKey);
    console.log("PASS: generated wrapper unwraps to the original 32-byte key");
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
}

{
  const result = run("const MASTER_PACK_KEY = Buffer.alloc(32);\n");
  try {
    assert.notEqual(result.child.status, 0);
    assert.match(result.child.stderr, /MASTER_PACK_KEY declaration was not found/);
    console.log("PASS: missing key declaration is rejected");
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
}

{
  const result = run(
    'const MASTER_PACK_KEY = Buffer.from("' + fakeKeyHex + '", "hex");\n',
  );
  try {
    assert.equal(result.child.status, 0, result.child.stderr);
    const wrapper = JSON.parse(readFileSync(result.outputPath, "utf8"));
    const packed = Buffer.from(wrapper.wrap, "base64");
    const wrongKey = createHash("sha256")
      .update("goline-packkey-v1|wrong-token", "utf8")
      .digest();
    const decipher = createDecipheriv("aes-256-gcm", wrongKey, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(packed.length - 16));
    assert.throws(() => {
      decipher.update(packed.subarray(12, packed.length - 16));
      decipher.final();
    });
    console.log("PASS: wrapper cannot be opened with a different token");
  } finally {
    rmSync(result.directory, { recursive: true, force: true });
  }
}

console.log("All local pack-key wrapper tests passed.");
