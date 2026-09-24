import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
const entries = {};
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const archiveName = `x-video-downloader-${version}.zip`;
async function collect(dir, prefix = "") {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = `${dir}/${e.name}`,
      key = `${prefix}${e.name}`;
    if (e.isDirectory()) await collect(path, `${key}/`);
    else entries[key] = new Uint8Array(await readFile(path));
  }
}
await collect("dist");
entries["INSTALL.txt"] = strToU8(
  `X Video Downloader ${version}\n\n首次安装：解压到固定目录，打开 chrome://extensions，启用开发者模式，点击“加载已解压的扩展程序”，选择包含 manifest.json 的目录。\n\n更新：等待现有任务完成，将新包覆盖到原先加载的同一个目录，在 chrome://extensions 点击扩展的刷新图标，确认版本为 ${version}，再刷新所有 X 页面。无需卸载重装。\n\n点击视频右上角按钮，选择最高画质视频（MP4）或最高音质音频（M4A）。视频下方自动显示媒体参数。\n`,
);
// Sorted entries and a fixed timestamp keep the archive, and therefore its
// published checksum, identical across machines and runs. zipSync renders DOS
// timestamps from local time getters, so UTC midnight becomes 08:00 on a UTC+8
// box: anchor the constant to local midnight so every timezone writes the same
// bytes.
const epoch = new Date(1980, 0, 1, 0, 0, 0);
const files = {};
for (const key of Object.keys(entries).sort())
  files[key] = [entries[key], { mtime: epoch }];
await mkdir("release", { recursive: true });
const archive = zipSync(files, { level: 6 });
await writeFile(`release/${archiveName}`, archive);
await writeFile(
  "release/SHA256SUMS.txt",
  `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`,
);
console.log(`Created release/${archiveName}`);
