import { chromium } from "playwright";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const source = JSON.parse(
  await readFile("output/playwright/source-report.json", "utf8"),
);
const record = source.results[0].media[0];
record.variants = record.variants.filter((v) => v.kind === "hls");
const extension = path.resolve("dist"),
  proxy = process.env.https_proxy ?? process.env.HTTPS_PROXY;
const context = await chromium.launchPersistentContext("", {
  channel: process.env.XVD_CHROME ? undefined : "chromium",
  executablePath: process.env.XVD_CHROME,
  headless: true,
  proxy: proxy ? { server: proxy } : undefined,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  acceptDownloads: true,
});
try {
  const service =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(service.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const outcome = await page.evaluate(async (record) => {
    const worker = new Worker("media-worker.js", { type: "module" });
    const jobId = crypto.randomUUID();
    let blob;
    const call = (payload) =>
      new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          worker.terminate();
          reject(Error("Timed out"));
        }, 180000);
        const listener = (e) => {
          if (e.data.requestId !== requestId) return;
          clearTimeout(timer);
          worker.removeEventListener("message", listener);
          e.data.type === "error"
            ? reject(Error(e.data.error))
            : resolve(e.data.result);
        };
        worker.addEventListener("message", listener);
        worker.postMessage({ ...payload, requestId });
      });
    try {
      const plan = await call({ type: "plan", record });
      const candidate = plan.candidates[0];
      await call({ type: "render", jobId, candidate, record });
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("xvd-temp");
      const file = await (await dir.getFileHandle(`${jobId}.mp4`)).getFile();
      blob = URL.createObjectURL(file);
      const downloadId = await chrome.downloads.download({
        url: blob,
        filename: "xvd-live-hls-verification.mp4",
        conflictAction: "uniquify",
      });
      let item;
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        item = (await chrome.downloads.search({ id: downloadId }))[0];
        if (item.state === "complete") break;
        if (item.state === "interrupted") throw Error(item.error);
        await new Promise((r) => setTimeout(r, 200));
      }
      if (item.state !== "complete") throw Error("Native save timed out");
      await dir.removeEntry(`${jobId}.mp4`);
      return {
        candidate,
        warnings: plan.warnings,
        filename: item.filename,
        size: file.size,
      };
    } finally {
      worker.terminate();
      if (blob) URL.revokeObjectURL(blob);
    }
  }, record);
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
        outcome.filename,
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    probe.streams.find((s) => s.codec_type === "video")?.width !==
      outcome.candidate.width ||
    !probe.streams.some((s) => s.codec_type === "audio")
  )
    throw Error("Unexpected output tracks");
  const duration = Number(probe.format.duration);
  if (Math.abs(duration - record.durationMs / 1000) > 0.5)
    throw Error("Unexpected duration");
  await copyFile(outcome.filename, "output/playwright/live-hls.mp4");
  await writeFile(
    "output/playwright/live-hls-report.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: "Production media worker with actual X CDN HLS; explicit HLS-only verification",
        ...outcome,
        probe,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        size: outcome.size,
        candidate: outcome.candidate.label,
        streams: probe.streams.map((s) => ({
          codec: s.codec_name,
          type: s.codec_type,
          duration: s.duration,
        })),
        duration,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
