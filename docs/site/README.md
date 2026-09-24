# Public site (`docs/site/`)

Static landing page + privacy policy for the Chrome Web Store and Microsoft
Edge Add-ons listings. Both stores require a **publicly hosted privacy policy
URL**, and the store listing form also wants a landing/home page. This folder is
that site.

- Plain HTML plus one stylesheet. No build step, no npm dependency, no remote
  font, script or CDN. The pages also render correctly when opened directly from
  the file system (`file://`).
- Published by `.github/workflows/pages.yml` to GitHub Pages from this folder.
- Every page carries the footer disclosure: independent project, **not
  affiliated with, endorsed by, or sponsored by X Corp.**, "X" and the X logo
  are trademarks of X Corp. used in plain text only to describe compatibility,
  and users are responsible for what they download. No X or Twitter mark, logo
  or bird imagery appears anywhere on the site.

## Files

| File               | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `index.html`       | Landing page (English)                                 |
| `zh.html`          | Landing page (简体中文)                                |
| `privacy.html`     | Privacy policy (English)                               |
| `privacy-zh.html`  | 隐私政策（简体中文）                                   |
| `styles.css`       | The only stylesheet, shared by all four pages          |
| `.nojekyll`        | Stops Jekyll processing on GitHub Pages                |
| `robots.txt`       | Allows crawling and declares the sitemap               |
| `sitemap.xml`      | The four pages, with the bilingual alternates inline   |
| `assets/`          | Store and site imagery: 4 screenshots at 1280×800 (`shot-en.png`, `shot-en-menu.png`, `shot-zh.png`, `shot-zh-menu.png`), 440×280 small promo tiles (`tile-en.png`, `tile-zh.png`) and 1400×560 marquee images (`marquee-en.png`, `marquee-zh.png`) |

The landing pages carry Open Graph and Twitter card tags plus `SoftwareApplication`
JSON-LD. `tests/site.test.ts` and `tests/privacy-claims.test.ts` (both run by
`pnpm test`, so also by CI) are the gate for this folder: internal links and
every absolute share-URL must map onto a file here, each labelled version string
must equal `package.json`, the `hreflang` groups must stay absolute and
reciprocal, `sitemap.xml` must keep both XML namespaces and list only pages that
exist, the imagery must stay at the pixel sizes the stores require, and the
origins, permission table and bilingual policy must match `manifest.json` in
both directions. Do not relax a check to make a page pass — fix the page, or
change the manifest and every claim with it.

The images in `assets/` are generated, not hand-made: `pnpm assets`
(`node scripts/store-assets.mjs`) renders them with the packaged `dist` build
against a local test fixture and overwrites the files. Regenerate them whenever
the UI copy or layout changes, and keep them committed so the store ZIP and the
site ship the same artwork. They show the `@fixture` account and a colour-bar
clip, never a logged-in timeline.

Language switches link each page to its counterpart (`index.html` ↔
`zh.html`, `privacy.html` ↔ `privacy-zh.html`).

## URLs to paste into the store forms

Once GitHub Pages is enabled for the repository, the exact values are:

- **Chrome Web Store → "Privacy policy URL":**
  `https://auroraeon.github.io/x-video-downloader/privacy.html`
- **Microsoft Edge Add-ons → "Privacy policy URL":**
  `https://auroraeon.github.io/x-video-downloader/privacy.html`

Chinese counterparts (link these from the store description, not from the
privacy-policy field, which takes one URL):

- 简体中文隐私政策：`https://auroraeon.github.io/x-video-downloader/privacy-zh.html`
- 简体中文产品介绍页：`https://auroraeon.github.io/x-video-downloader/zh.html`

Website / landing field on both stores:
`https://auroraeon.github.io/x-video-downloader/`

## Order of operations

1. Merge this folder and the workflow.
2. Enable GitHub Pages for the repository (Settings → Pages → Source: GitHub
   Actions). The `pages.yml` workflow uploads `docs/site` as the Pages artifact
   and deploys it.
3. Open both privacy URLs in a browser and confirm they return HTTP 200 and
   render.
4. **Only then** fill in the store forms. The listing must not go live before
   Pages is enabled — a reviewer who cannot reach the privacy policy URL will
   reject the submission, and a store item already published with a dead policy
   link is a removal risk.
5. Until each store assigns its real URL, the install buttons on the site point
   at `https://chromewebstore.google.com/detail/x-video-downloader/pending` and
   at `https://microsoftedge.microsoft.com/addons`, and both cards say plainly
   that the listing URL is assigned after approval. Replace `pending` with the
   real slug (and the Edge link with the real item URL) when the listings
   exist, and keep the visible "placeholder" notes only as long as they are
   true.

## Content rules for this folder

- Facts here must match `README.md`, `CHANGELOG.md`, `docs/validation.md` and
  `public/manifest.json`. Do not add capability, speed or user-count claims
  that the repository does not already document, and do not soften the
  "not supported" boundary list.
- Version and effective date are stated as 1.3.0 / 2026-09-24. Update them, and
  the privacy wording, together with each release that changes behaviour.
- Task-record facts (fields stored, 60-finished-entry cap, clearing tasks does
  not delete downloaded files) come from `src/background.ts` and the popup
  clear action; re-check them if that logic changes.
- Keep the site dependency-free. Anything that needs a bundler belongs
  elsewhere.

## Checking a change locally

No tooling is required: open `docs/site/index.html` in a browser. Internal links
are all relative, so the language switch, the privacy pages and the stylesheet
work without a server. To mimic the deployed layout, serve the repository root
(for example `python -m http.server`) and open
`http://127.0.0.1:8000/docs/site/`.
