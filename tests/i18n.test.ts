import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { t, uiLanguage } from "../src/i18n";

interface CatalogEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}
const load = async (locale: string) =>
  JSON.parse(
    await readFile(`public/_locales/${locale}/messages.json`, "utf8"),
  ) as Record<string, CatalogEntry>;
const referenced = (message: string) =>
  [...message.matchAll(/\$([A-Za-z0-9_]+)/g)].map((m) => m[1]).sort();

describe("locale catalogues", () => {
  it("keep both locales key-for-key with matching placeholders", async () => {
    const en = await load("en"),
      zh = await load("zh_CN"),
      keys = Object.keys(en).sort();
    expect(Object.keys(zh).sort()).toEqual(keys);
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      expect(en[key]!.message.trim(), key).toBeTruthy();
      const arity = (entry: { message: string }) =>
        referenced(entry.message).length;
      expect(arity(zh[key]!), `${key} argument count differs from English`).toBe(
        arity(en[key]!),
      );
    }
  });
  it("declares every substitution so getMessage renders it", async () => {
    for (const locale of ["en", "zh_CN"]) {
      const catalog = await load(locale);
      for (const [key, entry] of Object.entries(catalog)) {
        // Undeclared substitutions make chrome.i18n.getMessage return mangled
        // text, which is what corrupted the manifest name and description.
        expect(entry.message, `${locale}/${key} bare substitution`).not.toMatch(
          /\$\d/,
        );
        const declared = Object.keys(entry.placeholders ?? {});
        for (const name of referenced(entry.message))
          expect(declared, `${locale}/${key} uses undeclared $${name}`).toContain(
            name,
          );
        expect(
          declared.length,
          `${locale}/${key} declares unused placeholders`,
        ).toBe(referenced(entry.message).length);
      }
    }
  });
  it("keeps the English catalogue free of untranslated text", async () => {
    const untranslated = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
    const en = await load("en");
    for (const [key, entry] of Object.entries(en))
      expect(entry.message, key).not.toMatch(untranslated);
    const zh = await load("zh_CN");
    expect(
      Object.values(zh).filter((entry) => untranslated.test(entry.message))
        .length,
    ).toBeGreaterThan(40);
  });
  it("references every catalogue key from the runtime or the manifest", async () => {
    const en = await load("en"),
      manifest = await readFile("public/manifest.json", "utf8"),
      source: Record<string, string> = {};
    for (const file of await readdir("src"))
      if (file.endsWith(".ts")) source[file] = await readFile(`src/${file}`, "utf8");
    const code = Object.values(source).join("\n");
    for (const key of Object.keys(en)) {
      const used =
        new RegExp(`\\bt\\(\\s*"${key}"`).test(code) ||
        code.includes(`"${key}"`) ||
        manifest.includes(`__MSG_${key}__`);
      expect(used, `nothing references ${key}`).toBe(true);
    }
  });
  it("resolves manifest messages in both locales", async () => {
    const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
    expect(manifest.default_locale).toBe("en");
    const referenced = [
      ...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_.]+)__/g),
    ].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const locale of ["en", "zh_CN"]) {
      const catalog = await load(locale);
      for (const key of referenced)
        expect(catalog[key], `${key} in ${locale}`).toBeDefined();
    }
    expect(manifest.name).toBe("__MSG_extensionName__");
    expect(manifest.description).toBe("__MSG_extensionDescription__");
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });
  it("substitutes declared placeholders in both call shapes", () => {
    expect(uiLanguage()).toBe("en");
    expect(t("errHttpStatus", 403)).toBe("Media service returned HTTP 403");
    expect(t("warnAutoFallback", ["1280x720", "boom"])).toBe(
      "Fell back to 1280x720: boom",
    );
    expect(t("valueLine", "Best video", "1920 × 1080")).toBe(
      "Best video: 1920 × 1080",
    );
    // A missing argument leaves the placeholder visible instead of inventing text.
    expect(t("warnAutoFallback", "only")).toContain("$DETAIL");
  });
});
