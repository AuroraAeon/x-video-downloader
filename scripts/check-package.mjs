import { readFile, readdir } from "node:fs/promises";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const archive = await readFile(`release/x-video-downloader-${version}.zip`);
const files = unzipSync(archive);
const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
const source = JSON.parse(await readFile("public/manifest.json", "utf8"));
const sha256 = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, version);

// The permission surface is what a reviewer cannot afford to have drift.
assert.deepEqual(manifest.permissions, ["downloads", "storage", "offscreen"]);
assert.deepEqual([...manifest.host_permissions].sort(), [
  "https://cdn.syndication.twimg.com/*",
  "https://video.twimg.com/*",
  "https://x.com/*",
].sort());
assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'; worker-src 'self'; connect-src 'self' https://video.twimg.com https://cdn.syndication.twimg.com");
assert.equal(manifest.web_accessible_resources, undefined);
assert.equal(manifest.minimum_chrome_version, "116");
for (const key of [
  "manifest_version",
  "version",
  "permissions",
  "host_permissions",
  "content_security_policy",
  "minimum_chrome_version",
  "background",
  "content_scripts",
  "action",
  "icons",
])
  assert.deepEqual(manifest[key], source[key], `manifest.${key} drifted`);

// Presence alone would let a leftover from an older build ship forever.
const expected = [
  "manifest.json",
  "offscreen.html",
  "popup.html",
  "popup.css",
  "offscreen.js",
  "media-worker.js",
  "popup.js",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "INSTALL.txt",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((s) => s.js),
  ...Object.values(manifest.icons),
].sort();
assert.deepEqual(
  Object.keys(files).sort(),
  expected,
  "Archive contents differ from the audited file set",
);

// Prove the archive is the current build, not an earlier one under the same name.
const built = new Set();
async function walk(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${key}/`);
    else {
      built.add(key);
      assert.ok(files[key], `dist/${key} is missing from the archive`);
      assert.equal(
        sha256(files[key]),
        sha256(await readFile(`dist/${key}`)),
        `${key} in the archive is not the file in dist/`,
      );
    }
  }
}
await walk("dist");
const unbuilt = expected.filter(
  (key) => key !== "INSTALL.txt" && !built.has(key),
);
assert.deepEqual(
  unbuilt,
  [],
  `Expected in the archive but not produced by the build: ${unbuilt.join(", ")}`,
);

for (const [name, bytes] of Object.entries(files)) {
  assert.ok(!name.endsWith(".map"), `Source map shipped: ${name}`);
  if (name.endsWith(".js")) {
    const code = Buffer.from(bytes).toString();
    // `Function(...)` reaches the same constructor as `new Function(...)`.
    assert.ok(
      !/\beval\s*\(|\bnew\s+Function\s*\(|[^.$\w]Function\s*\(/.test(code),
      `Dynamic code evaluation in ${name}`,
    );
    assert.ok(
      !/\bimportScripts\s*\(|\bchrome\.scripting\b/.test(code),
      `Remote or injected code loading in ${name}`,
    );
  }
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
