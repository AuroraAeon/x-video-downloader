# X Video Downloader

[English](README.en.md) · 简体中文

独立 Chrome Manifest V3 扩展。在 X 帖子视频右上角提供小型毛玻璃下载按钮，点击可选择最高画质视频（MP4）或最高音质音频（M4A）。视频下方自动显示分辨率、帧率和音频编码、码率、采样率与声道数，无需先下载。界面、状态与错误提示随浏览器界面语言切换简体中文和英文。当前版本 **1.3.0**。

[项目主页与隐私政策](https://auroraeon.github.io/x-video-downloader/) · [下载最新安装包](https://github.com/AuroraAeon/x-video-downloader/releases/latest) · [更新记录](CHANGELOG.md)

不需要 Python、MediaCrawler、付费 X API、服务器、API Key 或本机 FFmpeg。FFmpeg 只用于开发测试生成样例和检查结果，扩展运行不依赖它。

## 安装

商店尚未上架：Chrome Web Store 与 Microsoft Edge Add-ons 都还没有条目，注册与提交步骤见 [docs/stores.md](docs/stores.md)。审核通过并上架后本段会替换为两个商店的直接安装链接。在此之前只有以下安装路径：

1. 打开 Chrome 的 `chrome://extensions`，开启右上角的「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目的 `dist` 目录。也可以解压 `release/x-video-downloader-1.3.0.zip`，选择解压后包含 `manifest.json` 的目录。
3. 刷新已打开的 X 页面。保持原有登录状态，点击视频右上角的下载图标，选择视频或音频。

同一份构建也适用于 Edge、Whale、Opera 等 Chromium 内核浏览器；`minimum_chrome_version` 为 116，不支持 Firefox（依赖 `offscreen` 与 OPFS）。

扩展安装目录需要保留。更新时替换构建目录，在扩展管理页点击刷新，再刷新 X 页面。无需重新登录，也不需要复制 Cookie。

### 从已安装版本更新

1. 等待当前下载完成。若已从本项目 `dist` 安装，新构建已在原位置；若从 ZIP 安装，将新包解压覆盖到**原先加载的同一个目录**。
2. 打开 `chrome://extensions`，找到 X Video Downloader，点击卡片上的刷新图标。
3. 确认扩展版本变为 **1.3.0**，刷新所有已打开的 X 页面。

无需移除后重装；保留同一目录可以保留扩展 ID 和本地任务记录。已有 1.0.0 任务会作为视频任务读取。

### 独立项目位置

源码与独立 Git 仓库现在位于 `F:\x-video-downloader`，不在 MediaCrawler 目录树中。原 `F:\MediaCrawler\x-video-downloader` 仅保留迁移说明和 `dist` 兼容目录链接，不含源码或第二份 Git 仓库；该链接指向新项目构建，原来加载旧路径的 Chrome 扩展可直接刷新。不要删除这个兼容入口，除非已经将扩展安装路径迁移。

新机器可直接克隆本 GitHub 仓库到任意独立目录，不需要先获取 MediaCrawler。运行和构建都没有对其路径、依赖或服务的引用。

文件通过 Chrome 下载管理器保存；保存位置遵从 Chrome 设置。文件名示例：`x_author_1001551623938805763_1_480x360.mp4`。点击扩展工具栏图标可查看任务、实际画质、限制或降级原因，并取消或重试任务。

## 语言

`public/_locales/en` 与 `public/_locales/zh_CN` 是全部用户可见文案的唯一来源：菜单、画质栏、任务弹窗、状态与错误提示都从这里渲染，清单文件的名字和说明用 `__MSG_` 引用同一批键。新增语言只需复制一份 `messages.json` 并在 `src/i18n.ts` 注册，不需要改任何业务代码。

带参数的消息必须声明 `placeholders`：未声明时 `chrome.i18n.getMessage` 会返回残缺文本（实测 `$LABEL` 被读成 `ABEL`），清单里的名称与说明跟着坏掉，因此 `pnpm exec node scripts/check-package.mjs` 会解包校验两份目录的键、参数与占位符一致，`tests/i18n.test.ts` 在单元层重复同样的检查。运行时不调用 `getMessage`，两种语言都由同一份打包目录渲染。

## 行为与边界

- 支持 X 托管的视频和以视频文件存储的动图。多视频各自下载；引用帖和转帖通过媒体 ID、预览图及帖子链接确定归属，无法确认时不猜测。
- 先读取网页已有的 GraphQL/SSR 数据。视频接近可视区域时自动读取有限媒体数据，检查最高画质与音质；不足时串行读取所属帖子详情和 X 自有公开嵌入接口，失败不无限重试。后备接口可能缺少媒体，使用时会提示。
- 自动检查不创建下载文件。两条有界探测队列优先处理当前可见视频，滚走会取消未被下载使用的检查。每个媒体最多四个网络请求并发；32 KiB Range 块只读取必要头部和样本表，不预取整段视频负载。
- 全部候选仍会检查，保留音频 96 包和视频 64 帧的测量范围；部分结果显示为「已知… · 确认中」，只有完成后才显示最高可用结果。
- 浏览器会话内复用十五分钟的显示摘要、两分钟的下载候选，后台休眠和离屏文档关闭不会清空。签名 URL 改变会使缓存失效，缓存不跨浏览器会话，不存储鉴权信息。
- 音频独立比较所有可用音轨，按码率、采样率、声道数排序；从 HLS 或 MP4 无损提取为 M4A，不转换成有损 MP3。`≈` 表示通过编码包抽样估计的码率，单位使用 `kb/s`、`kHz`、`ch`。这不是对听感的主观评分。
- 清晰度按实际像素、帧率、同编码码率排序，同档优先直链 MP4。播放器当前清晰度、预览图尺寸、`original_info` 都不直接代表下载版本。
- 一次最多两个活动下载任务，其中最多一个媒体合并或音频提取；最多排队 20 个任务。同一视频的视频下载和音频下载分别去重。失败候选可自动降级；取消、磁盘问题、限流、非法地址会停止任务。
- HLS 无损封装，不重编码，不静默丢弃配对音轨。使用 OPFS 临时文件控制内存，Chrome 保存完成后删除临时文件。空间不足时提示错误。
- 关闭或离开 X 来源页不会取消已开始的任务。后台 service worker 休眠或重启会与离屏任务和 Chrome 下载记录对账。浏览器整体退出造成的未完成合并需要重试，不承诺从任意分片断点续传。
- 不支持直播录制、Spaces、外部视频网站、加密 HLS/DRM，也不绕过登录、受保护账号、地区或平台挑战。只能处理当前访问条件下已经取得或正常可以取得的媒体。
- 「最高」指 X 提供且当前能取得的版本，不是上传原片。若候选解析失败或信息来自可能不完整的来源，任务会标记限制；若最高候选下载失败则标记降级。
- 网站可以改变 DOM、接口和数据结构。失败时优先刷新 X 或打开原帖重试；若 X 本身提示登录、403 或限流，应先处理网页访问问题。

## 隐私与权限

| 权限                                  | 用途                                     |
| ------------------------------------- | ---------------------------------------- |
| `downloads`                           | 启动、取消和跟踪扩展创建的下载           |
| `storage`                             | 本地任务状态，最多保留 60 条已结束记录   |
| `offscreen`                           | Worker 媒体处理及下载完成前维持 Blob URL |
| `https://x.com/*`                     | 页面按钮与本页媒体数据采集               |
| `https://video.twimg.com/*`           | 读取媒体清单和音视频数据                 |
| `https://cdn.syndication.twimg.com/*` | 可视视频的公开嵌入元数据后备来源         |

不申请 Cookie、调试器或全站权限；不保存账号令牌或请求鉴权头；没有遥测。媒体请求不携带 X 会话鉴权头。任务记录可能包含帖子 ID、作者、媒体 URL 和文件名，保存在当前浏览器本地；清除任务只移除扩展记录，不删除已下载文件或 Chrome 下载历史。

所有运行时代码随扩展打包，无远程脚本、`eval`、远程模块加载或原生通信。页面消息只传递媒体记录，不能直接触发下载。

## 分发与生态

同一个确定性安装包服务所有渠道：`pnpm package` 产出 `release/x-video-downloader-<版本>.zip`（清单在压缩包根目录、条目排序、时间戳固定）和 `release/SHA256SUMS.txt`，`docs/site` 由 `.github/workflows/pages.yml` 发布成项目主页与隐私政策。

- Chrome Web Store / Microsoft Edge Add-ons：一次性人工登记与提交步骤、被拒风险分析、Single Purpose 文案见 [docs/stores.md](docs/stores.md)。
- GitHub Release 与商店上传：`node scripts/store-publish.mjs --help`，凭据只从环境变量读取，缺少凭据时自动进入 `--dry-run` 且不做任何网络访问；`.github/workflows/release.yml` 在打 tag 后复用与 CI 完全相同的门禁。
- 隐私声明一致性由 `tests/privacy-claims.test.ts` 把站点文案与 `public/manifest.json` 机械对齐：政策正文里的主机必须恰好等于 `host_permissions`、中英两页互证、产品页权限表必须与清单双向一致；`tests/site.test.ts` 另检查分享图 URL、页面板本号、`hreflang` 互指、`sitemap.xml` 与商店图尺寸。
- 站点收录、目录提交与社区发布的顺序与文案草稿见 [docs/distribution.md](docs/distribution.md)。
- 贡献与安全上报：[CONTRIBUTING.md](CONTRIBUTING.md) 把本项目的硬约束翻成外部贡献者能照做的门禁清单，[SECURITY.md](SECURITY.md) 说明扩展能接触与不能接触什么并给出私密上报路径；`.github/ISSUE_TEMPLATE/` 三个表单的结构由 `tests/community.test.ts` 校验，仓库首页的链接、版本号与商店状态也一起纳入门禁。
- 商店与站点素材（1280×800 截图、必填的 440×280 促销图、1400×560 大图，双语）由 `pnpm assets` 用打包后的 `dist` 在本机测试样例上渲染到 `docs/site/assets/`，脚本按官方规格校验像素尺寸；截图是测试样例而非真实时间线，站点图注同样写明这一点。

上架前只有两种取得方式：克隆仓库加载 `dist`，或解压 `release` 中的安装包。两者与商店包字节一致，因此审核通过后的自动更新不会改变本地行为。

## 开发与验证

使用 Node.js 22+ 和 pnpm。完整依赖版本由 `pnpm-lock.yaml` 固定。

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

`test:e2e` 需要开发机安装 FFmpeg/ffprobe，生成短媒体样例，然后以真实 MV3 扩展、离屏 Worker、OPFS 和 Chrome 下载管理器执行集成测试。媒体由隔离的本机 HTTPS 测试服务提供；域名映射和测试证书选项仅作用于测试浏览器，不写入发布构建或系统设置。

`test:live` 访问公开 X 视频帖，先确认自动信息栏，再使用菜单下载实际 CDN 视频，检查文件后生成 `output/playwright/live-video-report.json`。设置 `XVD_MODE=audio` 可验证完整音频下载并生成 `live-audio-report.json`。它使用独立测试配置，不读取用户 Chrome 配置。网络、登录或 X 的限制可能让实测失败；此类失败不能用本机样例测试代替。

`test:live` 默认使用正常可见 Chrome 窗口，无头模式可能被 X 拒绝。`test:source` 核实当前公开页面的 SSR 解码；`test:live-hls` 使用该记录对实际 CDN HLS 执行独立合并检查。需要使用现有 Chrome for Testing 时可设置 `XVD_CHROME` 为其可执行文件路径。

参见 [调研记录](docs/research.md)、[架构与恢复约定](docs/architecture.md) 和 [验证记录](docs/validation.md)。

1.2.0 的逐阶段性能审查、可复现基准和访问边界见 [性能报告](docs/performance.md)。仓库 CI 在每次 push/PR 执行类型检查、单元测试、实际 MV3 浏览器业务与布局验证、构建和打包检查。

## 第三方代码

本项目原创代码使用 [MIT License](LICENSE)。第三方库保留各自许可证。

Acorn 用于只读语法树解析，Lucide 用于图标，Mediabunny 用于媒体解析和无损封装。版本和许可证随构建保存在 `dist/THIRD_PARTY_NOTICES.txt`。Mediabunny 使用 MPL-2.0；本项目没有修改其源码。对应源码可从 npm 锁定版本或上游仓库取得。
