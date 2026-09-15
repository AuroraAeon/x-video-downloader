import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
if (metadata.version !== manifest.version)
  throw Error("Package and manifest versions differ");
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await cp('LICENSE','dist/LICENSE');
for (const name of [
  "main",
  "content",
  "background",
  "offscreen",
  "media-worker",
  "popup",
]) {
  await build({
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    bundle: true,
    format: ["main", "content"].includes(name) ? "iife" : "esm",
    target: "chrome116",
    legalComments: "eof",
    minify: true,
    sourcemap: false,
  });
}
await mkdir("dist/icons", { recursive: true });
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="20" fill="#102329"/><path d="M64 24v53m-20-20 20 20 20-20M32 88v15h64V88" fill="none" stroke="#6ee7cc" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
for (const size of [16, 32, 48, 128])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`dist/icons/${size}.png`);
let notices = "Third-party libraries bundled in this extension\n\n";
for (const name of ["mediabunny", "acorn", "lucide"]) {
  const p = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  notices += `${name} ${p.version} (${p.license})\n`;
  for (const f of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
    try {
      notices += `${await readFile(`node_modules/${name}/${f}`, "utf8")}\n\n`;
      break;
    } catch {}
  }
}
await writeFile("dist/THIRD_PARTY_NOTICES.txt", notices);
console.log("Built dist/ (Manifest V3, all runtime code bundled locally).");
