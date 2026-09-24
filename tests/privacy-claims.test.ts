import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

interface Manifest {
  host_permissions: string[];
  permissions: string[];
}

const manifest = JSON.parse(
  await readFile("public/manifest.json", "utf8"),
) as Manifest;

/** Tag text only: link targets are checked by tests/site.test.ts. */
const prose = async (page: string) =>
  (await readFile(`docs/site/${page}`, "utf8")).replace(/<[^>]*>/g, " ");

const hosts = (text: string) =>
  [...new Set([...text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]!.toLowerCase()))].sort();

const granted = manifest.host_permissions
  .map((pattern) => pattern.replace(/\/\*$/, ""))
  .sort();

/** Our own site, repository and license metadata are not data recipients. */
const ownHosts = [
  "https://auroraeon.github.io",
  "https://github.com",
  "https://opensource.org",
  "https://schema.org",
];

describe("privacy claims on the public site", () => {
  it("names exactly the origins the extension is granted", async () => {
    const en = hosts(await prose("privacy.html"));
    const zh = hosts(await prose("privacy-zh.html"));
    expect(en, "English policy hosts").toEqual(granted);
    expect(zh, "Chinese policy hosts").toEqual(granted);
  });

  it("keeps both language versions of the policy on the same hosts", async () => {
    expect(hosts(await prose("privacy-zh.html"))).toEqual(
      hosts(await prose("privacy.html")),
    );
  });

  it("mentions no outbound host beyond the granted origins and our own", async () => {
    for (const page of ["index.html", "zh.html"]) {
      for (const host of hosts(await prose(page)))
        expect([...granted, ...ownHosts], `${page} ${host}`).toContain(host);
    }
  });

  it("lists exactly the granted permissions in the permission tables", async () => {
    // The prose mentions "cookies" as something refused, so searching the whole
    // page proves nothing. Read the table whose header says Permission/权限 and
    // compare its first column with the manifest.
    for (const page of ["index.html", "zh.html"]) {
      const html = await readFile(`docs/site/${page}`, "utf8");
      const table = [...html.matchAll(/<table[\s\S]*?<\/table>/g)]
        .map((m) => m[0]!)
        .find((t) => /<th[^>]*>\s*(?:Permission|权限)\s*<\/th>/i.test(t));
      expect(table, `${page} has no permission table`).toBeTruthy();
      const tokens: string[] = [];
      for (const row of table!.matchAll(/<tr>[\s\S]*?<\/tr>/g))
        for (const cell of row[0]!.matchAll(/<td>([\s\S]*?)<\/td>/g)) {
          const code = /<code>([^<]+)<\/code>/.exec(cell[1] ?? "");
          if (code) tokens.push(code[1]!.trim());
          break;
        }
      for (const permission of manifest.permissions)
        expect(tokens, `${page} omits "${permission}"`).toContain(permission);
      for (const host of manifest.host_permissions)
        expect(tokens, `${page} omits "${host}"`).toContain(host);
      for (const token of tokens)
        expect(
          [...manifest.permissions, ...manifest.host_permissions],
          `${page} claims "${token}" is granted but the manifest says otherwise`,
        ).toContain(token);
    }
  });
});
