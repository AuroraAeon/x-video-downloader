# Store submission runbook — Chrome Web Store and Microsoft Edge Add-ons

X Video Downloader ships as one deterministic archive that every channel reuses:
`pnpm package` writes `release/x-video-downloader-<version>.zip` (manifest at the
ZIP root, sorted entries, fixed timestamps) plus `release/SHA256SUMS.txt`, and
`pnpm exec node scripts/check-package.mjs` is the gate that proves the archive is
the audited build. Do not hand-assemble a store package.

Automation: `scripts/store-publish.mjs` (GitHub Release, Chrome Web Store upload /
publish / item lookup, Edge hand-off text) and `.github/workflows/release.yml`
(gates → GitHub Release → optional store upload). **A human always clicks the
final submit.** `--dry-run` is the default whenever credentials are missing and
performs no network I/O.

## 1. Fees and accounts (verified 2026-09-24)

| Channel | Cost | Verified where |
| --- | --- | --- |
| Chrome Web Store | One-time developer registration fee, US$5 at checkout. Google's page now only says "you must register as a CWS developer and pay a one-time registration fee" — the amount is shown on the payment screen. | [Register your developer account](https://developer.chrome.com/docs/webstore/register); amount corroborated by [Chrome Web Store Developer Registration Fee 2026](https://www.extensionradar.com/blog/chrome-web-store-developer-fee-2026) and [Can I avoid paying registration fee?](https://support.google.com/chrome/thread/166445238/can-i-avoid-paying-registration-fee?hl=en) |
| Microsoft Edge Add-ons | Free: "There is no registration fee for submitting extensions to the Microsoft Edge program." | [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) |

Also needed for both: the privacy policy page
`https://auroraeon.github.io/x-video-downloader/privacy.html` (must stay
reachable — it is a required dashboard field), a Google account in good standing
with 2FA, and a GitHub Pages site as the developer website. Chrome caps a
developer account at 20 published extensions
([publish guide](https://developer.chrome.com/docs/webstore/publish)).

Before typing either URL into a dashboard, confirm it actually serves today
rather than trusting the repository state: `curl -s -o /dev/null -w
'%{http_code}\n' https://auroraeon.github.io/x-video-downloader/privacy.html`
must print 200. `docs/distribution.md` section 0 records the measured status of
the site, and a deployment that CI reports as successful is not the same thing
as a URL a reviewer can open.

## 2. Google OAuth for the Publishing API (one-time, ~20 minutes)

Google documents the flow at
[Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
and [Chrome Web Store API (V1) Reference](https://developer.chrome.com/docs/webstore/api/v1).

1. Google Cloud Console → create a project (reuse the Pages project if you
   have one) → **Google Auth Platform → get started → External** users. Add your
   own address under **Test users**, then **publish** the app to production before
   the release cadence starts: while the consent screen stays in **Testing**,
   Google invalidates refresh tokens after 7 days
   ([Google Cloud dev thread](https://groups.google.com/g/google-cloud-dev/c/lBXsDXRwtTQ),
   [write-up of the same trap](https://tech.queenofsandiego.com/posts/2026-05-06-1924.html)).
2. **Credentials → Create credentials → OAuth client ID**, "For **Application
   type**, choose **Web application**", and register
   `https://developers.google.com/oauthplayground` as the Authorized redirect URI
   (Google's own instruction).
3. Mint a refresh token in [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   gear icon → use your own client ID/secret, **offline access** and **force
   consent** on, then authorize with the scope
   `https://www.googleapis.com/auth/chromewebstore.publish`. Google's reference
   pages list `https://www.googleapis.com/auth/chromewebstore` (full) and
   `.../chromewebstore.readonly`; pick whichever publish-capable variant the
   picker offers and keep it — **the scope is fixed when the refresh token is
   minted, not by our script**, so a readonly token fails at publish time.
   Copy the refresh token from "Exchange authorization code for tokens".
4. Headless/Linux box (no browser): do step 3 once on any machine you already
   trust, or build the authorize URL yourself, open it on your phone, and paste
   the returned `code` back into the terminal:

   ```sh
   # one-time, on the headless machine, after you have the code
   curl -s https://oauth2.googleapis.com/token \
     -d grant_type=authorization_code \
     -d code="$CODE" \
     -d client_id="$XVD_WS_CLIENT_ID" \
     --data-urlencode client_secret="$XVD_WS_CLIENT_SECRET" \
     -d redirect_uri=https://developers.google.com/oauthplayground
   ```

   The `redirect_uri` must match the registered one exactly. Use
   `--data-urlencode` for anything secret so it survives escaping, keep the values
   in shell variables rather than literals, and never put a secret in a URL query
   string.
5. Store these values as **GitHub environment secrets** on `chrome-webstore`:
   `XVD_WS_CLIENT_ID`, `XVD_WS_CLIENT_SECRET`, `XVD_WS_REFRESH_TOKEN`,
   `XVD_WS_ITEM_ID`, plus optional `XVD_WS_TARGET` (`trustedTesters` | `default`).
   Locally, export the same names. Nothing is ever a command-line argument.
6. Item ID: after you press "Add new item" the dashboard URL contains it
   (`.../devconsole/.../item/<32-char-id>`), or run
   `node scripts/store-publish.mjs webstore-list`.

## 3. Chrome Web Store listing (one-time, manual)

Dashboard: <https://chrome.google.com/webstore/devconsole>.

1. **Add new item** → item type **Extension** → **Upload package** →
   `release/x-video-downloader-<version>.zip`.
2. **App details**: name `X Video Downloader`, short summary from the manifest
   `description`, full description, category **Tools**, language English, 1–5
   screenshots at 1280×800 (or 640×400), the 440×280 small promo tile (Google's
   image spec marks it required, not optional), the 1400×560 marquee image, and
   a store summary capped at 132 characters. `node scripts/store-assets.mjs`
   writes all of them into `docs/site/assets/` from the packaged build:
   `shot-en.png`, `shot-en-menu.png`, `shot-zh.png`, `shot-zh-menu.png` at
   1280×800, `tile-{en,zh}.png` at 440×280 and `marquee-{en,zh}.png` at
   1400×560. They render a local test fixture (colour-bar clip, `@fixture`
   account) rather than a logged-in timeline, which keeps personal data out of
   store imagery; say so in the listing if a reviewer asks. No third-party
   watermarks. The icon set ships at 16/32/48/128 — our own mark only, never X's
   logo or the Twitter bird.
   The package is localized (`default_locale: "en"`, `_locales/en` +
   `_locales/zh_CN`), so the default-locale listing text comes from
   `_locales/<locale>/messages.json` (`__MSG_extensionName__`,
   `__MSG_extensionDescription__`): en is 18 and 102 characters, comfortably
   inside the limits. Add a zh-CN store listing row in the dashboard for the
   Chinese copy; do not paste Chinese text into the manifest-backed English row.
3. **Privacy**: state the single purpose in one sentence; declare data handling
   truthfully — the extension reads page content and media URLs on `x.com`,
   stores a task history locally, and **transmits nothing to us**; no analytics,
   no servers, no remote code. Enter the privacy policy URL from §1. Tick the
   Limited Use attestation only if it stays true
   ([Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)).
4. **Distribution**: Free, all regions, visibility **Public** (listed). Use
   **Unlisted** only if you want a link-only rollout; unlisted items are still
   reviewed. Consider "delayed publishing": after approval you get up to 30 days
   to press publish, otherwise the build "will revert to a draft and will need to
   be resubmitted for review" ([publish guide](https://developer.chrome.com/docs/webstore/publish)).
5. **Send item for review**. Google publishes no review SLA; plan on days, not
   hours, and longer for a first extension in a scrutinised category.

Listing copy: the default-locale strings come from
`_locales/en/messages.json`; keep the current wording ("Download the best
available X video or audio, with inline quality details and lossless HLS
processing") and add the disclaimer line from §5.3. For Chinese store copy reuse
the shipped UI wording, but keep its qualifier intact: the zh description says
"下载 X 上可取得的最高画质视频或最高音质音频" — **可取得的** (available) must stay,
because the product labels a partial probe result as "检测中"/best-available
rather than a confirmed maximum, and an unqualified "最高画质" promise is both a
policy risk and an AGENTS.md violation. Other reusable strings from `INSTALL.txt`:
"首次安装", "加载已解压的扩展程序", "最高画质视频（MP4）或最高音质音频（M4A）".
Store copy should say "在 X 视频下方点击按钮，保存当前页面已经可以播放的那条视频或音频"
— i.e. describe access to content the user is already shown, never bulk capture.

## 4. Repeatable release day

1. Bump `package.json` **and** `public/manifest.json` to the same version
   (`check-package.mjs` fails otherwise), update `README.md`, `CHANGELOG.md` and
   `release/notes-<version>.md`.
2. `git tag v<version> && git push origin v<version>` → `release.yml` runs:
   `verify` (same gates as CI: typecheck, unit tests, build, Playwright e2e,
   layout, `pnpm package`, `check-package`) → `github-release` (uploads the ZIP
   and `SHA256SUMS.txt` to the GitHub Release, body from the notes file, and
   writes the Edge hand-off text into the job summary) → `chrome-webstore`
   (skips to dry-run when the secrets are absent; uploads when they are set).
   `release/` is gitignored, so CI cannot see your local notes file and rebuilds
   the release body from this version's `CHANGELOG.md` section; the script's
   checksum/version cross-checks still run either way.
3. New version, first submission, or any listing/permission change: the store
   build goes to review. `XVD_WS_TARGET=trustedTesters` for a tester rollout,
   `default` for public. Concurrency is pinned per ref and per store, so two tags
   cannot race.
4. Local one-off, no CI:

   ```sh
   pnpm package && pnpm exec node scripts/check-package.mjs
   node scripts/store-publish.mjs release --dry-run      # inspect the plan
   GITHUB_REPOSITORY=… GITHUB_TOKEN=… node scripts/store-publish.mjs release
   XVD_WS_ITEM_ID=… node scripts/store-publish.mjs webstore-upload
   XVD_WS_TARGET=trustedTesters node scripts/store-publish.mjs webstore-publish
   ```

## 5. Rejection-risk analysis (researched, not guessed)

Sources: [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies),
[Troubleshooting Chrome Web Store violations](https://developer.chrome.com/docs/webstore/troubleshooting),
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
[Manifest V2 support timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline),
[Manifest file format](https://developer.chrome.com/docs/extensions/reference/manifest).

| # | Policy hook | Real risk | Verdict |
| --- | --- | --- | --- |
| 1 | "Do not encourage, facilitate, or enable the unauthorized access, download, or streaming of copyrighted content or media." | Site-specific video saver for X | **Highest.** Mitigate as in §5.1 |
| 2 | Spam and repurposing; single narrow purpose; "Don't submit multiple extensions with duplicate experiences or functionality." | `X Video Downloader` is a heavily cloned keyword name | **High**, §5.2 |
| 3 | Impersonation & IP: "Do not pretend to be another entity"; no infringement of "patent, trademark, trade secret, copyright" | "X" (and historically "Twitter") are X Corp marks | **Medium**, §5.3 |
| 4 | Must not "require a local executable, other than the Chrome runtime, to run"; no remote code; no backend requirement | Package is pure MV3 JS with CSP `script-src 'self'`; `check-package.mjs` already fails the build on `eval`, `new Function`, `importScripts`, `chrome.scripting` | Low — but see §5.4 for the "reviewer saw nothing" failure mode |
| 5 | Manifest V3 is mandatory: "Chrome Web Store stopped accepting new Manifest V2 extensions with visibility set to Public or Unlisted", and "With Chrome 138 all users on all channels of Chrome have now Manifest V2 extensions disabled" (24 Jul 2025) | We ship MV3 | None |
| 6 | `minimum_chrome_version` (we pin `"116"`, asserted by the package gate) | Only gates installs on ancient browsers; not a rejection reason by itself | None. Bump the floor when a used API requires it |
| 7 | Privacy policy + accurate data disclosures, single purpose declaration | A disclosure that undersells or oversells what the code handles | Low, if §3.3 is filled honestly |

### 5.1 Copyright facilitation — the risk that can actually kill the listing

Google's troubleshooting guide uses a downloader as its own worked example: text
saying the extension lets you "easily download YouTube videos", or that it
"encourages downloading content that infringes intellectual property", is exactly
what gets cited, and the policy sentence behind it is "Do not encourage,
facilitate, or enable the unauthorized access, download, or streaming of
copyrighted content or media." General-purpose media sniffers such as
[Video Download Helper](https://chromewebstore.google.com/detail/video-download-helper/lmjnegcaeklhafolokijcfjliaokphfk)
are still listed, which suggests (inference, not a published rule) that the line
is drawn at named-platform piracy and circumvention rather than at saving a file.
Our position is defensible: the extension only saves media that the current page
is already playing for the signed-in user, from `video.twimg.com` and
`cdn.syndication.twimg.com`, with no DRM or paywall circumvention, no bulk or
account-wide capture, no playlist export, no watermark removal, no private or
age-restricted content, and no server component.

Do these before submitting:

- Never mention YouTube (or any other site) in code comments, README, listing
  text, screenshots or search terms. The word has become a review trigger.
- Put a rights line in the short description *and* the privacy/single-purpose
  field: "Saves only the video or audio that the X post you are viewing already
  plays in your browser. You are responsible for the rights to any content you
  save."
- Keep the permission-to-purpose match obvious: three host permissions, all
  X-related, plus `downloads`, `storage`, `offscreen`.
- Expect that X's own Terms of Service are not Google's policy, but a reviewer
  may still read "downloader for X" as piracy-by-default. The mitigation is the
  framing above plus a working demo the reviewer can run without an account.

### 5.2 If a reviewer marks it spam or repurposing

That label usually means "generic name + boilerplate listing that looks like the
dozens of copies already in the store". Reply from the item page (use the Appeal
button, per the troubleshooting guide) with facts, not argument:

> Item `<id>` / version `x.y.z`. This is the original source of the tool at
> <https://github.com/AuroraAeon/x-video-downloader> (public repository, commit
> history since 1.0.0, MIT licence). It is not a rebranded copy: the codebase is
> single-purpose and does one thing no listed alternative does — it inspects
> every candidate stream the post exposes and labels the choice honestly,
> including lossless HLS audio separation. Only one item is published under this
> developer account (see §1's 20-item limit); no other listing duplicates this
> functionality. Screenshots are taken from this build. Repurposing does not
> apply: no functionality was copied from another extension and the extension
> collects no user data (§3.3). Happy to answer any specific question or remove
> any phrase you read as keyword stuffing.

Pre-empt it: unique screenshots, a description that describes our actual probe
behaviour, no "best #1 top free" superlatives (the policy calls misrepresenting
"Editor's Choice" or "Number One" deceptive), and no second item with overlapping
features. Google's listing guide also warns that stuffing extra keywords into the
description annoys users and can lead to account suspension
([Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)).

### 5.3 Trademark: would "Twitter video downloader" fare better?

No — worse. `Twitter` is an active, aggressively defended mark: in September 2026
a US court blocked a rival startup from using the "Twitter" name
([Reuters](https://www.reuters.com/legal/litigation/x-corp-blocks-social-media-startup-using-twitter-name-2026-09-03/),
[Ars Technica](https://arstechnica.com/tech-policy/2026/09/musk-wins-court-order-to-block-use-of-twitter-but-not-tweet-and-bird-logo/)),
X Corp. also updated its Terms to reassert the claim. On top of the legal
exposure, "Twitter" matches automated brand screening better than the single
letter `X`, it is the exact keyword of the spam cluster this listing already sits
in, and after the 2023 rebrand it contradicts the `x.com` host permissions, which
reads as keyword stuffing. Keep `X Video Downloader`, and add the affiliation
disclaimer to the long description:

> Not affiliated with, endorsed by, or sponsored by X Corp. or Twitter, Inc.
> "X" is a trademark of X Corp. Used descriptively to indicate the site this
> extension operates on.

Do not use the bird logo, the X logo, or "official" anywhere in the icon, tile,
screenshots or promo text. If the first review still cites IP, rename to a
coined brand with a descriptive suffix (`<Brand> — media saver for X`) rather
than trading "X" for "Twitter".

### 5.4 The failure mode nobody predicts

Reviewers install on a clean profile with no X login. If the visible posts need
a login, they see no downloadable media and reject it as "does not work" or
"misleading". Defend against it: put repro steps and at least two logged-out
playable public post URLs in the reviewer notes, add a screenshot of the button
state, and make sure the popup explains the login requirement in-product. This is
a known failure class for site-specific tools rather than a documented CWS policy
category — but "must work as described" is enforced, so assume the reviewer never
signs in.

## 6. Microsoft Edge Add-ons (manual, same ZIP)

Steps and quotes verified in
[Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
Run `node scripts/store-publish.mjs edge-package` for the same list with the
current file name, size and SHA-256 pre-filled.

1. Partner Center <https://partner.microsoft.com/dashboard/microsoftedge/public/login>
   → Edge program → individual account, publisher display name must be available
   and rights-cleared (≤50 chars).
2. **Create new extension** → drag the identical `release/x-video-downloader-<version>.zip`
   onto "Drag your package here (.zip)". No repackaging: Edge is Chromium and
   accepts the MV3 package as-is. Manifest `name`/`description` become read-only
   listing fields, so they must match the store copy.
3. **Availability** (Public, markets) → **Properties** (category, website,
   support contact) → **Privacy**: *Single Purpose*, a written justification for
   every declared permission, *"No, I am not using remote code"* (MV3 forbids
   remote code), *Data usage* disclosures, and the same privacy policy URL.
   Microsoft warns that inaccurate disclosures "may be considered a violation"
   and can delay certification.
4. **Store listings**: because the package ships `default_locale: "en"` with
   `_locales/en` and `_locales/zh_CN`, both language rows should appear (Microsoft
   detects languages from those i18n message files). For each row: description
   250–10,000 characters, 300×300 logo (≥128×128), up to six 1280×800
   screenshots, ≤21 search-term words.
5. **Notes for certification**: the reviewer-facing text from §5.1 and §5.4, plus
   the archive SHA-256. Then **Publish** — a human click.
   "The certification process can take up to seven business days after you submit
   the extension."

## 7. First-release checklist (stops at submit)

- [ ] `package.json` and `public/manifest.json` versions equal; `pnpm typecheck`,
      `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:layout` green.
- [ ] `pnpm package` + `pnpm exec node scripts/check-package.mjs` green; SHA-256
      recorded in `release/notes-<version>.md` and `docs/validation.md`.
- [ ] Privacy policy page live and describing only what §3.3 declares.
- [ ] `pnpm test` green — `tests/privacy-claims.test.ts` is what proves the policy
      and the permission table match `manifest.json` (same origins, same
      permissions, both languages). Paste the store data-disclosure answers from
      that same table, and if you change a permission, expect the test to fail
      until the site says so too.
- [ ] `pnpm assets` re-run after any UI copy or layout change; the eight files in
      `docs/site/assets/` measured at 1280×800, 440×280 and 1400×560.
- [ ] Screenshots, icon, promo tiles contain no X/Twitter logo and no other
      party's branding.
- [ ] Reviewer notes drafted, including two logged-out playable posts.
- [ ] CWS: paid once, item created, package uploaded, listing/privacy complete →
      **submit** (human).
- [ ] `chrome-webstore` environment secrets set; `XVD_WS_TARGET` left empty for
      the first run so automation uploads but never publishes.
- [ ] Edge: Partner Center account verified, package re-uploaded unchanged,
      privacy page complete → **publish** (human).
- [ ] GitHub: tag `v<version>` pushed only after the store listing exists, so the
      public archive and the store version never diverge.

## 8. Rollback and republish

- Chrome Web Store v1 has no "revert to previous version" call: to roll back you
  upload the older `release/x-video-downloader-<old>.zip` as a new build (it
  re-enters review) or set visibility to **Unlisted** to stop new installs while
  you fix it. Users already on the bad build keep it until the next accepted
  upload. `webstore-publish` with `XVD_WS_TARGET=trustedTesters` is the safe way
  to validate a candidate build first. The documented v2 surface also offers
  `:cancelSubmission` and percentage rollout if we ever need it
  ([Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)).
- A rejected build is not deleted: fix the flagged field, re-upload, resubmit.
  `webstore-publish` polls `projection=published`/`projection=private` and exits
  non-zero on `REJECTED`/`NEEDS_ATTENTION`/`ITEM_TAKEN_DOWN`, and exits 0 with a
  "still in review" note if the poll budget runs out (`XVD_WS_MAX_POLLS`,
  `XVD_WS_POLL_INTERVAL_SECONDS`, `XVD_WS_REQUIRE_ACCEPTED=1` to make it strict).
- GitHub: `node scripts/store-publish.mjs release` re-runs idempotently — it
  updates the existing release and replaces the two assets by name.
- Edge: upload the previous ZIP as a new package, or set visibility to **Hidden**
  (existing users keep the extension and still receive updates).

## 9. Discovery beyond the two stores

| Channel | Accepts our MV3 package unchanged? | Status |
| --- | --- | --- |
| Chrome Web Store | yes | primary |
| Edge Add-ons | yes, same ZIP | verified (§6) |
| NAVER Whale | own store with a developer registration and package upload; Whale is Chromium-based and "can install most Chrome extensions" | store flow verified at [Whale Store help](https://help.whale.naver.com/en/desktop/store/); MV3 acceptance **unverified** — check before budgeting time |
| Opera | [Opera's manifest doc](https://help.opera.com/en/extensions/manifest/) still documents `manifest_version: 2` | **unverified** for MV3 submissions; treat as low priority |
| Vivaldi, Brave | no submission exists: "extensions available in the Chrome Web Store can also be installed in Vivaldi" ([Vivaldi help](https://help.vivaldi.com/desktop/appearance-customization/extensions/)), and Brave documents using Chrome extensions ([Brave learn page](https://brave.com/learn/using-chrome-extensions-in-brave/)) | covered by the CWS listing |
| Chrome-Stats | n/a (read-only directory) | [chrome-stats.com](https://chrome-stats.com/) verified as a live site that publishes per-extension install/ranking analytics for CWS listings; whether a brand-new item appears without any crawl delay was **not** verified |

Other directories that mirror CWS listings (extensionoutlook-style aggregators,
paid "review" sites, Telegram/X repost channels) were not verified here; do not
buy placement. Purchased installs and cross-promotion are exactly the "attempt to
manipulate the placement of any extensions" behaviour the spam policy bans, and
keyword-stuffed directory copy is what triggers the repurposing review in §5.2.

## 10. Source list

- [Register your developer account](https://developer.chrome.com/docs/webstore/register) ·
  [Publish](https://developer.chrome.com/docs/webstore/publish) ·
  [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing) ·
  [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) ·
  [Troubleshooting violations](https://developer.chrome.com/docs/webstore/troubleshooting) ·
  [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) ·
  [Chrome Web Store API (V1) Reference](https://developer.chrome.com/docs/webstore/api/v1) ·
  [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) ·
  [Manifest V2 support timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline) ·
  [Manifest file format](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) ·
  [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- Fee corroboration: [Chrome Web Store Developer Registration Fee 2026](https://www.extensionradar.com/blog/chrome-web-store-developer-fee-2026) ·
  [Can I avoid paying registration fee?](https://support.google.com/chrome/thread/166445238/can-i-avoid-paying-registration-fee?hl=en) ·
  OAuth refresh-token lifetime in Testing mode: [Google Cloud dev thread](https://groups.google.com/g/google-cloud-dev/c/lBXsDXRwtTQ),
  [Moving from Google Cloud Testing Mode to Production](https://tech.queenofsandiego.com/posts/2026-05-06-1924.html)
