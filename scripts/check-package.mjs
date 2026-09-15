import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const archive = await readFile(`release/x-video-downloader-${version}.zip`);
const files = unzipSync(archive);
const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, version);
assert.deepEqual(manifest.permissions, ["downloads", "storage", "offscreen"]);
for (const name of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((s) => s.js),
  "offscreen.js",
  "offscreen.html",
  "media-worker.js",
  "popup.js",
  "THIRD_PARTY_NOTICES.txt",
])
  assert.ok(files[name], `Missing ${name}`);
for (const [name, bytes] of Object.entries(files)) {
  if (name.endsWith(".js"))
    assert.ok(
      !/\beval\s*\(|\bnew\s+Function\s*\(/.test(Buffer.from(bytes).toString()),
      `Dynamic code evaluation in ${name}`,
    );
}
const hash = createHash("sha256").update(archive).digest("hex");
assert.ok((await readFile("release/SHA256SUMS.txt", "utf8")).startsWith(hash));
console.log(
  JSON.stringify(
    {
      valid: true,
      manifestVersion: manifest.manifest_version,
      files: Object.keys(files).length,
      bytes: archive.length,
      sha256: hash,
    },
    null,
    2,
  ),
);
