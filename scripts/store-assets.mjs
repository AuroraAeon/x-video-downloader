// Renders the store and site imagery from the same build the package gate audits.
// Sizes follow https://developer.chrome.com/docs/webstore/images.
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import https from "node:https";
import assert from "node:assert/strict";
import path from "node:path";
import sharp from "sharp";
import selfsigned from "selfsigned";
import { makeFixtures, root, tweet } from "./fixtures.mjs";

const out = path.resolve("docs/site/assets");
const extension = path.resolve("dist");
const messages = async (locale) =>
  JSON.parse(
    await readFile(`public/_locales/${locale}/messages.json`, "utf8"),
  );
const catalogues = { en: await messages("en"), zh_CN: await messages("zh_CN") };
const icon =
  "data:image/png;base64," +
  (await readFile("dist/icons/128.png")).toString("base64");
const tileCopy = {
  en: "Highest available quality, shown before you download",
  zh_CN: "下载前就显示可取得的最高画质与音质",
};
await makeFixtures();
await mkdir(out, { recursive: true });

// A post card with the shape X uses, so the strip and menu sit where a
// reviewer will look for them.
function card(data, lang) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f7f9fa;color:#0f1419;font:15px/1.4 system-ui}
main{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:28px 20px}article{width:600px;background:#fff;border:1px solid #eff3f4;border-radius:16px;box-shadow:0 1px 3px #0000000f;padding:14px 16px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.head{display:flex;gap:10px;align-items:center}.avatar{width:40px;height:40px;border-radius:50%;background:#8899a6}
.name{font-weight:700}.handle{color:#536471}.body{margin:10px 0 12px}
.clip{overflow:hidden;border-radius:16px;position:relative;background:#000}video{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.controls{position:absolute;bottom:0;left:0;right:0;height:44px;padding:12px;color:#fff;background:linear-gradient(#0000,#0009);display:flex;align-items:center;font-variant-numeric:tabular-nums}
.actions{display:flex;justify-content:space-between;padding:10px 2px 0;color:#536471;font-size:13px}
</style></head><body><main><article>
<div class="head"><div class="avatar"></div><div><span class="name">Fixture Media</span> <span class="handle">@fixture</span></div></div>
<p class="body">Sample clip rendered by the extension under test.</p>
<div class="media-shell"><div class="clip"><video poster="https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/a.jpg" controls></video><div class="controls">0:03 / 0:03</div></div></div>
<div class="actions"><span>Reply 5</span><span>Repost 28</span><span>Like 106</span><span>Views 3,095</span></div>
<p class="sr"><a href="/fixture/status/${data.rest_id}">Post ${data.rest_id}</a></p>
</article></main><script>window.__INITIAL_STATE__=${JSON.stringify(data)};</script></body></html>`;
}

function tile(key, wide) {
  const scale = wide ? 2.4 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#0f1419;color:#fff;font-family:system-ui}
.panel{display:flex;align-items:center;gap:${18 * scale}px;padding:${20 * scale}px}
img{width:${68 * scale}px;height:${68 * scale}px}
h1{margin:0;font-size:${25 * scale}px;letter-spacing:-.02em;line-height:1.15}
p{margin:${6 * scale}px 0 0;font-size:${15 * scale}px;color:#c7d0d6;max-width:${wide ? 760 : 300 * scale}px}
</style></head><body><div class="panel"><img src="${icon}" alt=""><div><h1>X Video Downloader</h1><p>${tileCopy[key]}</p></div></div></body></html>`;
}

// The media manifest is served by a local HTTPS endpoint mapped onto
// video.twimg.com, because inspection runs in the service worker where page
// routing does not apply. Same arrangement as the end-to-end suite.
const cert = selfsigned.generate(
  [{ name: "commonName", value: "video.twimg.com" }],
  { days: 1, keySize: 2048 },
);
const server = https.createServer(
  { key: cert.private, cert: cert.cert },
  async (req, res) => {
    const send = (status, headers, body) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    const file = path.basename(new URL(req.url, "https://x").pathname);
    let bytes;
    try {
      bytes = await readFile(path.join(root, file));
    } catch {
      return send(404, {}, "Missing fixture");
    }
    const headers = {
      "access-control-allow-origin": "*",
      "accept-ranges": "bytes",
      "content-type": file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : file.endsWith(".ts")
          ? "video/mp2t"
          : "video/mp4",
    };
    const range = req.headers.range;
    if (!range) return send(200, headers, bytes);
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = Number(m?.[1] ?? 0);
    const end = Math.min(Number(m?.[2] || bytes.length - 1), bytes.length - 1);
    if (start >= bytes.length)
      return send(416, { ...headers, "content-range": `bytes */${bytes.length}` }, "");
    send(206, { ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}` }, bytes.subarray(start, end + 1));
  },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function session(locale) {
  const context = await chromium.launchPersistentContext("", {
    channel: process.env.XVD_CHROME ? undefined : "chromium",
    executablePath: process.env.XVD_CHROME,
    headless: true,
    locale,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-proxy-server",
      "--ignore-certificate-errors",
      `--host-resolver-rules=MAP video.twimg.com 127.0.0.1:${port}`,
    ],
  });
  await context.route("https://pbs.twimg.com/**", async (r) =>
    r.fulfill({
      contentType: "image/png",
      body: await readFile(path.join(root, "poster.png")),
    }),
  );
  return context;
}

const made = [];
async function shoot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  const png = await page.screenshot({ path: `${out}/${name}` });
  const meta = await sharp(png).metadata();
  assert.equal(`${meta.width}x${meta.height}`, `${width}x${height}`, name);
  made.push({ name, size: `${width}x${height}`, bytes: png.length });
}

for (const [key, locale] of [
  ["en", "en-US"],
  ["zh_CN", "zh-CN"],
]) {
  const data = tweet("1000000000000000991", "audioquality");
  const context = await session(locale);
  try {
    const page = await context.newPage();
    await page.route("https://x.com/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: card(data, key === "en" ? "en" : "zh-CN"),
      }),
    );
    await page.goto("https://x.com/fixture/status/" + data.rest_id);
    await page.waitForSelector("xvd-quality", { timeout: 60000 });
    const ready = await page
      .waitForSelector('xvd-quality[data-state="ready"]', { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (!ready)
      throw Error(
        `${key}: strip never became ready: ` +
          (await page.evaluate(() => {
            const node = document.querySelector("xvd-quality");
            return JSON.stringify({
              state: node?.dataset?.state,
              label: node?.getAttribute("aria-label"),
            });
          })),
      );
    const strip = await page.getAttribute("xvd-quality", "aria-label");
    const best = catalogues[key].labelVideoBest.message;
    assert.ok(strip.includes(best), `${key}: strip lacks "${best}": ${strip}`);
    assert.match(strip, /640 × 360/);
    await page.locator("xvd-quality").scrollIntoViewIfNeeded();
    await shoot(page, `shot-${key === "en" ? "en" : "zh"}.png`, 1280, 800);
    const box = await page.locator("xvd-download").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector("xvd-menu");
    await page.waitForTimeout(300);
    const menu = await page.locator("xvd-menu").boundingBox();
    // The menu body lives in a closed shadow root, so geometry is the signal.
    assert.ok(
      menu && menu.width > 100 && menu.height > 60,
      `${key}: menu not rendered: ${JSON.stringify(menu)}`,
    );
    await shoot(
      page,
      `shot-${key === "en" ? "en" : "zh"}-menu.png`,
      1280,
      800,
    );
  } finally {
    await context.close();
  }
}

for (const key of ["en", "zh_CN"]) {
  for (const [name, size] of [
    ["tile", { width: 440, height: 280 }],
    ["marquee", { width: 1400, height: 560 }],
  ]) {
    const context = await chromium.launchPersistentContext("", {
      headless: true,
      viewport: size,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      const file = `${out}/${name}-${key === "en" ? "en" : "zh"}.png`;
      await page.setContent(tile(key, name === "marquee"));
      const png = await page.screenshot({ path: file });
      const meta = await sharp(png).metadata();
      assert.equal(
        `${meta.width}x${meta.height}`,
        `${size.width}x${size.height}`,
        name,
      );
      made.push({
        name: path.basename(file),
        size: `${size.width}x${size.height}`,
        bytes: png.length,
      });
    } finally {
      await context.close();
    }
  }
}

console.log(
  JSON.stringify(
    { written: made.length, directory: "docs/site/assets", files: made },
    null,
    2,
  ),
);
server.close();
