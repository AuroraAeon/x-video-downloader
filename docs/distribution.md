# 分发与生态计划

目标：让同一个构建在尽可能多的入口被发现，同时不牺牲 `docs/stores.md` 里的政策边界。本文件只覆盖"扩展之外"的部分——商店之外的收录、社区发布和持续获取反馈；商店提交步骤见 `docs/stores.md`。

影响力来自三件事的乘积：可安装（渠道）、可判断（截图与说明）、可信任（无遥测、可复核的构建）。当前短板是渠道，不是代码质量：所有验证都通过，但除 GitHub Release 之外没有第三个安装入口。

## 0. 前置条件（缺一不可）

| 条件 | 状态 | 说明 |
| --- | --- | --- |
| 双语语言包与商店清单 | 已完成（1.3.0） | `_locales/en`、`_locales/zh_CN`，清单用 `__MSG_` 引用 |
| 项目主页与隐私政策可公开访问 | 待开启 | `docs/site` + `.github/workflows/pages.yml`；需要仓库启用 Pages（GitHub → Settings → Pages → Source: GitHub Actions）。开启前商店表单无法提交 |
| Chrome Web Store / Edge 审核通过 | 待提交 | 需要开发者账号：Chrome 一次性注册费、Edge 免费。见 `docs/stores.md` 第 3、6 节 |
| 商店素材（截图、标题、简介） | 已完成 | `node scripts/store-assets.mjs`（`pnpm assets`）用发布构建在本机测试样例上渲染，输出到 `docs/site/assets/`：1280×800 截图 4 张（中英各含信息栏与菜单）、440×280 小促销图与 1400×560 大图各双语一张。官方规格见 [Supplying Images](https://developer.chrome.com/docs/webstore/images)：截图至少 1 张、最多 5 张；440×280 小促销图为必需项；图标 PNG 且不超过 128×128（图形 96×96，四周各 16px 透明边）。素材使用测试样例而非登录时间线，站点与图片说明都标注了这一点 |
| 搜索引擎与分享卡片可抓取 | 已完成 | 四页都有绝对 `hreflang`（`en`/`zh-Hans`/`x-default`）、`canonical`、Open Graph／Twitter 卡片与 `SoftwareApplication` JSON-LD，另有 `sitemap.xml` 与 `robots.txt`；这些文件由 `tests/site.test.ts` 门禁保证与包内版本一致，Pages 一开就能被抓取与正确展示（结构化数据里没有 `downloadUrl`，商店链接还不存在） |
| GitHub 仓库元数据（topics、主页链接） | 待所有者设置 | 2026-09-24 用 `gh repo view` 实测：英文 description 已存在，`repositoryTopics` 与 `homepageUrl` 为空，Discussions 关闭；一条 `gh repo edit` 命令见第 4 节第 3 条，不需要改代码 |
| 明确不声明与 X 的任何关联 | 已在文案中落实 | 主页、清单说明、商店文案都写成"下载 X 上可取得的"而非"X 官方" |

在商店链接存在之前，第 2、3 层的发布只做"可安装但需自行加载"的说明，并且每条公告都要写清这一点，否则用户体验落差会直接变成差评。

## 1. 渠道分层

按"边际收益 ÷ 成本"排序，一次只做一层。

**第 1 层：自有阵地（无门槛，立刻可写）**

- GitHub 仓库：`AuroraAeon/x-video-downloader`。要设置 topics（`chrome-extension`、`video-downloader`、`x`、`twitter`、`manifest-v3`、`hls`、`download`、`zh-cn`）、README 顶部安装三段式、Releases 附 ZIP 与 SHA-256。仓库描述用与商店一致的 132 字符以内说明（英文那份已经写好：`README.en.md` 首段，中英双份首页由 `tests/community.test.ts` 同步校验）。
- 仓库级贡献入口已就位（推送后才生效）：`CONTRIBUTING.md` 把 AGENTS.md 的硬约束翻成外部贡献者能照做的门禁清单；`SECURITY.md` 说明扩展能接触什么、不能接触什么，并给私密上报路径（**需要仓库所有者在 Settings → Security advisories 打开 "Private vulnerability reporting"**，文件里已按"若未开启"的退路写清）；`.github/ISSUE_TEMPLATE/` 三个表单（bug、feature、config）用结构化字段代替自由文本，强制填版本、浏览器、控制台输出与"关掉扩展原视频是否能播"，并明确禁止粘贴 Cookie。`tests/community.test.ts` 11 项门禁常驻校验这些表单的结构与首页声明（版本号、相对链接、"商店尚未上架"的状态），避免入口文件自己先过期。
- 项目主页与中英双语隐私政策：`docs/site`，Pages 发布后即成为开发者网站字段。
- Release notes 与 CHANGELOG：每个版本都要有"改了什么 + 如何验证"，这是所有二次传播的原始素材。

**第 2 层：目录与列表（提交成本低，长期引流）**

- Chrome-Stats（`chrome-stats.com`）：公开商店数据的第三方聚合站，提供安装量趋势与相似扩展对比。上架后按其站点流程申请收录，规则提交前当场核对。
- `xyNNN/awesome-chrome`（121 stars，最近一次更新 2026-08-02）：接受 PR，CONTRIBUTING 要求"每个建议单独一个 commit""格式 `[APPLICATION](LINK) - DESCRIPTION`""描述简短、以句点结尾"。本项目放 `Social & Communication` 分类，条目示例：
  `- [X Video Downloader](https://chrome.google.com/webstore/detail/<id>) - Downloads the highest quality video or audio available on X, with inline codec, bitrate and resolution info.`
  注意：该仓库 CONTRIBUTING 链接指向 `awesome-mac`，是它自己的笔误，不代表不能提交。
- Chromium 系浏览器目录：Edge Add-ons 上架后，Edge 扩展中心就是第二个可安装入口；Opera 等无审核直连的渠道不主动铺，避免同一 ZIP 出现在无法维护的位置。
- 中文社区可自助投稿的入口（提交前核对当期规则）：少数派（`sspai.com`）、V2EX 的分享发现节点、即刻/知乎的相关话题。**小众软件类站点只接受免费、无内购的扩展**，本项目符合；但不要一稿多投同一编辑群，逐个跟进。
- 明确不做：付费评测、买量、刷安装量、伪造评论、任何"互推群"。Chrome 的垃圾/重复策略会把整个开发者账号一起评级，这类操作是净损失。

**第 3 层：面向开发者的说明性内容（决定别人是否愿意转发）**

差异化点只有三个，写文案时不要掺别的：

1. 无损：HLS 直接 remux，不重编码；音频抽成 M4A 而非转 MP3。
2. 先给结论再下载：画质/音质在页面内联显示，部分结果标"确认中"，绝不把部分结果写成最高。
3. 可复核：无后端、无 Key、无遥测，商店包与 `dist` 字节一致，SHA-256 随发布公开。

适合的话题角度：MV3 离屏文档 + OPFS 的媒体处理管线（`docs/architecture.md`）、有界探测与取消（`docs/performance.md`）、以及本地化时的两个真实坑——`chrome.i18n.getMessage` 对未声明 `placeholders` 的消息会返回残缺文本，而离屏媒体 Worker 里根本没有 `chrome.i18n`，只能把同一份 JSON 打进包里自己解析。这类技术贴的转化比"我又做了个下载器"高得多。

## 2. 发布顺序与文案

顺序固定：Pages 上线 → 商店提交 → 素材齐备 → 第 1 层公告 → 第 2 层目录 → 第 3 层技术贴。跳过前置条件会让公告链接指向不存在的页面。

**英文（Hacker News `Show HN`、`r/chrome_extensions`、Product Hunt 通用）**

> Show HN: X Video Downloader – lossless HLS remux in a Manifest V3 extension
>
> It reads the media manifest X already has in the page, inspects every candidate, and shows resolution, fps, codec, bitrate, sample rate and channel count under the player before you download anything. Downloads mux the original HLS segments without re-encoding; audio is extracted to M4A rather than transcoded to MP3.
>
> No backend, no API key, no cookies, no telemetry. The offscreen worker writes segments to OPFS and the extension deletes them once Chrome saves the file. MV3, ~230 KB packaged, deterministic ZIP with a published SHA-256.
>
> Chrome Web Store: <link when approved> · Source: https://github.com/AuroraAeon/x-video-downloader
>
> Known limits: it can only reach media your logged-in browser can already reach. No live streams, Spaces or DRM.

**中文（少数派 / V2EX / 即刻）**

> X Video Downloader：先把画质摊开，再决定下载
>
> 视频右上角一个小按钮，下方内联显示分辨率/帧率与音频编码/码率/采样率/声道数。检查覆盖全部候选，未完成时显示"已知… · 确认中"，只有确认后才标最高。HLS 走无损封装（不重编码），音频抽轨成 M4A（不转 MP3）。
>
> 不需要 Python、不需要 X API、不需要服务器或 API Key，也没有遥测。打包产物与商店包字节一致，SHA-256 随版本公开。
>
> 商店条目尚未提交，可先用 `dist` 目录以开发者模式加载；界面随浏览器语言切换中英。

两条公告都必须包含"已知边界"段落。下载类扩展最常见的差评来源是"某个视频下不下来"，而原因通常是登录、地区或平台限流；提前写清楚能把这些转化为 issue 而不是评分。

## 3. 反馈闭环与度量

每周看一次，记录下来：

- Chrome 开发者后台：安装量、启用量、评分与评论、退款/移除原因；Edge 后台的认证状态与下载数。
- GitHub：Stars、fork、issue 首次响应时长、ZIP 下载数（`gh api repos/.../releases` 的 asset `download_count`）。
- 目录：awesome-chrome 的 PR 是否合并、Chrome-Stats 收录后的排名与回流。

节奏约定：任何 X 站点结构变化导致的失效，优先出修复版本并在 CHANGELOG 里注明影响面；商店文案的实质变化（名称、说明、权限）要与版本号同步，因为两个商店都会把清单字段当成审核对象。

**衡量本计划是否有效的唯一硬指标**：三个月内出现一个"不是来自 GitHub"的持续安装来源（商店自然流量或某个目录/帖子的稳定回流），并且评分不低于 4.0。达不到就说明素材或定位有问题，继续加渠道没有意义。

## 4. 需要用户本人完成的事

以下都必须由账号所有者操作，不能自动化。括号内是 2026-09-24 用 `gh repo view` 与直接请求核对到的当前状态。

1. 推送 1.3.0 并打 tag：`git push` → `git tag v1.3.0 && git push origin v1.3.0`。Pages 部署、GitHub Release 附件与商店上传都以这一步为前提。
2. 启用 Pages（GitHub → Settings → Pages → Source: GitHub Actions），让 `.github/workflows/pages.yml` 部署 `docs/site`，提供最终的隐私政策 URL。实测现状：`https://auroraeon.github.io/x-video-downloader/`、`/privacy.html`、`/sitemap.xml` 均返回 404，即尚未部署。
3. Pages 生效后在 Google Search Console 验证该站点并提交 `https://auroraeon.github.io/x-video-downloader/sitemap.xml`（Bing 可跳过：微软自带 Edge 扩展中心入口）。同时设置仓库元数据——实测 `repositoryTopics` 为空、`homepageUrl` 未设置，英文 description 已存在：

   ```sh
   gh repo edit AuroraAeon/x-video-downloader \
     --homepage https://auroraeon.github.io/x-video-downloader/ \
     --repository-topic chrome-extension --repository-topic video-downloader \
     --repository-topic x --repository-topic twitter \
     --repository-topic manifest-v3 --repository-topic hls \
     --repository-topic download --repository-topic zh-cn
   ```

   Discussions 目前关闭（`hasDiscussionsEnabled: false`），若想要长期反馈入口可加 `--add-discussions`；不开也行，issue 表单已就位。
4. 在 Settings → Security advisories 打开 **Private vulnerability reporting**，`SECURITY.md` 里写的主上报通道才可用（文件已给出未开启时的退路，但默认关闭会让安全报告直接进公开 issue）。
5. Chrome 开发者注册（一次性费用）与 Edge 合作伙伴中心注册（免费）。
6. 商店后台创建条目、上传素材、勾选权限说明，并由人按下提交。
7. OAuth refresh token 的浏览器授权（`docs/stores.md` 第 2 节），密钥只写入 GitHub 环境变量 secrets。
8. 任何目录/社区账号的投稿与后续回复。

## 5. 来源

- [awesome-chrome](https://github.com/xyNNN/awesome-chrome) 与其 [CONTRIBUTING](https://github.com/xyNNN/awesome-chrome/blob/master/CONTRIBUTING.md)：条目格式与提交规则，仓库状态经 `gh api` 核对（2026-09-24）。
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish) 与 [Supplying Images](https://developer.chrome.com/docs/webstore/images)：商店素材与字段要求（截图、促销图、图标尺寸）。
- [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)：Edge 无注册费。
- [Chrome-Stats](https://chrome-stats.com)：第三方商店数据收录。
- 政策与拒绝风险细节见 `docs/stores.md` 第 5 节及其来源清单。
