# Contributing

Independent Manifest V3 extension for saving the video or audio an X post
already plays in your browser. Not affiliated with X Corp.

## Before you open a pull request

Install with the pinned lockfile, then run the gates your change touches:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:layout
pnpm package
pnpm exec node scripts/check-package.mjs
```

`pnpm test:live` and `pnpm test:live-hls` need real network access and a logged-in
browser profile, so they are not part of CI and their output is not required in a
PR. Run them locally when a change touches media inspection, and never commit the
recordings, profiles or downloaded files they produce.

On release day the artifact reviewers actually install is the published ZIP, not
`dist`, so re-run the browser suites against its contents: unzip
`release/x-video-downloader-<version>.zip` (verify it against
`release/SHA256SUMS.txt` first) and point both suites at that directory with
`XVD_EXTENSION=<unzipped dir> pnpm test:e2e` and then
`XVD_EXTENSION=<unzipped dir> pnpm test:layout`. Running the two browser suites
at the same time has been observed to abort them (exit 13) without a failing
assertion, so run one, wait, then run the other.

## Invariants a change must keep

These are the reasons features get rejected, not style preferences:

- **The page stays untrusted.** Only a click on the extension's own UI may start a
  download. Content never reaches `chrome.downloads` from page script, and posted
  messages carry media records, not instructions.
- **Everything ships inside the package.** No remote code, no `eval`, no fixed X
  query IDs, no backend, no API key, no telemetry. `check-package.mjs` fails the
  build on a stray file, a widened `host_permissions`, a changed CSP or dynamic
  code evaluation.
- **Inspection stays bounded and cancellable.** Probes must remain finite in
  bytes, concurrency and time, and partial results must never be labelled as
  confirmed highest quality.
- **Audio extraction stays lossless.** The audio codec packet must match the
  source; merging is remuxing, not re-encoding.
- **The quality strip stays outside the player.** It occupies normal document flow
  below the player instead of overlaying it; `pnpm test:layout` is the regression.
- **User-facing text lives in `public/_locales/{en,zh_CN}/messages.json`.** Add the
  key to both catalogues with identical placeholders, and keep the manifest under
  132 characters. Do not call `chrome.i18n.getMessage` from the media worker: it
  has no `chrome.i18n`, so the bundled catalogue is read directly.
- **`package.json` and `public/manifest.json` versions stay equal**, and
  `README.md`, `README.en.md`, `CHANGELOG.md` and `docs/validation.md` are updated
  with the release. The two front pages are kept in step by
  `tests/community.test.ts`.

## If you change the site or the manifest

`docs/site` is what the store reviewers read, so its claims are gated:
`tests/privacy-claims.test.ts` requires the published origins, permission table
and bilingual privacy policy to match `public/manifest.json` in both directions,
and `tests/site.test.ts` checks versions, `hreflang`, `sitemap.xml`, share-image
URLs and the pixel sizes of the store imagery. Add a permission and the site test
fails until the policy says so too — update the copy rather than relaxing the
assertion. Store and site imagery is generated, not hand-made: run `pnpm assets`
after any UI copy or layout change.

## Issue forms and the front page

`.github/ISSUE_TEMPLATE/` and both front pages (`README.md`, `README.en.md`) are
gated by `tests/community.test.ts`: field types must be ones GitHub actually
renders, every collected field needs a unique `id` and label, both confirmations
must stay `required`, `config.yml` may only link pages that exist in this
repository, README links may not go dead, the two pages must link each other,
their permission tables must equal the manifest's, and they must keep stating the
package version and that no store listing exists yet. Change a permission and the
table test fails until both front pages say so too.

## Performance claims

A speed claim needs the same fixture, latency and candidate results on both
builds: `pnpm test:performance` compares them item by item. Real-site network
limits are documented separately from local measurements.

## Scope

Bulk archiving, playlist rippling, downloading content behind a login the user
does not already have, and anything that evades X's rate limits are out of scope
by design. Propose such a feature in an issue first and expect a no.
