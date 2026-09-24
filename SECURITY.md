# Security policy

## What this code can and cannot reach

Read the [privacy policy](https://auroraeon.github.io/x-video-downloader/privacy.html)
first — most "could it read my account?" questions are answered there, with the
source to check against.

Short version: the extension has no backend, no telemetry, no remote code and no
`eval`. It requests three host patterns (`x.com`, `video.twimg.com`,
`cdn.syndication.twimg.com`) and three API permissions (`downloads`, `storage`,
`offscreen`); `tests/privacy-claims.test.ts` fails the build if the published
site ever claims something different from `public/manifest.json`. Media requests
carry no X session authentication headers, and the content security policy blocks
connections to any other host.

## Reporting a vulnerability

Use **Report a vulnerability** on the repository's Security tab (private
vulnerability reporting) if the owner has enabled it. Otherwise open a private
fork or an ordinary issue containing only the fact that a security problem
exists, so a report never lands in public before it is fixed.

Tell us which version you tested. `release/SHA256SUMS.txt` in each release has the
SHA-256 of the ZIP; if the archive you loaded does not match it, say so — that is a
different and more serious problem.

This is an unpaid independent project. There is no response-time commitment and no
bounty programme; fixing a real exposure comes first, and credit in the release
notes comes with your agreement.

## Out of scope

- Abuse of content a user is allowed to download, and any question about whether
  a download is permitted by X's terms or by law.
- Requests to bypass rate limits, log in for the user, or capture posts the user
  cannot already open.
- Physical access to the browser, a compromised Chrome profile, or a malicious
  extension running next to this one.
- Findings that need the user to paste cookies, tokens or authorization headers
  into a chat, tool or issue. Never send those; they are credentials, not evidence.
