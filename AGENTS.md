# X Video Downloader

This is an independent Chrome Manifest V3 extension, not a MediaCrawler component.

- Use pnpm and the pinned lockfile. Build output goes in `dist`; publish ZIPs from `release`.
- Keep page input untrusted. Only trusted content-script UI actions may start downloads.
- Keep runtime code bundled locally. Never add fixed X query IDs, authentication exports, remote code or a backend requirement.
- Preserve complete candidate inspection, lossless audio extraction and layout outside the player when optimizing.
- Background inspection must be bounded and cancellable. Partial quality must never be labelled as confirmed highest quality.
- Keep `package.json` and `public/manifest.json` versions equal. Update README, CHANGELOG and validation evidence with releases.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:layout`, and `pnpm exec node scripts/check-package.mjs` as relevant.
- Performance claims require the same fixture, latency and candidate results on both builds. Use `scripts/performance.mjs` and document real-site network limits separately.
- Do not commit `output`, credentials, local browser profiles, recordings or downloaded media.
