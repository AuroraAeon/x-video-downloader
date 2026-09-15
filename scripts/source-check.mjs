import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { outputFiles } = await build({
  entryPoints: ["src/ssr.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { SsrDecoder } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const urls = [
  "https://x.com/LisPower1/status/1001551623938805763",
  "https://x.com/BrooklynNets/status/1349794411333394432",
];
const report = [];
for (const url of urls) {
  const html = execFileSync(
    "curl.exe",
    ["-L", "--fail", "--max-time", "40", "-sS", url],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((t) => t.includes("relayRecords"));
  const decoder = new SsrDecoder();
  const records = scripts.flatMap((s) => decoder.decode(s));
  const focal = records.filter((r) => r.tweetId === url.split("/").at(-1));
  assert.ok(focal.length, `No focal media decoded from ${url}`);
  report.push({
    url,
    ssrScripts: scripts.length,
    media: [...new Map(focal.map((r) => [r.mediaId, r])).values()],
  });
}
await mkdir("output/playwright", { recursive: true });
await writeFile(
  "output/playwright/source-report.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      transport:
        "HTTPS via curl; source parsing only, not a browser end-to-end claim",
      results: report,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    report.map((r) => ({
      url: r.url,
      ssrScripts: r.ssrScripts,
      media: r.media.map((m) => ({
        mediaId: m.mediaId,
        variants: m.variants.length,
        source: m.source,
      })),
    })),
    null,
    2,
  ),
);
