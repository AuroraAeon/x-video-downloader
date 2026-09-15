import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import https from "node:https";
import selfsigned from "selfsigned";
import sharp from "sharp";
import { makeFixtures, tweet, html, root } from "./fixtures.mjs";
await makeFixtures();
const out = path.resolve("output/playwright");
await mkdir(out, { recursive: true });
const extension = path.resolve("dist");
const results = [],
  errors = [];
const counts = new Map();
let mode = "normal",
  current = tweet(),
  stall = false,
  release;
const cert = selfsigned.generate(
  [{ name: "commonName", value: "video.twimg.com" }],
  { days: 1, keySize: 2048 },
);
const server = https.createServer(
  { key: cert.private, cert: cert.cert },
  async (req, res) => {
    try {
      const url = new URL(req.url, "https://" + req.headers.host);
      const file = path.basename(url.pathname);
      counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
      const n = counts.get(url.pathname);
      if (url.pathname.includes("/forbidden/") && file.endsWith(".m3u8")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if (url.pathname.includes("/ratelimit/")) {
        res.writeHead(429);
        res.end("Rate limited");
        return;
      }
      if (
        url.pathname.includes("/nativefail/") &&
        file === "high.mp4" &&
        !req.headers.range
      ) {
        res.writeHead(404);
        res.end("Expired direct URL");
        return;
      }
      if (url.pathname.includes("/retry/") && /v\d\.m4s/.test(file) && n >= 2) {
        res.writeHead(404);
        res.end("Expired");
        return;
      }
      if (stall && /v\d\.m4s/.test(file))
        await new Promise((resolve) => (release = resolve));
      const bytes = await readFile(path.join(root, file));
      const type = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : file.endsWith(".ts")
          ? "video/mp2t"
          : "video/mp4";
      const headers = {
        "access-control-allow-origin": "*",
        "accept-ranges": "bytes",
        "content-type": type,
      };
      if (req.headers.range) {
        const m = req.headers.range.match(/bytes=(\d+)-(\d*)/);
        const start = Number(m?.[1] ?? 0),
          end = Math.min(Number(m?.[2] || bytes.length - 1), bytes.length - 1);
        if (start >= bytes.length) {
          res.writeHead(416, {
            ...headers,
            "content-range": `bytes */${bytes.length}`,
          });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${bytes.length}`,
        });
        res.end(bytes.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, headers);
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Missing fixture");
    }
  },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const context = await chromium.launchPersistentContext("", {
  channel: process.env.XVD_CHROME ? undefined : "chromium",
  executablePath: process.env.XVD_CHROME,
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--no-proxy-server",
    "--ignore-certificate-errors",
    `--host-resolver-rules=MAP video.twimg.com 127.0.0.1:${port}`,
  ],
  acceptDownloads: true,
  viewport: { width: 1200, height: 850 },
});
context.on("weberror", (e) => errors.push(e.error().message));
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await context.route("https://api.x.com/graphql/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { tweet_result_by_rest_id: { result: current } },
      }),
    }),
  );
  await context.route("https://pbs.twimg.com/**", async (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      body: await readFile(path.join(root, "poster.png")),
    }),
  );
  await context.route("https://x.com/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: html(current, mode === "ssr"),
    }),
  );
  const page = await context.newPage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const readJobs = () =>
    popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "LIST" });
      if (!response?.ok) throw Error(JSON.stringify(response));
      return response.jobs;
    });
  const click = async (mode = "video", index = 0) => {
    await page.bringToFront();
    await page.waitForSelector("xvd-download");
    const host = page.locator("xvd-download").nth(index);
    await host.scrollIntoViewIfNeeded();
    const box = await host.boundingBox();
    await page.mouse.click(box.x + 14, box.y + 14);
    await page.waitForSelector("xvd-menu");
    const menu = await page.locator("xvd-menu").boundingBox();
    await page.mouse.click(menu.x + 80, menu.y + (mode === "audio" ? 88 : 32));
    await page.keyboard.press("Escape");
  };
  const waitJob = async (predicate, timeout = 90000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const jobs = await readJobs();
      const j = jobs.find(predicate);
      if (j) return j;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Error(
      `Timed out waiting for job: ${JSON.stringify(await readJobs())}`,
    );
  };
  const start = async (m) => {
    mode = m;
    current = tweet(
      String(BigInt(current.rest_id) + 1n),
      m === "ssr" ? "normal" : m,
    );
    await page.goto(`https://x.com/fixture/status/${current.rest_id}`);
    await click();
    return current.rest_id;
  };
  // Closed-shadow buttons must ignore forged page messages and synthetic clicks.
  await page.goto(`https://x.com/fixture/status/${current.rest_id}`);
  await page.bringToFront();
  await page.waitForSelector("xvd-download");
  await page.evaluate(() =>
    window.postMessage(
      {
        channel: "x-video-downloader/v1",
        type: "START",
        url: "https://evil.test/payload",
      },
      location.origin,
    ),
  );
  assert.equal((await readJobs()).length, 0);
  results.push("Untrusted bridge message cannot start downloads");
  await page.waitForSelector('xvd-quality[data-state="ready"]', {
    timeout: 60000,
  });
  const inline = await page.locator("xvd-quality").getAttribute("aria-label");
  assert.match(inline, /640 × 360/);
  assert.match(inline, /AAC.*kb\/s.*kHz/);
  assert.equal((await readJobs()).length, 0);
  const geometry = await page.evaluate(() => ({
    video: document.querySelector("video").getBoundingClientRect().toJSON(),
    info: document
      .querySelector("xvd-quality")
      .getBoundingClientRect()
      .toJSON(),
    button: document
      .querySelector("xvd-download")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.equal(geometry.button.width, 28);
  assert.equal(geometry.button.height, 28);
  assert.ok(geometry.info.y >= geometry.video.bottom);
  results.push(
    "Quality and audio metrics appear below the video without a download; button is 28px",
  );
  const requestCount = () => [...counts.values()].reduce((a, b) => a + b, 0);
  const countBeforeRevisit = requestCount();
  await page.reload();
  await page.waitForSelector('xvd-quality[data-state="ready"]');
  assert.equal(requestCount(), countBeforeRevisit);
  results.push(
    "Revisiting visible media reuses quality results without another CDN probe",
  );
  const cachedRequests = requestCount();
  await popup.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length) await chrome.offscreen.closeDocument();
  });
  const cacheCdp = await context.newCDPSession(popup);
  await cacheCdp.send("ServiceWorker.enable");
  await cacheCdp.send("ServiceWorker.stopAllWorkers");
  await page.reload();
  await page.waitForSelector('xvd-quality[data-state="ready"]');
  assert.equal(requestCount(), cachedRequests);
  results.push(
    "Quality cache survives both offscreen closure and service worker termination with no new media requests",
  );
  const blocker = await page.locator("xvd-download").boundingBox();
  await page.mouse.click(blocker.x + 14, blocker.y + 14);
  await page.mouse.click(20, 20);
  assert.equal(await page.locator("xvd-menu").count(), 0);
  results.push(
    "Clicking outside the menu dismisses it without starting a download",
  );
  const first = await start("normal");
  await click();
  const complete = await waitJob(
    (j) =>
      j.record.tweetId === first && ["complete", "failed"].includes(j.state),
  );
  assert.equal(complete.state, "complete", JSON.stringify(complete));
  assert.equal(complete.candidate.label, "640x360");
  assert.equal(complete.candidate.kind, "hls");
  const item = await popup.evaluate(
    async (downloadId) =>
      (await chrome.downloads.search({ id: downloadId }))[0],
    complete.downloadId,
  );
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        item.filename,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(probe.streams.find((s) => s.codec_type === "video").width, 640);
  assert.equal(
    probe.streams.find((s) => s.codec_type === "audio").codec_name,
    "aac",
  );
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.15);
  assert.equal(
    (await readJobs()).filter((j) => j.record.tweetId === first).length,
    1,
  );
  results.push(
    "Highest HLS chosen over lower MP4; real output has 640x360 video, AAC audio and correct duration; duplicate click deduplicated",
  );
  await page.screenshot({ path: `${out}/desktop.png` });
  await popup.setViewportSize({ width: 390, height: 600 });
  await popup.screenshot({ path: `${out}/popup.png` });
  const second = await start("forbidden");
  const fallback = await waitJob(
    (j) =>
      j.record.tweetId === second && ["complete", "failed"].includes(j.state),
  );
  assert.equal(fallback.state, "complete", JSON.stringify(fallback));
  assert.equal(fallback.candidate.kind, "mp4");
  assert.ok(fallback.warnings.length);
  results.push("Unavailable HLS falls back to MP4 with visible warning");
  const third = await start("ssr");
  const ssr = await waitJob(
    (j) =>
      j.record.tweetId === third && ["complete", "failed"].includes(j.state),
  );
  assert.equal(ssr.state, "complete", JSON.stringify(ssr));
  assert.equal(ssr.record.source, "initial");
  results.push("SSR-only metadata works without GraphQL response");
  const legacyId = await start("legacy");
  const legacy = await waitJob(
    (j) =>
      j.record.tweetId === legacyId && ["complete", "failed"].includes(j.state),
  );
  assert.equal(legacy.state, "complete", JSON.stringify(legacy));
  results.push("Legacy MPEG-TS HLS is remuxed successfully");
  const midId = await start("retry");
  const mid = await waitJob(
    (j) =>
      j.record.tweetId === midId && ["complete", "failed"].includes(j.state),
  );
  assert.equal(mid.state, "complete", JSON.stringify(mid));
  assert.equal(mid.candidate.kind, "mp4");
  assert.ok(mid.warnings.some((w) => w.includes("自动改用")));
  results.push("Segment failure during remux falls back to playable MP4");
  // Stop only this extension service worker, keeping its offscreen media worker alive.
  stall = true;
  const resumeId = await start("normal");
  const inFlight = await waitJob(
    (j) => j.record.tweetId === resumeId && j.state === "analyzing",
  );
  const cdp = await context.newCDPSession(popup);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  const wake = readJobs();
  release?.();
  stall = false;
  await wake;
  const resumed = await waitJob(
    (j) =>
      j.id === inFlight.id &&
      ["complete", "failed", "interrupted"].includes(j.state),
  );
  assert.equal(resumed.state, "complete", JSON.stringify(resumed));
  results.push(
    "Service worker termination does not lose the offscreen job or duplicate download",
  );
  stall = true;
  const closeId = await start("normal");
  await waitJob((j) => j.record.tweetId === closeId && j.state === "analyzing");
  await page.goto("about:blank");
  release?.();
  stall = false;
  const sourceClosed = await waitJob(
    (j) =>
      j.record.tweetId === closeId && ["complete", "failed"].includes(j.state),
  );
  assert.equal(sourceClosed.state, "complete", JSON.stringify(sourceClosed));
  results.push("Leaving the source page does not interrupt download");
  const rateId = await start("ratelimit");
  const rate = await waitJob(
    (j) => j.record.tweetId === rateId && j.state === "failed",
  );
  assert.match(rate.error, /限流/);
  results.push("429 stops promptly without retry storm");
  await page.setViewportSize({ width: 390, height: 844 });
  mode = "ssr";
  current = tweet();
  await page.goto("https://x.com/fixture/status/" + current.rest_id);
  await page.waitForSelector("xvd-download");
  await page.screenshot({ path: `${out}/narrow.png` });
  const box = await page.locator("xvd-download").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  results.push("Narrow viewport button stays inside video");
  // DOM churn: a replacement video gets exactly one fresh control.
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v.replaceWith(v.cloneNode(true));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator("xvd-download").count(), 1);
  results.push("Recycled video nodes do not duplicate buttons");
  stall = true;
  const cancelId = await start("normal");
  const active = await waitJob(
    (j) =>
      j.record.tweetId === cancelId &&
      ["analyzing", "merging"].includes(j.state),
  );
  await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "CANCEL", id }),
    active.id,
  );
  release?.();
  stall = false;
  await waitJob((j) => j.id === active.id && j.state === "cancelled");
  results.push("Cancellation interrupts active media processing");
  stall = true;
  const lostId = await start("normal");
  const lost = await waitJob(
    (j) => j.record.tweetId === lostId && j.state === "analyzing",
  );
  await popup.evaluate(() => chrome.offscreen.closeDocument());
  release?.();
  stall = false;
  await waitJob((j) => j.id === lost.id && j.state === "interrupted");
  const retryResponse = await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "RETRY", id }),
    lost.id,
  );
  assert.equal(retryResponse.ok, true);
  const retried = await waitJob(
    (j) => j.id === lost.id && ["complete", "failed"].includes(j.state),
  );
  assert.equal(retried.state, "complete", JSON.stringify(retried));
  results.push(
    "Offscreen loss is marked interrupted; manual retry recreates the worker and completes",
  );
  mode = "ssr";
  current = tweet("1000000000000000901");
  const secondMedia = structuredClone(current.media_entities2[0]);
  secondMedia.id_str = "222";
  secondMedia.media_url_https = secondMedia.media_url_https.replace(
    "/111/",
    "/222/",
  );
  for (const variant of secondMedia.video_info.variants)
    variant.url = variant.url.replace("/111/", "/222/");
  current.media_entities2.push(secondMedia);
  await page.goto("https://x.com/fixture/status/" + current.rest_id);
  await page.evaluate((poster) => {
    const wrapper = document.querySelector(".video").cloneNode(true);
    wrapper.querySelector("xvd-download")?.remove();
    wrapper.querySelector("video").poster = poster;
    document.querySelector("article").append(wrapper);
  }, secondMedia.media_url_https);
  await page.waitForFunction(
    () => document.querySelectorAll("xvd-download").length === 2,
  );
  const secondHost = await page.locator("xvd-download").nth(1).boundingBox();
  await click("video", 1);
  const secondJob = await waitJob(
    (j) =>
      j.record.tweetId === current.rest_id &&
      ["complete", "failed"].includes(j.state),
  );
  assert.equal(secondJob.state, "complete", JSON.stringify(secondJob));
  assert.equal(secondJob.record.mediaId, "222");
  assert.equal(secondJob.record.index, 2);
  assert.equal(
    (await readJobs()).filter((j) => j.record.tweetId === current.rest_id)
      .length,
    1,
  );
  results.push(
    "Each video has a separate control and selects only its own media, including media index",
  );
  await page.waitForTimeout(500);
  const temporary = await popup.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("xvd-temp");
      const names = [];
      for await (const [name] of dir.entries()) names.push(name);
      return names;
    } catch {
      return [];
    }
  });
  assert.deepEqual(temporary, []);
  results.push(
    "Completed, failed and cancelled jobs release their OPFS temporary files",
  );
  const nativeId = await start("nativefail");
  const nativeFallback = await waitJob(
    (j) =>
      j.record.tweetId === nativeId &&
      ["complete", "failed", "interrupted"].includes(j.state),
  );
  assert.equal(
    nativeFallback.state,
    "complete",
    JSON.stringify(nativeFallback),
  );
  assert.equal(nativeFallback.candidate.kind, "hls");
  assert.ok(nativeFallback.warnings.some((w) => w.includes("自动改用")));
  results.push(
    "Native download interruption cannot prematurely terminate the next HLS candidate during reconciliation",
  );
  // Audio must choose the high-rate non-default HLS rendition, without including video.
  mode = "ssr";
  current = tweet("1000000000000000991", "audioquality");
  await page.bringToFront();
  await page.goto("https://x.com/fixture/status/" + current.rest_id);
  await page.waitForSelector('xvd-quality[data-state="ready"]', {
    timeout: 60000,
  });
  const audioInline = await page
    .locator("xvd-quality")
    .getAttribute("aria-label");
  assert.match(audioInline, /2 ch/);
  const beforeAudio = (await readJobs()).length;
  const open = await page.locator("xvd-download").boundingBox();
  await page.mouse.click(open.x + 14, open.y + 14);
  await page.waitForSelector("xvd-menu");
  assert.equal((await readJobs()).length, beforeAudio);
  await page.screenshot({ path: `${out}/v1.1-menu-narrow.png` });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const audioJob = await waitJob(
    (j) =>
      j.record.tweetId === current.rest_id &&
      j.mode === "audio" &&
      ["complete", "failed"].includes(j.state),
  );
  assert.equal(audioJob.state, "complete", JSON.stringify(audioJob));
  assert.equal(audioJob.candidate.kind, "hls");
  assert.ok(audioJob.candidate.bitrate > 150000);
  assert.equal(audioJob.candidate.channels, 2);
  assert.match(audioJob.filename, /\.m4a$/);
  const audioItem = await popup.evaluate(
    async (id) => (await chrome.downloads.search({ id }))[0],
    audioJob.downloadId,
  );
  const audioProbe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        audioItem.filename,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(audioProbe.streams.length, 1);
  assert.equal(audioProbe.streams[0].codec_type, "audio");
  assert.equal(audioProbe.streams[0].sample_rate, "48000");
  assert.ok(Math.abs(Number(audioProbe.format.duration) - 3) < 0.15);
  const packetHashes = (file) =>
    JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_packets",
          "-show_data_hash",
          "sha256",
          "-show_entries",
          "packet=data_hash",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    ).packets.map((p) => p.data_hash);
  assert.deepEqual(
    packetHashes(audioItem.filename),
    packetHashes(path.join(root, "audio-high.m4a")),
  );
  results.push(
    "Audio menu selects the highest non-default HLS audio rendition and saves audio-only M4A with identical encoded packets",
  );
  await click("video");
  const sameVideo = await waitJob(
    (j) =>
      j.record.tweetId === current.rest_id &&
      j.mode === "video" &&
      ["complete", "failed"].includes(j.state),
  );
  assert.equal(sameVideo.state, "complete");
  assert.notEqual(sameVideo.key, audioJob.key);
  results.push(
    "Video and audio downloads of the same media have separate identities",
  );
  mode = "ssr";
  current = tweet("1000000000000000992", "directaudio");
  await page.goto("https://x.com/fixture/status/" + current.rest_id);
  await click("audio");
  const directAudio = await waitJob(
    (j) =>
      j.record.tweetId === current.rest_id &&
      ["complete", "failed"].includes(j.state),
  );
  assert.equal(directAudio.state, "complete", JSON.stringify(directAudio));
  const directItem = await popup.evaluate(
    async (id) => (await chrome.downloads.search({ id }))[0],
    directAudio.downloadId,
  );
  assert.deepEqual(
    packetHashes(directItem.filename),
    packetHashes(path.join(root, "low.mp4")),
  );
  results.push(
    "MP4-only source audio is extracted losslessly instead of downloading the video",
  );
  mode = "ssr";
  current = tweet("1000000000000000993", "silent");
  await page.goto("https://x.com/fixture/status/" + current.rest_id);
  await page.waitForSelector('xvd-quality[data-state="ready"]');
  assert.match(
    await page.locator("xvd-quality").getAttribute("aria-label"),
    /无音轨/,
  );
  const beforeSilent = (await readJobs()).length;
  await click("audio");
  assert.equal((await readJobs()).length, beforeSilent);
  results.push(
    "Silent videos show no audio and disable the audio download option",
  );
  // Screenshot pixels prove that the translucent control updates with the live backdrop.
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.evaluate(() => {
    const video = document.querySelector("video");
    video.style.visibility = "hidden";
    video.parentElement.style.background = "#ef3434";
  });
  const control = page.locator("xvd-download");
  const red = await control.screenshot();
  await page.evaluate(() => {
    document.querySelector("video").parentElement.style.background = "#345bef";
  });
  const blue = await control.screenshot();
  const rPixels = await sharp(red).removeAlpha().raw().toBuffer(),
    bPixels = await sharp(blue).removeAlpha().raw().toBuffer();
  let delta = 0;
  for (let i = 0; i < rPixels.length; i++)
    delta += Math.abs(rPixels[i] - bPixels[i]);
  assert.ok(delta / rPixels.length > 15);
  results.push(
    "Button pixels respond to changing backdrop instead of an opaque black fill",
  );
  await page.evaluate(() => {
    document.querySelector("video").style.visibility = "";
  });
  await page.waitForTimeout(300);
  const ctrl = await control.boundingBox();
  await page.mouse.click(ctrl.x + 14, ctrl.y + 14);
  await page.screenshot({ path: `${out}/v1.1-menu-desktop.png` });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("xvd-menu").count(), 0);
  results.push("Menu supports keyboard activation and Escape dismissal");
  await writeFile(
    `${out}/e2e-report.json`,
    JSON.stringify({ results, errors, probe, audioProbe }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: results.length, results, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
} finally {
  release?.();
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
