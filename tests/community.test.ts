import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

const dir = ".github/ISSUE_TEMPLATE";
const siteBase = "https://auroraeon.github.io/x-video-downloader/";
const version = (
  JSON.parse(await readFile("package.json", "utf8")) as { version: string }
).version;

// GitHub renders only these issue-form field types; anything else makes the
// whole form disappear from the "New issue" page without a build error.
const fieldTypes = new Set([
  "markdown",
  "input",
  "textarea",
  "dropdown",
  "checkboxes",
]);

const forms = ["bug-report.yml", "feature-request.yml"];
const raw = async (name: string) => await readFile(`${dir}/${name}`, "utf8");
const types = (yml: string) =>
  [...yml.matchAll(/^\s*- type: (\w+)\s*$/gm)].map((m) => m[1]!);
const ids = (yml: string) =>
  [...yml.matchAll(/^\s+id: ([A-Za-z0-9_-]+)\s*$/gm)].map((m) => m[1]!);

describe("issue templates", () => {
  it("ship exactly the bug, feature and config files", async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yml")).sort();
    expect(files).toEqual([...forms, "config.yml"].sort());
  });
  it("declare name, description, labels and a body", async () => {
    for (const form of forms) {
      const yml = await raw(form);
      for (const key of ["name:", "description:", "labels:", "body:"])
        expect(yml, `${form} has no ${key}`).toMatch(new RegExp(`^${key}`, "m"));
    }
  });
  it("use only field types GitHub renders", async () => {
    for (const form of forms) {
      const yml = await raw(form);
      const found = types(yml);
      expect(found.length, `${form} has no fields`).toBeGreaterThan(3);
      for (const type of found)
        expect(fieldTypes.has(type), `${form}: unknown type ${type}`).toBe(true);
    }
  });
  it("give every collected field a unique id and a label", async () => {
    for (const form of forms) {
      const yml = await raw(form);
      const fields = types(yml).filter((t) => t !== "markdown");
      const found = ids(yml);
      expect(new Set(found).size, `${form} reuses an id`).toBe(found.length);
      expect(found.length, `${form} id count`).toBe(fields.length);
      const labels = [...yml.matchAll(/^\s*(?:-\s+)?label:\s*(.+)$/gm)];
      // Each field labels itself; checkbox options label themselves too.
      expect(labels.length).toBeGreaterThanOrEqual(fields.length);
      for (const [, label] of labels)
        expect(label!.trim(), `${form} empty label`).toBeTruthy();
    }
  });
  it("require the two bug-report confirmations", async () => {
    const yml = await raw("bug-report.yml");
    expect(types(yml)).toContain("checkboxes");
    const options = (yml.match(/^ {8}- label:/gm) ?? []).length;
    // An option without `required: true` is a suggestion, not a confirmation.
    const required = (yml.match(/^ {10}required: true$/gm) ?? []).length;
    expect(options, "checkbox options").toBe(2);
    expect(required, "checkbox options marked required").toBe(options);
  });
  it("warn that cookies and auth headers are not evidence", async () => {
    const yml = await raw("bug-report.yml");
    const text = yml.toLowerCase();
    for (const word of ["cookie", "authorization", "token"])
      expect(text, `bug report stopped warning about ${word}`).toContain(word);
    expect(yml).toMatch(/do not copy\s+request headers/i);
  });
  it("link contact URLs at pages that exist in this repository", async () => {
    const yml = await raw("config.yml");
    expect(yml).toMatch(/^blank_issues_enabled: false$/m);
    const urls = [...yml.matchAll(/^\s+url: (\S+)$/gm)].map((m) => m[1]!);
    expect(urls.length).toBe(2);
    for (const url of urls) {
      expect(url, `contact URL must be on our site: ${url}`).toContain(siteBase);
      const file = `docs/site/${url.split(siteBase)[1]}`;
      expect(existsSync(file), `${url} has no ${file}`).toBe(true);
    }
    expect([...yml.matchAll(/^\s+about: (.+)$/gm)].length).toBe(urls.length);
  });
});

const frontPages = [
  {
    file: "README.md",
    versions: [/当前版本 \*\*(\d+\.\d+\.\d+)\*\*/g],
    absent: /审核中|已上架|listed on the Chrome Web Store/i,
    storeStatus: "商店尚未上架",
  },
  {
    file: "README.en.md",
    versions: [/Current version: \*\*(\d+\.\d+\.\d+)\*\*/g],
    absent: /in review|is live on the Chrome Web Store|listing has been approved/i,
    storeStatus: "No store listing exists yet",
  },
];
const zipVersion = /x-video-downloader-(\d+\.\d+\.\d+)\.zip/g;

describe("repository front page", () => {
  it("resolves every relative link on both front pages", async () => {
    let seen = 0;
    for (const { file } of frontPages) {
      const readme = await readFile(file, "utf8");
      const links = [
        ...readme.matchAll(/\]\((?!https?:|mailto:)([^)#]+)(#[^)]*)?\)/g),
      ];
      expect(links.length, `${file} has too few links`).toBeGreaterThan(5);
      for (const [, target] of links) {
        expect(existsSync(target!), `${file} link ${target} is dead`).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
  it("states its own version like the package does", async () => {
    for (const { file, versions } of frontPages) {
      const readme = await readFile(file, "utf8");
      const declared = versions
        .flatMap((pattern) => [...readme.matchAll(pattern)].map((m) => m[1]!))
        .concat([...readme.matchAll(zipVersion)].map((m) => m[1]!));
      expect(declared.length, `${file} states no version`).toBeGreaterThanOrEqual(2);
      for (const found of declared)
        expect(found, `${file} version drifted from package.json`).toBe(version);
    }
  });
  it("does not claim a store listing that does not exist yet", async () => {
    for (const { file, absent, storeStatus } of frontPages) {
      const readme = await readFile(file, "utf8");
      expect(readme, `${file} lost its status line`).toContain(storeStatus);
      // "In review" is a claim about a submission nobody has made.
      expect(readme, `${file} claims a listing exists`).not.toMatch(absent);
    }
  });
  it("points contributors at the two entry files", async () => {
    for (const file of ["CONTRIBUTING.md", "SECURITY.md"])
      expect(existsSync(file), file).toBe(true);
    for (const { file } of frontPages) {
      const readme = await readFile(file, "utf8");
      for (const entry of ["CONTRIBUTING.md", "SECURITY.md"])
        expect(readme, `${file} never links ${entry}`).toContain(entry);
    }
  });
  it("cross-links its two language versions", async () => {
    const zh = await readFile("README.md", "utf8");
    const en = await readFile("README.en.md", "utf8");
    expect(zh).toMatch(/\[English\]\(README\.en\.md\)/);
    expect(en).toMatch(/\[简体中文\]\(README\.md\)/);
  });
  it("keeps the permission table the size of the manifest", async () => {
    const manifest = JSON.parse(
      await readFile("public/manifest.json", "utf8"),
    ) as { permissions: string[]; host_permissions: string[] };
    const granted = [
      ...manifest.permissions,
      ...manifest.host_permissions,
    ].sort();
    for (const { file } of frontPages) {
      const readme = await readFile(file, "utf8");
      const table = [...readme.matchAll(/^\| `([a-z./:*_]+)`/gm)].map((m) => m[1]!);
      expect(table.sort(), `${file} permission table`).toEqual(granted);
    }
  });
});
