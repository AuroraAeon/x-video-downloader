import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

const out = path.resolve("output/playwright");
const extension = path.resolve(process.env.XVD_EXTENSION ?? "dist");
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext("", {
  channel: process.env.XVD_CHROME ? undefined : "chromium",
  executablePath: process.env.XVD_CHROME,
  headless: true,
  locale: "en-US",
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const results = [];
function fixture(kind) {
  const video =
    '<video poster="https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.png" controls></video>';
  let media;
  if (kind === "legacy") {
    const layers = Array.from(
      { length: 8 },
      (_, i) => `<div class="absolute layer-${i}">`,
    ).join("");
    media = `<div class="media-shell"><div data-testid="videoPlayer" class="clip"><div class="ratio">${layers}${video}${"</div>".repeat(8)}<div class="controls">0:28 / 1:24</div></div></div></div>`;
  } else if (kind === "padding") {
    media = `<div class="media-shell"><div class="clip"><div class="ratio"><div class="absolute inset"><div class="surface">${video}</div></div><div class="controls">0:28 / 1:24</div></div></div></div>`;
  } else {
    media = `<div class="media-shell"><div class="frame clip">${video}<div class="controls">0:28 / 1:24</div></div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:#172126;font:15px system-ui}article{width:780px;max-width:calc(100% - 24px);margin:16px auto}.clip{overflow:hidden;border-radius:16px;position:relative}.frame{aspect-ratio:16/9}.ratio{position:relative;height:0;padding-bottom:56.25%}.absolute{position:absolute;inset:0}.inset{inset:12px 0}.surface{width:100%;height:100%;position:relative}video{display:block;width:100%;height:100%;object-fit:cover}.controls{position:absolute;bottom:0;left:0;right:0;height:44px;padding:10px;color:white;background:#0005;text-align:center}.actions{display:flex;justify-content:space-between;padding:6px 0;color:#526471;border-bottom:1px solid #eff3f4}.after{height:90px;padding-top:16px}.quote{padding:12px;border:1px solid #d0d7dc}.row{display:flex;gap:10px}.avatar{width:42px;flex-shrink:0}.post{flex:1;min-width:0}
  </style></head><body><article>${media}<div class="actions" role="group" aria-label="Post actions"><span>Reply 5</span><span>Repost 28</span><span>Like 106</span><span>Views 3,095</span></div><div class="after">Following content</div></article><script>window.baseline={actions:document.querySelector('.actions').getBoundingClientRect().top,media:document.querySelector('.media-shell').getBoundingClientRect().toJSON()};</script></body></html>`;
}
try {
  await context.route("https://pbs.twimg.com/**", async (r) =>
    r.fulfill({
      contentType: "image/png",
      body: await readFile("output/fixtures/poster.png"),
    }),
  );
  await context.route("https://x.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: fixture(
        new URL(r.request().url()).searchParams.get("layout") ?? "flow",
      ),
    }),
  );
  const page = await context.newPage();
  async function measure() {
    return page.evaluate(() => {
      const info = document.querySelector("xvd-quality"),
        frame = document.querySelector(".media-shell"),
        actions = document.querySelector(".actions"),
        button = document.querySelector("xvd-download");
      return {
        info: info.getBoundingClientRect().toJSON(),
        media: frame.getBoundingClientRect().toJSON(),
        actions: actions.getBoundingClientRect().toJSON(),
        button: button.getBoundingClientRect().toJSON(),
        baseline: window.baseline,
        inside: frame.contains(info),
        count: document.querySelectorAll("xvd-quality").length,
      };
    });
  }
  async function verify(label) {
    await page.waitForSelector("xvd-quality");
    await page.waitForTimeout(350);
    const m = await measure();
    await page.screenshot({ path: `${out}/layout-${label}.png` });
    assert.ok(
      m.info.y >= m.media.bottom - 1,
      `${label}: information overlaps media: ${JSON.stringify(m)}`,
    );
    assert.ok(
      m.actions.y >= m.info.bottom - 1,
      `${label}: information overlaps actions`,
    );
    assert.ok(
      m.actions.y - m.baseline.actions >= m.info.height,
      `${label}: information did not expand document flow`,
    );
    assert.ok(
      Math.abs(m.media.height - m.baseline.media.height) < 2,
      `${label}: media was resized`,
    );
    assert.ok(
      m.info.x >= m.media.x - 1 && m.info.right <= m.media.right + 1,
      `${label}: horizontal overflow`,
    );
    assert.ok(
      m.button.y >= m.media.y && m.button.bottom <= m.media.bottom,
      `${label}: download button left player`,
    );
    assert.equal(m.count, 1);
    results.push({ label, ...m });
  }
  for (const width of [1200, 390])
    for (const kind of ["legacy", "padding", "flow"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`https://x.com/test/status/123?layout=${kind}`);
      await verify(`${kind}-${width}`);
    }
  // Keep the same <video> while X replaces its surrounding player layout.
  await page.evaluate(() => {
    const video = document.querySelector("video");
    document.querySelectorAll("xvd-quality").forEach((n) => n.remove());
    const next = document.createElement("div");
    next.className = "media-shell";
    next.innerHTML =
      '<div class="clip"><div class="ratio"><div class="absolute"><div class="absolute"></div></div><div class="controls">0:28 / 1:24</div></div></div>';
    next.querySelector(".absolute .absolute").append(video);
    document.querySelector(".media-shell").replaceWith(next);
    window.baseline = {
      actions: document.querySelector(".actions").getBoundingClientRect().top,
      media: next.getBoundingClientRect().toJSON(),
    };
  });
  await verify("reparented-video");
  // Initial attachment must not use zero-size placeholder geometry.
  await page.goto("https://x.com/test/status/123?layout=legacy");
  await page.evaluate(() => {
    document.querySelector(".media-shell").style.display = "none";
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const shell = document.querySelector(".media-shell");
    shell.style.display = "";
    document.querySelectorAll("xvd-quality").forEach((n) => n.remove());
    window.baseline = {
      actions: document.querySelector(".actions").getBoundingClientRect().top,
      media: shell.getBoundingClientRect().toJSON(),
    };
  });
  await verify("revealed-player");
  // Store reviewers and most users only ever see the rendered locale, so a
  // second browser instance with a Chinese UI language proves the bundled
  // catalogues reach a real content script rather than only the unit tests.
  const zh = await chromium.launchPersistentContext("", {
    channel: process.env.XVD_CHROME ? undefined : "chromium",
    executablePath: process.env.XVD_CHROME,
    headless: true,
    locale: "zh-CN",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await zh.route("https://pbs.twimg.com/**", async (r) =>
      r.fulfill({
        contentType: "image/png",
        body: await readFile("output/fixtures/poster.png"),
      }),
    );
    await zh.route("https://x.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: fixture("flow") }),
    );
    const zhPage = await zh.newPage();
    await zhPage.goto("https://x.com/test/status/123");
    await zhPage.waitForSelector("xvd-quality");
    const englishAria = await page.getAttribute("xvd-quality", "aria-label");
    const chineseAria = await zhPage.getAttribute("xvd-quality", "aria-label");
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
    assert.ok(englishAria && /video/i.test(englishAria), `unexpected English strip text: ${englishAria}`);
    assert.ok(!cjk.test(englishAria), `English locale still rendered CJK: ${englishAria}`);
    assert.match(chineseAria, /画质/);
    results.push({ label: "locale-zh-CN", ariaLabel: chineseAria });
  } finally {
    await zh.close();
  }
  console.log(
    JSON.stringify(
      { passed: results.length, scenarios: results.map((r) => r.label) },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    `${out}/layout-report.json`,
    JSON.stringify(results, null, 2),
  );
  await context.close();
}
