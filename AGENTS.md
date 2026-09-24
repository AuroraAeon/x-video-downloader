# X Video Downloader

This is an independent Chrome Manifest V3 extension, not a MediaCrawler component.

- Use pnpm and the pinned lockfile. Build output goes in `dist`; publish ZIPs from `release`.
- Keep page input untrusted. Only trusted content-script UI actions may start downloads.
- Keep runtime code bundled locally. Never add fixed X query IDs, authentication exports, remote code or a backend requirement.
- Preserve complete candidate inspection, lossless audio extraction and layout outside the player when optimizing.
- Background inspection must be bounded and cancellable. Partial quality must never be labelled as confirmed highest quality.
- Keep `package.json` and `public/manifest.json` versions equal. Update README (`README.md` and `README.en.md` together), CHANGELOG and validation evidence with releases.
- Keep user-facing text in `public/_locales/{en,zh_CN}/messages.json`; runtime code renders the bundled catalogue, not `chrome.i18n.getMessage`. Every parameterised message must declare `placeholders`: undeclared substitutions make `getMessage` return mangled text and corrupt the manifest name and description. Browser suites pin `locale: "en-US"`; never assert message text under the host machine's language.
- Store listings depend on the hosted site in `docs/site` (privacy policy URL). Site claims and `public/manifest.json` must stay consistent: `tests/privacy-claims.test.ts` gates the origins, permission table and bilingual policy, `tests/site.test.ts` gates labelled versions, hreflang, sitemap, share-image URLs and store image sizes. Regenerate imagery with `pnpm assets`; do not hand-edit `docs/site/assets`. Never state that a store listing exists, is pending or is in review until a submission actually exists. `tests/community.test.ts` gates the issue forms and the front page (links, version, store status). Release automation reads credentials from environment variables only; never commit store or OAuth secrets.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:layout`, and `pnpm exec node scripts/check-package.mjs` as relevant.
- Performance claims require the same fixture, latency and candidate results on both builds. Use `scripts/performance.mjs` and document real-site network limits separately.
- Do not commit `output`, credentials, local browser profiles, recordings or downloaded media.
