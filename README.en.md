# X Video Downloader

English · [简体中文](README.md)

A standalone Chrome Manifest V3 extension. It puts a small frosted-glass download button in the top-right corner of each video in an X post; clicking it lets you pick the highest-quality video (MP4) or the highest-bitrate audio (M4A). Resolution, frame rate and the audio codec, bitrate, sample rate and channel count are shown below the video without downloading anything first. The interface, statuses and error messages switch between Simplified Chinese and English with the browser UI language. Current version: **1.3.0**.

[Project site and privacy policy](https://auroraeon.github.io/x-video-downloader/) · [Download the latest build](https://github.com/AuroraAeon/x-video-downloader/releases/latest) · [Changelog](CHANGELOG.md)

No Python, no MediaCrawler, no paid X API, no server, no API key and no local FFmpeg. FFmpeg is only used by the development tests to generate samples and inspect results; the extension does not depend on it at runtime.

## Install

No store listing exists yet. Once one is approved this section is replaced by direct Chrome Web Store and Microsoft Edge Add-ons install links; see [docs/stores.md](docs/stores.md). Until then the only install path is:

1. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
2. Choose **Load unpacked** and select this project's `dist` directory. Alternatively unzip `release/x-video-downloader-1.3.0.zip` and select the directory that contains `manifest.json`.
3. Reload any open X tabs. Stay logged in as usual, click the download icon in the corner of a video, and pick video or audio.

The same build works in Edge, Whale, Opera and other Chromium-based browsers; `minimum_chrome_version` is 116. Firefox is not supported (the extension needs `offscreen` and OPFS).

Keep the extension directory after installing. To update, replace the build directory, click reload on the extension card, then reload X. No re-login and no cookie copying is required.

### Updating from an installed build

1. Wait for the current download to finish. If you loaded `dist` from this project, a new build already sits in place; if you loaded a ZIP, unpack the new one over **the same directory you loaded before**.
2. Open `chrome://extensions`, find X Video Downloader and click the reload icon on the card.
3. Confirm the extension version is **1.3.0**, then reload every open X tab.

There is no need to remove and reinstall. Keeping the same directory preserves the extension ID and the local task records. Tasks created by 1.0.0 are still read as video tasks.

### Standalone project location

The sources and the independent Git repository live in `F:\x-video-downloader`, outside the MediaCrawler tree. The old `F:\MediaCrawler\x-video-downloader` path keeps only a migration note and a `dist` compatibility link — no sources and no second Git repository; that link points at the new project's build, so an extension loaded from the old path can simply reload. Do not delete that compatibility entry unless you have moved the installed extension path.

On a new machine, clone this GitHub repository into any independent directory; you do not need MediaCrawler first. Neither running nor building references its paths, dependencies or services.

Files are saved through the Chrome download manager, so the destination follows your Chrome settings. Example file name: `x_author_1001551623938805763_1_480x360.mp4`. The toolbar icon opens the task list, where you can see the actual quality, any limitation or downgrade reason, and cancel or retry tasks.

## Language

`public/_locales/en` and `public/_locales/zh_CN` are the only source of every string users see: the menu, the quality strip, the task popup, statuses and errors all render from them, and the manifest name and description reference the same keys with `__MSG_`. Adding a language means copying one `messages.json` and registering it in `src/i18n.ts` — no product code changes.

Parameterised messages must declare `placeholders`: without them `chrome.i18n.getMessage` returns mangled text (measured: `$LABEL` read back as `ABEL`), which corrupts the manifest name and description. So `pnpm exec node scripts/check-package.mjs` unpacks the build and verifies that both catalogues agree on keys, arguments and placeholders, and `tests/i18n.test.ts` repeats the same checks at unit level. Runtime code never calls `getMessage`; both languages render from the same bundled catalogue.

## Behaviour and limits

- Supports videos hosted by X and animated images stored as video files. Multi-video posts download each item separately; quote and repost media are attributed by media ID, preview URL and post link, and nothing is guessed when that fails.
- Reads the GraphQL/SSR data the page already has first. When a video approaches the viewport it reads a bounded amount of media data to determine the best quality and audio; if that is not enough it serially reads the post detail and X's own public embed endpoint, without retrying failures endlessly. Fallback sources may lack media, and using them is stated in the UI.
- Automatic inspection never creates a download. Two bounded probe queues prioritise the videos currently visible, and scrolling away cancels checks that no download is using. At most four network requests per media item run concurrently; 32 KiB Range reads fetch only the headers and sample tables they need instead of whole video payloads.
- Every candidate is still inspected, keeping the measurement range of 96 audio packets and 64 video frames; partial results read "known… · checking", and the best available result only appears once inspection is complete.
- Within a browser session it reuses display summaries for fifteen minutes and download candidates for two minutes; service worker sleep and closing the offscreen document do not clear them. A changed signed URL invalidates the cache, the cache never survives a browser session, and no authentication data is stored.
- Audio compares every available track independently, ordered by bitrate, sample rate and channel count, and extracts losslessly to M4A from HLS or MP4 — never re-encoded to lossy MP3. `≈` marks a bitrate estimated from sampled codec packets, in `kb/s`, `kHz` and `ch`. It is not a subjective rating of how something sounds.
- Resolution is ordered by real pixel dimensions, frame rate and bitrate at the same codec, preferring directly linked MP4 within a tier. The player's current rendition, the preview image size and `original_info` do not by themselves describe what you can download.
- At most two active download tasks at a time, and at most one of them merging media or extracting audio; up to 20 tasks may queue. Video and audio downloads of the same media are de-duplicated separately. Failed candidates fall back automatically; cancellation, disk problems, rate limiting or an invalid address stop the task.
- HLS is remuxed losslessly, without re-encoding and without silently dropping its paired audio track. OPFS scratch files bound memory use, and they are deleted once Chrome finishes saving. Insufficient space is reported as an error.
- Closing or navigating away from the X source page does not cancel a started task. When the background service worker sleeps or restarts it reconciles with the offscreen task and the Chrome download history. A merge interrupted by quitting the browser has to be retried; resuming from an arbitrary segment is not promised.
- Not supported: live stream recording, Spaces, other video sites, encrypted HLS/DRM. It also does not bypass login, protected accounts, region restrictions or platform challenges. It can only handle media that is already obtained, or normally obtainable, under your current access conditions.
- "Highest" means the best version X offers and you can currently obtain, not necessarily the uploaded master. If candidate parsing fails or information comes from a source that may be incomplete, the task records that limitation; if the best candidate fails to download, the task records the downgrade.
- The site can change its DOM, APIs and data structures. When something fails, reload X or open the post directly first; if X itself reports a login requirement, a 403 or rate limiting, fix the page access problem first.

## Privacy and permissions

| Permission                              | Purpose                                             |
| --------------------------------------- | --------------------------------------------------- |
| `downloads`                             | Start, cancel and track downloads the extension made |
| `storage`                               | Local task state, keeping at most 60 finished rows  |
| `offscreen`                             | Worker media processing and keeping Blob URLs alive until the download completes |
| `https://x.com/*`                       | The page button and collecting media data from it   |
| `https://video.twimg.com/*`             | Reading media manifests and audio/video data        |
| `https://cdn.syndication.twimg.com/*`   | Public embed metadata fallback for visible videos   |

No cookie, debugger or all-sites permissions; no stored account tokens or request authorization headers; no telemetry. Media requests do not carry X session authentication headers. Task records may contain the post ID, author, media URL and file name, and live only in this browser profile; clearing tasks removes the extension's records and deletes neither the downloaded files nor Chrome's download history.

All runtime code ships inside the extension: no remote scripts, no `eval`, no remote module loading, no native messaging. Page messages carry media records only and cannot trigger a download by themselves.

## Distribution and ecosystem

One deterministic package serves every channel: `pnpm package` produces `release/x-video-downloader-<version>.zip` (manifest at the archive root, sorted entries, fixed timestamps) and `release/SHA256SUMS.txt`, and `docs/site` is published as the project site and privacy policy by `.github/workflows/pages.yml`.

- Chrome Web Store / Microsoft Edge Add-ons: the one-time human registration and submission steps, rejection-risk analysis and the Single Purpose wording are in [docs/stores.md](docs/stores.md).
- GitHub Release and store upload: `node scripts/store-publish.mjs --help`. Credentials are read from environment variables only, and a missing credential falls back to `--dry-run` with no network access at all. `.github/workflows/release.yml` reruns exactly the CI gates after a tag is pushed.
- Privacy claims are machine-checked against the manifest by `tests/privacy-claims.test.ts`: the origins in the policy must equal `host_permissions` exactly, the two language versions must agree, and the permission table on the product pages must match the manifest in both directions. `tests/site.test.ts` additionally checks share-image URLs, the version printed on each page, `hreflang` reciprocity, `sitemap.xml` and the store image sizes.
- The order and wording for site inclusion, directory submissions and community posts is in [docs/distribution.md](docs/distribution.md).
- Contributing and security: [CONTRIBUTING.md](CONTRIBUTING.md) turns the project's hard constraints into the gates an outside contributor can run, and [SECURITY.md](SECURITY.md) states what the extension can and cannot reach plus how to report privately. `tests/community.test.ts` validates the three issue forms and this front page — links, version and store status.
- Store and site imagery (1280×800 screenshots, the required 440×280 promo tiles, 1400×560 marquee images, in both languages) is rendered into `docs/site/assets/` by `pnpm assets` from the packaged `dist` against a local test fixture, and the script validates pixel sizes against the official spec. The screenshots show a test fixture rather than a real timeline, which the site captions say too.

Before any store listing exists there are two ways to obtain it: clone the repository and load `dist`, or unzip the package in `release`. Both are byte-identical to the store package, so automatic updates after approval will not change local behaviour.

## Development and validation

Requires Node.js 22+ and pnpm. Dependency versions are pinned by `pnpm-lock.yaml`.

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:layout
pnpm test:performance
pnpm test:source
pnpm test:live
pnpm test:live-hls
pnpm package
pnpm assets
```

`test:e2e` needs FFmpeg/ffprobe on the development machine to generate short media samples, then runs integration tests against a real MV3 extension, offscreen worker, OPFS and the Chrome download manager. Media is served by an isolated local HTTPS test server; the host-resolver mapping and test certificate options apply only to the test browser and are never written into the release build or system settings.

`test:live` opens a public X video post, confirms the automatic quality strip, then downloads the actual CDN video through the menu, inspects the file and writes `output/playwright/live-video-report.json`. Set `XVD_MODE=audio` to verify a full audio download, which writes `live-audio-report.json`. It uses its own test configuration and never reads your Chrome profile. Network, login or X-side limits can make this test fail, and such a failure may not be substituted by local-sample tests.

`test:live` uses a normal visible Chrome window by default, since headless may be rejected by X. `test:source` verifies the SSR decoding of the current public page; `test:live-hls` uses that record to run an independent remux check against the real CDN HLS stream. To reuse an existing Chrome for Testing install, set `XVD_CHROME` to its executable path.

See the [research notes](docs/research.md), [architecture and recovery contract](docs/architecture.md) and [validation record](docs/validation.md).

The stage-by-stage 1.2.0 performance review, reproducible benchmarks and access boundaries are in the [performance report](docs/performance.md). Repository CI runs type checking, unit tests, real MV3 browser behaviour and layout verification, the build and the package gate on every push and pull request.

## Third-party code

Original code in this project is [MIT licensed](LICENSE); third-party libraries keep their own licences.

Acorn is used for read-only syntax tree parsing, Lucide for icons and Mediabunny for media parsing and lossless remuxing. Versions and licences are stored in `dist/THIRD_PARTY_NOTICES.txt` alongside the build. Mediabunny is MPL-2.0; this project does not modify its sources, and the corresponding code is available from npm at the locked version or from the upstream repository.
