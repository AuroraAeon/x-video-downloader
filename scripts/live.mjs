import { chromium } from "playwright";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const out = path.resolve("output/playwright");
await mkdir(out, { recursive: true });
const extension = path.resolve("dist");
const downloadMode = process.env.XVD_MODE === "audio" ? "audio" : "video";
const proxyServer = process.env.https_proxy ?? process.env.HTTPS_PROXY;
const context = await chromium.launchPersistentContext("", {
  channel: process.env.XVD_CHROME ? undefined : "chromium",
  executablePath: process.env.XVD_CHROME,
  headless: process.env.XVD_HEADLESS === "1",
  proxy: proxyServer ? { server: proxyServer } : undefined,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1280, height: 960 },
  acceptDownloads: true,
});
const report = {
  url: "https://x.com/LisPower1/status/1001551623938805763",
  startedAt: new Date().toISOString(),
  errors: [],
  statuses: [],
  mode: downloadMode,
};
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("response", (r) => {
    if (
      r.request().isNavigationRequest() &&
      r.request().frame() === page.mainFrame()
    ) {
      report.navigation = { url: r.url(), status: r.status() };
      console.log("Navigation:", r.status(), r.url());
    }
  });
  await page.goto(report.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("xvd-download", { timeout: 60000 });
  await page.waitForSelector('xvd-quality[data-state="ready"]', {
    timeout: 120000,
  });
  report.inline = await page
    .locator("xvd-quality")
    .first()
    .getAttribute("aria-label");
  report.geometry = await page.evaluate(() => ({
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
  if (report.geometry.info.y < report.geometry.video.bottom - 2)
    throw Error("Quality strip overlaps the video");
  console.log("Inline quality:", report.inline);
  await page.screenshot({ path: `${out}/live-${downloadMode}-before.png` });
  const host = page.locator("xvd-download").first();
  const rect = await host.boundingBox();
  await page.mouse.click(rect.x + 14, rect.y + 14);
  await page.screenshot({ path: `${out}/live-${downloadMode}-menu.png` });
  if (downloadMode === "audio") await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.setViewportSize({ width: 390, height: 600 });
  const deadline = Date.now() + 240000;
  let final;
  while (Date.now() < deadline) {
    const response = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "LIST" }),
    );
    const job = response.jobs?.[0];
    if (job && report.statuses.at(-1) !== job.state) {
      report.statuses.push(job.state);
      console.log(
        "Live job:",
        job.state,
        job.candidate?.label ?? "",
        job.error ?? "",
      );
    }
    if (job && ["complete", "failed", "interrupted"].includes(job.state)) {
      final = job;
      break;
    }
    if (!job && Date.now() > deadline - 210000) {
      report.buttonState = await host.evaluate((h) => ({
        text: h.innerText,
        title: h.title,
      }));
      throw Error("Button did not create a job within 30 seconds");
    }
    await page.waitForTimeout(1000);
  }
  report.job = final;
  await page.screenshot({ path: `${out}/live-${downloadMode}-after.png` });
  await popup.screenshot({ path: `${out}/live-${downloadMode}-popup.png` });
  if (final?.state !== "complete")
    throw Error(`Live download failed: ${JSON.stringify(final)}`);
  const item = await popup.evaluate(
    async (id) => (await chrome.downloads.search({ id }))[0],
    final.downloadId,
  );
  report.probe = JSON.parse(
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
  if (
    downloadMode === "audio" &&
    (report.probe.streams.length !== 1 ||
      report.probe.streams[0].codec_type !== "audio")
  )
    throw Error("Audio output unexpectedly includes video or lacks audio");
  await copyFile(
    item.filename,
    `${out}/live-${downloadMode}.${downloadMode === "audio" ? "m4a" : "mp4"}`,
  );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        candidate: final.candidate,
        warnings: final.warnings,
        streams: report.probe.streams.map((s) => ({
          type: s.codec_type,
          codec: s.codec_name,
          width: s.width,
          height: s.height,
          duration: s.duration,
        })),
        duration: report.probe.format.duration,
      },
      null,
      2,
    ),
  );
} catch (e) {
  report.failure = String(e);
  throw e;
} finally {
  await writeFile(
    `${out}/live-${downloadMode}-report.json`,
    JSON.stringify(report, null, 2),
  );
  await context.close();
}
