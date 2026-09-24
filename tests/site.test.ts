import { describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";

const root = "docs/site";
const base = "https://auroraeon.github.io/x-video-downloader/";
const pages = ["index.html", "zh.html", "privacy.html", "privacy-zh.html"];
const landingPages = ["index.html", "zh.html"];

const read = (page: string) => readFile(`${root}/${page}`, "utf8");
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

/** Store listings and the sitemap are only usable if their URLs are absolute. */
const alternates = (html: string) =>
  [...html.matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g)]
    .map((m) => `${m[1]}=${m[2]!.replace(base, "/")}`)
    .sort()
    .join("|");

/** PNG width and height live at fixed byte offsets in the IHDR chunk. */
const pngSize = async (file: string) => {
  const bytes = await readFile(file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};

const version = JSON.parse(await readFile("package.json", "utf8")).version as string;

describe("public site", () => {
  it("links only to files that exist in the folder", async () => {
    for (const page of pages) {
      const html = await read(page);
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const url = match[1] ?? "";
        if (/^(#|https?:|mailto:|data:)/.test(url)) continue;
        expect(
          await exists(`${root}/${url.split("#")[0]}`),
          `${page} -> ${url}`,
        ).toBe(true);
      }
      // Social cards copy absolute URLs; a typo there ships a broken preview.
      for (const abs of html.matchAll(
        /content="(https:\/\/auroraeon\.github\.io\/x-video-downloader\/[^"]+)"/g,
      )) {
        const file = (abs[1] ?? "").replace(base, "");
        expect(await exists(`${root}/${file}`), `${page} -> ${abs[1]}`).toBe(
          true,
        );
      }
    }
  });

  it("labels every page with the shipped extension version", async () => {
    // Dependency versions are listed on the same pages, so only the numbers that
    // follow a "Version"/"版本" label may disagree with package.json.
    for (const page of pages) {
      const text = (await read(page)).replace(/<[^>]*>/g, " ");
      const labelled = [
        ...text.matchAll(/(?<![A-Za-z])(?:version|版本)\s*[:：]?\s*(\d+\.\d+\.\d+)/gi),
      ].map((m) => m[1]!);
      expect(labelled.length, page).toBeGreaterThanOrEqual(2);
      for (const found of labelled) expect(found, page).toBe(version);
    }
  });

  it("declares a reciprocal, absolute hreflang group on every page", async () => {
    for (const page of pages) {
      const html = await read(page);
      for (const lang of ["en", "zh-Hans", "x-default"])
        expect(html, `${page} lacks hreflang ${lang}`).toContain(
          `hreflang="${lang}"`,
        );
      for (const match of html.matchAll(
        /<link\s+rel="alternate"\s+hreflang="[^"]+"\s+href="([^"]+)"/g,
      ))
        expect(match[1], page).toMatch(
          /^https:\/\/auroraeon\.github\.io\/x-video-downloader\//,
        );
    }
    expect(alternates(await read("index.html"))).toBe(
      alternates(await read("zh.html")),
    );
    expect(alternates(await read("privacy.html"))).toBe(
      alternates(await read("privacy-zh.html")),
    );
  });

  it("publishes structured data for the extension on both landing pages", async () => {
    for (const page of landingPages) {
      const blocks = [
        ...(await read(page)).matchAll(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
        ),
      ];
      expect(blocks.length, page).toBe(1);
      const data = JSON.parse(blocks[0]![1]!);
      expect(data["@type"]).toBe("SoftwareApplication");
      expect(data.softwareVersion).toBe(version);
      expect(data.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.isAccessibleForFree).toBe(true);
      expect(data.offers.price).toBe("0");
      expect(data.codeRepository).toBe(
        "https://github.com/AuroraAeon/x-video-downloader",
      );
      expect(data.featureList.length).toBeGreaterThan(3);
      // A listing may not advertise a store URL that does not exist yet.
      expect(data.downloadUrl).toBeUndefined();
      for (const url of [data.screenshot, data.url] as string[]) {
        const file = url.replace(base, "");
        expect(
          await exists(`${root}/${file === "" ? "index.html" : file}`),
          `${page} ${url}`,
        ).toBe(true);
      }
    }
  });

  it("serves a sitemap and robots file covering the same pages", async () => {
    const sitemap = await read("sitemap.xml");
    expect(sitemap).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    // xhtml:link is only legal with the namespace declared, or parsers reject it.
    expect(sitemap).toContain(
      'xmlns:xhtml="http://www.w3.org/1999/xhtml"',
    );
    expect((sitemap.match(/<url>/g) ?? []).length).toBe(pages.length);
    expect((sitemap.match(/<url>/g) ?? []).length).toBe(
      (sitemap.match(/<\/url>/g) ?? []).length,
    );
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = match[1] ?? "";
      const file = loc.replace(base, "");
      expect(
        await exists(`${root}/${file === "" ? "index.html" : file}`),
        loc,
      ).toBe(true);
    }
    const robots = await read("robots.txt");
    expect(robots).toContain(`Sitemap: ${base}sitemap.xml`);
  });

  it("keeps store imagery at the sizes the stores demand", async () => {
    const expected: Record<string, string> = {
      "shot-en.png": "1280x800",
      "shot-en-menu.png": "1280x800",
      "shot-zh.png": "1280x800",
      "shot-zh-menu.png": "1280x800",
      "tile-en.png": "440x280",
      "tile-zh.png": "440x280",
      "marquee-en.png": "1400x560",
      "marquee-zh.png": "1400x560",
    };
    for (const [name, size] of Object.entries(expected))
      expect(await pngSize(`${root}/assets/${name}`), name).toBe(size);
  });
});
