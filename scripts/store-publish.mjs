#!/usr/bin/env node
// Store-facing release automation for X Video Downloader.
//
// Node built-ins only, so publishing never needs an extra dependency. Every
// credential is read from the environment and never printed: `--dry-run`, which
// is also the default whenever a credential is missing, prints the exact HTTP
// calls that would be made with secrets redacted and performs no network I/O.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const ALLOWED_TARGETS = ["trustedTesters", "default"];
const HOSTS = new Set([
  "api.github.com",
  "uploads.github.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
]);
const RELEASE_FILE =
  /^(?:x-video-downloader|notes)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.(?:zip|md)$/;
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const command = argv.find((a) => !a.startsWith("--"));
const env = process.env;
const secrets = new Set();

function die(message) {
  throw new Error(message);
}
function secret(name) {
  const value = env[name]?.trim();
  if (!value) return undefined;
  // Short values would redact ordinary text; real store secrets never are.
  if (value.length >= 8) secrets.add(value);
  return value;
}
function redact(text) {
  // Form bodies are percent-encoded, so both spellings must disappear.
  return [...secrets]
    .sort((a, b) => b.length - a.length)
    .reduce(
      (acc, s) =>
        acc
          .split(s)
          .join("[redacted]")
          .split(encodeURIComponent(s))
          .join("[redacted]"),
      String(text),
    );
}
function printableHeaders(headers) {
  return Object.entries(headers).map(([k, v]) =>
    `      ${k}: ${/authorization|cookie|proxy-authorization/i.test(k) ? "[redacted]" : redact(v)}`,
  );
}
function announce(method, url, headers = {}, body) {
  console.log(
    [
      `  ${method} ${url}`,
      ...printableHeaders(headers),
      ...(body ? [`      body: ${redact(body)}`] : []),
    ].join("\n"),
  );
}
async function call(method, url, { headers = {}, body } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:") die(`Refusing non-HTTPS endpoint: ${url}`);
  if (!HOSTS.has(u.host)) die(`Refusing to contact unapproved host: ${u.host}`);
  if (u.username || u.password) die("Credentials must never be embedded in a URL");
  const res = await fetch(u, { method, headers, body, redirect: "manual" });
  if (res.status >= 300 && res.status < 400)
    die(
      `${method} ${u.host}${u.pathname} answered ${res.status}; refusing to follow a redirect with credentials`,
    );
  const text = await res.text();
  if (!res.ok)
    die(`${method} ${u.pathname} failed with ${res.status}: ${redact(text).slice(0, 800)}`);
  try {
    return JSON.parse(text);
  } catch {
    die(`${method} ${u.pathname} returned a non-JSON body: ${redact(text).slice(0, 400)}`);
  }
}
const sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));

// ---------------------------------------------------------------- archive gate

async function loadPackage() {
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  const archiveName = `x-video-downloader-${version}.zip`;
  const zipPath = env.XVD_ZIP_PATH
    ? path.resolve(env.XVD_ZIP_PATH)
    : path.resolve("release", archiveName);
  let bytes;
  try {
    bytes = await readFile(zipPath);
  } catch {
    die(
      `Missing release archive ${zipPath}. Run \`pnpm package\` first (or set XVD_ZIP_PATH).`,
    );
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  let sums;
  try {
    sums = await readFile("release/SHA256SUMS.txt", "utf8");
  } catch {
    die("Missing release/SHA256SUMS.txt. Run `pnpm package` first.");
  }
  const entries = sums
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [digest, ...name] = line.split(/\s+/);
      return { digest, name: name.join(" ") };
    });
  if (entries.length !== 1)
    die(
      `release/SHA256SUMS.txt must list exactly one archive, found ${entries.length}: ${entries.map((e) => e.name).join(", ")}`,
    );
  const [entry] = entries;
  if (entry.name !== archiveName)
    die(
      `release/SHA256SUMS.txt lists ${entry.name} but package.json is ${version}; rebuild so the checksum matches the version`,
    );
  if (entry.digest !== hash)
    die(
      `SHA-256 mismatch for ${path.basename(zipPath)}: local ${hash} != recorded ${entry.digest}`,
    );
  if (path.basename(zipPath) !== archiveName)
    console.log(`note: uploading ${zipPath}, which is not the default ${archiveName}`);
  const { names, stale } = await auditReleaseDir(version);
  if (stale.length)
    console.log(`note: ignoring older release artifacts: ${stale.join(", ")}`);
  console.log(
    `verified ${path.basename(zipPath)} sha256=${hash} bytes=${bytes.length} (release/ has ${names.length} files)`,
  );
  return { version, archiveName, zipPath, bytes, hash };
}

async function auditReleaseDir(version) {
  const names = (await readdir("release")).sort();
  const unexpected = names.filter(
    (name) => name !== "SHA256SUMS.txt" && !RELEASE_FILE.test(name),
  );
  if (unexpected.length)
    die(
      `Unexpected files in release/: ${unexpected.join(", ")}. Only versioned archives, versioned notes and SHA256SUMS.txt may live there.`,
    );
  return {
    names,
    stale: names.filter(
      (name) => name.endsWith(".zip") && name !== `x-video-downloader-${version}.zip`,
    ),
  };
}

// ------------------------------------------------------------ GitHub Releases

function githubAuth() {
  const token = secret("GITHUB_TOKEN") || secret("GH_TOKEN");
  const repo = env.GITHUB_REPOSITORY?.trim();
  const missing = [];
  if (!token) missing.push("GITHUB_TOKEN or GH_TOKEN");
  if (!repo) missing.push("GITHUB_REPOSITORY");
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo))
    die(`GITHUB_REPOSITORY must look like owner/repo, got ${redact(repo)}`);
  return { token, repo, missing };
}

async function cmdRelease() {
  const pkg = await loadPackage();
  const notesPath = path.resolve("release", `notes-${pkg.version}.md`);
  let body, notesSource;
  const notes = await readFile(notesPath, "utf8").catch((err) => {
    if (err?.code !== "ENOENT") throw err;
    return undefined;
  });
  if (notes === undefined) {
    notesSource = "generated fallback";
    body = `## X Video Downloader ${pkg.version}\n\nRelease archive \`${pkg.archiveName}\`, SHA-256 \`${pkg.hash}\`.\n\nNo \`release/notes-${pkg.version}.md\` was found, so these notes are generated.\n`;
  } else {
    body = notes;
    notesSource = `release/notes-${pkg.version}.md`;
    if (!body.includes(pkg.version))
      die(`${notesSource} never mentions version ${pkg.version}`);
  }
  const { token, repo, missing } = githubAuth();
  const tag = `v${pkg.version}`;
  const dry = decideDry("release", missing);
  const assets = [
    { name: pkg.archiveName, file: pkg.zipPath, type: "application/zip" },
    {
      name: "SHA256SUMS.txt",
      file: path.resolve("release", "SHA256SUMS.txt"),
      type: "text/plain",
    },
  ];
  const api = `https://api.github.com/repos/${repo || "OWNER/REPO"}`;
  const gh = (extra = {}) => ({
    accept: "application/vnd.github+json",
    "user-agent": "x-video-downloader-store-publish",
    authorization: `Bearer ${token || "<unset>"}`,
    ...extra,
  });
  console.log(
    `\nGitHub release ${tag} in ${repo || "OWNER/REPO"} from ${notesSource} (${body.length} chars)`,
  );
  if (dry) {
    console.log("Planned calls:");
    announce("GET", `${api}/git/ref/tags/${tag}`, gh(), "404 aborts: the tag must be pushed first");
    announce("GET", `${api}/releases/tags/${tag}`, gh(), "404 creates, 200 updates");
    announce(
      "POST",
      `${api}/releases`,
      gh({ "content-type": "application/json" }),
      JSON.stringify({
        tag_name: tag,
        name: `X Video Downloader ${pkg.version}`,
        body: `${body.length} chars of release notes`,
        draft: false,
        prerelease: pkg.version.includes("-"),
      }),
    );
    announce(
      "PATCH",
      `${api}/releases/{release_id}`,
      gh({ "content-type": "application/json" }),
      JSON.stringify({ name: `X Video Downloader ${pkg.version}`, body: `${body.length} chars` }),
    );
    announce("GET", `${api}/releases/{release_id}/assets?per_page=100`, gh(), "existing assets with our names are deleted first");
    for (const asset of assets)
      announce(
        "POST",
        `${api.replace("https://api.", "https://uploads.")}/releases/{release_id}/assets?name=${encodeURIComponent(asset.name)}`,
        gh({ "content-type": asset.type }),
        `${path.basename(asset.file)} (${(await readFile(asset.file)).length} bytes)`,
      );
    console.log("\nDRY RUN COMPLETE - no network access, nothing published.");
    return;
  }

  await call("GET", `${api}/git/ref/tags/${tag}`, { headers: gh() }).catch((err) =>
    die(
      `${err.message}\nTag ${tag} must exist on the remote before a release can be created (push it or run the release workflow from the tag).`,
    ),
  );
  let release;
  try {
    release = await call("GET", `${api}/releases/tags/${tag}`, { headers: gh() });
  } catch (err) {
    if (!/failed with 404/.test(err.message)) throw err;
    release = undefined;
  }
  const payload = {
    tag_name: tag,
    name: `X Video Downloader ${pkg.version}`,
    body,
    draft: false,
    prerelease: pkg.version.includes("-"),
  };
  if (release) {
    release = await call("PATCH", `${api}/releases/${release.id}`, {
      headers: gh({ "content-type": "application/json" }),
      body: JSON.stringify({ name: payload.name, body: payload.body, prerelease: payload.prerelease }),
    });
    console.log(`updated release ${release.id} (${release.html_url})`);
  } else {
    release = await call("POST", `${api}/releases`, {
      headers: gh({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    console.log(`created release ${release.id} (${release.html_url})`);
  }
  const existing = await call("GET", `${api}/releases/${release.id}/assets?per_page=100`, {
    headers: gh(),
  });
  for (const asset of existing)
    if (assets.some((a) => a.name === asset.name)) {
      await call("DELETE", `${api}/releases/assets/${asset.id}`, { headers: gh() });
      console.log(`replaced existing asset ${asset.name}`);
    }
  for (const asset of assets) {
    const bytes = await readFile(asset.file);
    const uploaded = await call(
      "POST",
      `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
      {
        headers: gh({ "content-type": asset.type, "content-length": String(bytes.length) }),
        body: bytes,
      },
    );
    console.log(`uploaded ${uploaded.name} -> ${uploaded.browser_download_url}`);
  }
  console.log(`\nGitHub release ready: ${release.html_url}`);
}

// -------------------------------------------------------- Chrome Web Store v1

function decideDry(name, missing) {
  if (flags.has("--dry-run")) return true;
  if (!missing.length) return false;
  console.log(
    `\nDRY RUN (default because these are unset: ${missing.join(", ")}). Pass --dry-run to force it.`,
  );
  return true;
}

function wsConfig(missingItemFields) {
  const clientId = secret("XVD_WS_CLIENT_ID");
  const clientSecret = secret("XVD_WS_CLIENT_SECRET");
  const refreshToken = secret("XVD_WS_REFRESH_TOKEN");
  const itemId = env.XVD_WS_ITEM_ID?.trim();
  const target = (env.XVD_WS_TARGET || "trustedTesters").trim();
  if (!ALLOWED_TARGETS.includes(target))
    die(`XVD_WS_TARGET must be one of ${ALLOWED_TARGETS.join(" / ")}, got ${redact(target)}`);
  if (itemId && !/^[a-p]{32}$/.test(itemId))
    console.log(
      `note: "${itemId}" is not a 32-character Chrome Web Store id; copy the id from the listing URL (run webstore-list to find it)`,
    );
  const missing = [];
  if (!clientId) missing.push("XVD_WS_CLIENT_ID");
  if (!clientSecret) missing.push("XVD_WS_CLIENT_SECRET");
  if (!refreshToken) missing.push("XVD_WS_REFRESH_TOKEN");
  missingItemFields.forEach((field) => {
    if (!env[field]) missing.push(field);
  });
  return { clientId, clientSecret, refreshToken, itemId, target, missing };
}

async function wsToken(config, dry) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId || "<unset>",
    client_secret: config.clientSecret || "<unset>",
    refresh_token: config.refreshToken || "<unset>",
  }).toString();
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (dry) {
    announce("POST", "https://oauth2.googleapis.com/token", headers, body);
    return "<dry-run-access-token>";
  }
  const res = await call("POST", "https://oauth2.googleapis.com/token", { headers, body });
  if (!res.access_token) die("OAuth token response carried no access_token");
  secrets.add(res.access_token);
  return res.access_token;
}

function asArray(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

async function cmdWebstoreUpload() {
  const pkg = await loadPackage();
  const config = wsConfig(["XVD_WS_ITEM_ID"]);
  const dry = decideDry("webstore-upload", config.missing);
  const token = await wsToken(config, dry);
  const url = `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${config.itemId || "<ITEM_ID>"}?uploadType=media`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/zip",
    "content-length": String(pkg.bytes.length),
  };
  console.log(`\nUploading ${pkg.archiveName} to item ${config.itemId || "<ITEM_ID>"}`);
  if (dry) {
    announce("PUT", url, headers, `${pkg.archiveName} (${pkg.bytes.length} bytes, sha256 ${pkg.hash})`);
    console.log("\nDRY RUN COMPLETE - no network access, nothing uploaded.");
    return;
  }
  const res = await call("PUT", url, { headers, body: pkg.bytes });
  console.log(
    `upload ${res.kind ?? "response"} for ${res.id ?? config.itemId}: ${asArray(res.status).join(", ") || "no status"}; ${asArray(res.item_status).join(", ") || "no item_status"}`,
  );
}

async function cmdWebstorePublish() {
  const config = wsConfig(["XVD_WS_ITEM_ID"]);
  const dry = decideDry("webstore-publish", config.missing);
  const token = await wsToken(config, dry);
  const item = config.itemId || "<ITEM_ID>";
  const publishUrl = `https://www.googleapis.com/chromewebstore/v1.1/items/${item}/publish?publishTarget=${config.target}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  console.log(`\nPublish target: ${config.target}`);
  if (dry) {
    announce("POST", publishUrl, headers);
    announce("GET", `https://www.googleapis.com/chromewebstore/v1.1/items/${item}?projection=published`, headers, "polled until ACCEPTED or a rejecting status");
    announce("GET", `https://www.googleapis.com/chromewebstore/v1.1/items/${item}?projection=private`, headers, `polled at most ${maxPolls()} times, ${pollInterval()}s apart`);
    console.log("\nDRY RUN COMPLETE - no network access, nothing published.");
    return;
  }
  const res = await call("POST", publishUrl, { headers });
  const codes = asArray(res.status);
  console.log(`publish response: ${codes.join(", ") || "no status codes"}`);
  if (codes.some((c) => FATAL.includes(c)))
    die(`publish refused: ${codes.join(", ")}. Fix the listing in the Developer Dashboard.`);
  await pollStatus(token, item, headers);
}

const FATAL = [
  "NOT_AUTHORIZED",
  "INVALID_DEVELOPER",
  "DEVELOPER_NO_OWNERSHIP",
  "DEVELOPER_SUSPENDED",
  "PUBLISHER_SUSPENDED",
  "ITEM_NOT_FOUND",
  "ITEM_TAKEN_DOWN",
];
const BLOCKED = [
  "REJECTED",
  "NEEDS_ATTENTION",
  "DOWNGRADE_PENDING",
  "WITHDRAWN",
  "ITEM_TAKEN_DOWN",
];
const maxPolls = () => Number(env.XVD_WS_MAX_POLLS || 20);
const pollInterval = () => Number(env.XVD_WS_POLL_INTERVAL_SECONDS || 15);

async function pollStatus(token, item, headers) {
  const published = `https://www.googleapis.com/chromewebstore/v1.1/items/${item}?projection=published`;
  const privateUrl = `https://www.googleapis.com/chromewebstore/v1.1/items/${item}?projection=private`;
  for (let attempt = 1; attempt <= maxPolls(); attempt++) {
    const priv = await call("GET", privateUrl, { headers });
    const pub = await call("GET", published, { headers });
    const status = [
      ...asArray(priv.status),
      ...asArray(priv.item_status),
      ...asArray(pub.item_status),
    ];
    console.log(`poll ${attempt}/${maxPolls()}: ${status.join(", ") || "no status yet"}`);
    if (status.some((s) => FATAL.includes(s)))
      die(`item status is fatal: ${status.join(", ")}`);
    if (status.some((s) => BLOCKED.includes(s)))
      die(
        `item needs attention: ${status.join(", ")}. Open https://chrome.google.com/webstore/devconsole for the reviewer message.`,
      );
    if (status.includes("ACCEPTED")) {
      console.log("item status ACCEPTED - the build is live for the published target.");
      return;
    }
    if (attempt === maxPolls()) break;
    await sleep(pollInterval());
  }
  if (env.XVD_WS_REQUIRE_ACCEPTED === "1")
    die(`still not ACCEPTED after ${maxPolls()} polls (${pollInterval()}s apart)`);
  console.log(
    `still in review after ${maxPolls()} polls; re-run \`node scripts/store-publish.mjs webstore-publish\` later or watch https://chrome.google.com/webstore/devconsole`,
  );
}

async function cmdWebstoreList() {
  const config = wsConfig([]);
  const dry = decideDry("webstore-list", config.missing);
  const token = await wsToken(config, dry);
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const base = "https://www.googleapis.com/chromewebstore/v1.1/items";
  const projection = env.XVD_WS_LIST_PROJECTION || "private";
  if (dry) {
    announce("GET", `${base}?projection=${projection}&maxResults=100`, headers, "follows nextPageToken until exhausted");
    console.log("\nDRY RUN COMPLETE - no network access, nothing listed.");
    return;
  }
  let pageToken;
  for (let page = 1; page <= 10; page++) {
    const url = `${base}?projection=${projection}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await call("GET", url, { headers });
    const items = asArray(res.items);
    if (!items.length) {
      console.log("the account carries no items; create the listing in the Developer Dashboard first");
      return;
    }
    for (const item of items)
      console.log(
        `${item.id}  ${asArray(item.item_status).join(",") || "-"}  ${asArray(item.status).join(",") || "-"}  ${item.name ?? ""}`,
      );
    pageToken = res.nextPageToken;
    if (!pageToken) return;
    console.log(`(page ${page} of a longer list, continuing...)`);
  }
  die("stopped after 10 pages of items");
}

// ----------------------------------------------------------------- Edge Add-ons

async function cmdEdgePackage() {
  const pkg = await loadPackage();
  console.log(`
Edge Add-ons has no credential-free publishing path we rely on, so this is the
manual hand-off. Reuse the exact same archive that GitHub and CWS carry.

Package
  file      ${path.relative(process.cwd(), pkg.zipPath).replaceAll("\\", "/")}
  version   ${pkg.version}
  bytes     ${pkg.bytes.length}
  sha256    ${pkg.hash}

Steps (see docs/stores.md for the policy notes):
  1. https://partner.microsoft.com/dashboard/microsoftedge/public/login
     Register the Microsoft Edge program (individual account; no registration fee).
  2. Edge card -> Create new extension -> drag the .zip above onto "Drag your
     package here (.zip)". The manifest name/description become read-only store
     listing fields, so they must match what you want shown.
  3. Availability: Public, chosen markets. Properties: category Tools, website
     https://auroraeon.github.io/x-video-downloader/, support contact.
  4. Privacy page: Single Purpose description; a one-line justification for each
     of downloads, storage, offscreen and the three host_permissions; select "No,
     I am not using remote code"; tick the data-usage disclosures truthfully;
     privacy policy https://auroraeon.github.io/x-video-downloader/privacy.html
  5. Store listings: the package ships default_locale "en" plus _locales/en and
     _locales/zh_CN, so Partner Center should offer both language rows — fill
     each one. For en-US: description >= 250 characters, 300x300 logo, up to 6
     screenshots at 1280x800, search terms <= 21 words.
  6. Notes for certification: state that the extension only downloads media that
     the signed-in page already exposes, list a test account-free repro path on
     https://x.com, and quote the SHA-256 above.
  7. Publish. Certification can take up to seven business days; you stop here and
     click the button yourself.
`);
}

// ----------------------------------------------------------------------- shell

const HELP = `Usage: node scripts/store-publish.mjs <command> [--dry-run]

Commands
  release             Create/update the GitHub Release for package.json's version
                      and upload release/x-video-downloader-<version>.zip plus
                      release/SHA256SUMS.txt. Body comes from
                      release/notes-<version>.md when present.
  webstore-upload     PUT the release archive to the Chrome Web Store item.
  webstore-publish    POST the publish call and poll item status.
  webstore-list       List items in the developer account to find the item id.
  edge-package        Print the manual Edge Add-ons submission steps for the
                      current archive. No network access, ever.

The upload commands (release, webstore-upload, edge-package) verify the local
archive against release/SHA256SUMS.txt and the version in package.json before
touching the network.

Credentials (environment only; never arguments, never logged)
  GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY
  XVD_WS_CLIENT_ID, XVD_WS_CLIENT_SECRET, XVD_WS_REFRESH_TOKEN
  XVD_WS_ITEM_ID, XVD_WS_TARGET (trustedTesters | default, default trustedTesters)
  XVD_ZIP_PATH (override the archive), XVD_WS_MAX_POLLS,
  XVD_WS_POLL_INTERVAL_SECONDS, XVD_WS_REQUIRE_ACCEPTED, XVD_WS_LIST_PROJECTION

--dry-run prints the exact HTTP calls with secrets redacted and exits 0 without
network access. It is also the default whenever a credential is missing.
`;

const commands = {
  release: cmdRelease,
  "webstore-upload": cmdWebstoreUpload,
  "webstore-publish": cmdWebstorePublish,
  "webstore-list": cmdWebstoreList,
  "edge-package": cmdEdgePackage,
};

if (!command || command === "help" || flags.has("--help")) {
  if (command && command !== "help" && !flags.has("--help"))
    console.error(`Unknown command "${command}".\n`);
  console.log(HELP);
  process.exit(command && command !== "help" && !flags.has("--help") ? 1 : 0);
}
if (!commands[command]) {
  console.error(`Unknown command "${command}".\n`);
  console.log(HELP);
  process.exit(1);
}
if (flags.has("--verbose")) console.log(`note: ${command} on node ${process.version}`);
try {
  await commands[command]();
} catch (err) {
  console.error(`FAIL ${command}: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
