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

// Hosted stores read locale metadata out of the package, so a missing or
// half-translated catalogue must fail the gate rather than the reviewer.
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.name, "__MSG_extensionName__");
assert.equal(manifest.description, "__MSG_extensionDescription__");
assert.ok(manifest.description.length <= 132, "Store description exceeds 132 characters");
const locales = {};
for (const locale of ["en", "zh_CN"]) {
  const key = `_locales/${locale}/messages.json`;
  assert.ok(files[key], `${key} is missing from the archive`);
  locales[locale] = JSON.parse(Buffer.from(files[key]).toString());
}
assert.deepEqual(
  Object.keys(locales.en).sort(),
  Object.keys(locales.zh_CN).sort(),
  "Locale catalogues do not cover the same message keys",
);
for (const [key, entry] of Object.entries(locales.en)) {
  assert.ok(entry.message.trim(), `${key} has an empty English message`);
  assert.ok(locales.zh_CN[key].message.trim(), `${key} has an empty Chinese message`);
}
for (const [locale, catalog] of Object.entries(locales))
  for (const [key, entry] of Object.entries(catalog)) {
    // Undeclared substitutions make chrome.i18n.getMessage mangle the text.
    assert.ok(!/\$\d/.test(entry.message), `${locale} ${key} uses an undeclared substitution`);
    assert.deepEqual(
      Object.keys(entry.placeholders ?? {}).sort(),
      [...entry.message.matchAll(/\$([A-Za-z0-9_]+)/g)].map((m) => m[1]).sort(),
      `${locale} ${key} placeholders do not match its message`,
    );
  }
for (const match of JSON.stringify(manifest).matchAll(/__MSG_([\w.]+)__/g))
  for (const locale of Object.keys(locales))
    assert.ok(
      locales[locale][match[1]],
      `manifest references ${match[1]} but ${locale} has no such message`,
    );
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
  "_locales/en/messages.json",
  "_locales/zh_CN/messages.json",
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

const isText = (name) => /\.(json|html|css|js|txt|svg)$/i.test(name) || name === "LICENSE";

// zipSync renders DOS timestamps from local time getters, so a UTC-anchored
// mtime silently moves the published hash with the build machine's timezone.
// Pin the container itself: every entry must carry local 1980-01-01 00:00.
{
  let off = 0;
  let entries = 0;
  while (off + 4 <= archive.length && archive.readUInt32LE(off) === 0x04034b50) {
    const name = archive.subarray(off + 30, off + 30 + archive.readUInt16LE(off + 26)).toString();
    assert.equal(archive.readUInt16LE(off + 10), 0, `Nonzero DOS time in ${name}`);
    // DOS date: (year - 1980) << 9 | month << 5 | day, months are 1-based.
    assert.equal(archive.readUInt16LE(off + 12), (1 << 5) | 1, `Timestamp in ${name} is not 1980-01-01`);
    off += 30 + archive.readUInt16LE(off + 26) + archive.readUInt16LE(off + 28) + archive.readUInt32LE(off + 18);
    entries++;
  }
  assert.equal(entries, Object.keys(files).length, "Archive entry headers did not parse");
}

for (const [name, bytes] of Object.entries(files)) {
  assert.ok(!name.endsWith(".map"), `Source map shipped: ${name}`);
  if (isText(name)) {
    // A CRLF in the archive means the build copied a Windows working tree
    // verbatim, which moves the published checksum with the developer's OS.
    assert.ok(
      !Buffer.from(bytes).includes(0x0d),
      `Carriage return in ${name}: the package is not reproducible across platforms`,
    );
  }
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
