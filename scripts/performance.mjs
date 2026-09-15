import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import selfsigned from "selfsigned";
import path from "node:path";
import { makeFixtures, root, poster } from "./fixtures.mjs";
import assert from "node:assert/strict";
await makeFixtures();
const name = process.env.XVD_PERF_NAME ?? "current";
const extension = path.resolve(process.env.XVD_EXTENSION ?? "dist");
const delay = Number(process.env.XVD_LATENCY ?? 80);
const rows = [],
  requests = [];
const uiRows = [];
function mediaRecord(i = 0) {
  return {
    tweetId: String(100 + i),
    sourceTweetId: String(100 + i),
    mediaId: String(111 + i),
    author: "fixture",
    index: 1,
    poster: poster.replace("/111/", `/${111 + i}/`),
    source: "graphql",
    observedAt: Date.now(),
    animated: false,
    durationMs: 3000,
    variants: [
      {
        kind: "mp4",
        url: `https://video.twimg.com/ext_tw_video/${111 + i}/perf/low.mp4`,
        bitrate: 500000,
      },
      {
        kind: "mp4",
        url: `https://video.twimg.com/ext_tw_video/${111 + i}/perf/high.mp4`,
        bitrate: 3000000,
      },
      {
        kind: "hls",
        url: `https://video.twimg.com/ext_tw_video/${111 + i}/perf/master-audio.m3u8`,
      },
    ],
  };
}
const cert = selfsigned.generate(
  [{ name: "commonName", value: "video.twimg.com" }],
  { days: 1, keySize: 2048 },
);
const server = https.createServer(
  { key: cert.private, cert: cert.cert },
  async (req, res) => {
    const started = performance.now();
    try {
      await new Promise((r) => setTimeout(r, delay));
      const u = new URL(req.url, "https://video.twimg.com"),
        file = path.basename(u.pathname);
      const bytes = await readFile(path.join(root, file));
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0,
        end = range
          ? Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1)
          : bytes.length - 1;
      const headers = {
        "content-type": file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp4",
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      };
      if (range)
        headers["content-range"] = `bytes ${start}-${end}/${bytes.length}`;
      const body = bytes.subarray(start, end + 1);
      requests.push({
        file,
        range: req.headers.range,
        bytes: body.length,
        ms: performance.now() - started,
      });
      res.writeHead(range ? 206 : 200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  },
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const context = await chromium.launchPersistentContext("", {
  channel: process.env.XVD_CHROME ? undefined : "chromium",
  executablePath: process.env.XVD_CHROME,
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--no-proxy-server",
    "--ignore-certificate-errors",
    `--host-resolver-rules=MAP video.twimg.com 127.0.0.1:${server.address().port}`,
  ],
});
try {
  const sw =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker")),
    id = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  for (let i = 0; i < 3; i++) {
    requests.length = 0;
    const record = mediaRecord();
    const result = await page.evaluate(
      (record) =>
        new Promise((resolve, reject) => {
          const t = performance.now(),
            w = new Worker("media-worker.js", { type: "module" });
          let first;
          const timeout = setTimeout(() => {
            w.terminate();
            reject(Error("Probe timeout"));
          }, 90000);
          w.onmessage = (e) => {
            if (e.data.type === "partial" && !first)
              first = performance.now() - t;
            if (e.data.type === "result" || e.data.type === "error") {
              clearTimeout(timeout);
              w.terminate();
              if (e.data.type === "error") reject(Error(e.data.error));
              else
                resolve({
                  ms: performance.now() - t,
                  firstMs: first,
                  plan: e.data.result,
                });
            }
          };
          w.onerror = (e) => reject(Error(e.message));
          w.postMessage({ type: "plan", requestId: "perf", record });
        }),
      record,
    );
    assert.ok(result.plan.candidates.length >= 3, JSON.stringify(result.plan));
    assert.ok(
      result.plan.audioCandidates.length >= 3,
      JSON.stringify(result.plan),
    );
    rows.push({
      ...result,
      requests: structuredClone(requests),
      requestCount: requests.length,
      bytes: requests.reduce((a, r) => a + r.bytes, 0),
    });
  }
  await context.route("https://pbs.twimg.com/**", async (r) =>
    r.fulfill({
      contentType: "image/png",
      body: await readFile(path.join(root, "poster.png")),
    }),
  );
  const records = Array.from({ length: 3 }, (_, i) => mediaRecord(i));
  const pageHtml = `<!doctype html><style>body{margin:0}article{width:320px;position:relative;margin:8px}.frame{position:relative;height:150px;width:320px}video{width:100%;height:100%}</style>${records.map((r) => `<article><div class="frame"><video poster="${r.poster}"></video></div><a href="/fixture/status/${r.tweetId}">Post</a></article>`).join("")}<script>window.uiStarted=performance.now();window.uiTimes={};new MutationObserver(()=>{const infos=[...document.querySelectorAll('xvd-quality')];if(!window.uiTimes.first&&infos.some(i=>i.dataset.state==='ready'))window.uiTimes.first=performance.now()-uiStarted;if(!window.uiTimes.all&&infos.length===3&&infos.every(i=>i.dataset.state==='ready'))window.uiTimes.all=performance.now()-uiStarted;}).observe(document,{subtree:true,childList:true,attributes:true});setTimeout(()=>window.postMessage({channel:'x-video-downloader/v1',type:'MEDIA',records:${JSON.stringify(records)}},location.origin),0);</script>`;
  await context.route("https://x.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: pageHtml }),
  );
  const ui = await context.newPage();
  await ui.setViewportSize({ width: 1000, height: 1100 });
  await ui.bringToFront();
  for (const phase of ["cold", "warm"]) {
    requests.length = 0;
    await ui.goto("https://x.com/fixture/status/100");
    await ui.waitForFunction(() => window.uiTimes.all, { timeout: 60000 });
    uiRows.push({
      phase,
      ...(await ui.evaluate(() => window.uiTimes)),
      bytes: requests.reduce((a, r) => a + r.bytes, 0),
      requests: requests.length,
    });
  }
  // Worker and offscreen lifecycle must not erase reusable metadata.
  await page.evaluate(async () => {
    const c = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (c.length) await chrome.offscreen.closeDocument();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  requests.length = 0;
  await ui.reload();
  await ui.waitForFunction(() => window.uiTimes.all, { timeout: 60000 });
  uiRows.push({
    phase: "after-worker-stop",
    ...(await ui.evaluate(() => window.uiTimes)),
    bytes: requests.reduce((a, r) => a + r.bytes, 0),
    requests: requests.length,
  });
  const median = (values) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  if (process.env.XVD_COMPARE) {
    const before = JSON.parse(await readFile(process.env.XVD_COMPARE, "utf8"));
    for (const row of rows) {
      assert.deepEqual(
        row.plan,
        before.rows[0].plan,
        "All video/audio candidates and measured quality must remain identical",
      );
    }
    assert.ok(
      median(rows.map((r) => r.ms)) < before.medianMs * 0.75,
      "Probe speed must improve by at least 25%",
    );
    assert.ok(
      median(rows.map((r) => r.bytes)) < before.medianBytes * 0.4,
      "Probe bytes must shrink by at least 60%",
    );
    assert.equal(
      uiRows.find((r) => r.phase === "after-worker-stop").requests,
      0,
      "Worker restart must retain cached results",
    );
    assert.ok(
      uiRows.find((r) => r.phase === "cold").all <
        before.uiRows.find((r) => r.phase === "cold").all * 0.65,
      "Three visible videos must complete at least 35% faster",
    );
  }
  const report = {
    name,
    date: new Date().toISOString(),
    delayMs: delay,
    version: JSON.parse(
      await readFile(path.join(extension, "manifest.json"), "utf8"),
    ).version,
    medianMs: median(rows.map((r) => r.ms)),
    medianBytes: median(rows.map((r) => r.bytes)),
    medianRequests: median(rows.map((r) => r.requestCount)),
    rows,
    uiRows,
  };
  await mkdir("output/perf", { recursive: true });
  await writeFile(`output/perf/${name}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        name,
        medianMs: report.medianMs,
        bytes: report.medianBytes,
        requests: report.medianRequests,
        uiRows,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
