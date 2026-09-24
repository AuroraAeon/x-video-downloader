# 验证记录

日期：2026-09-24（Asia/Shanghai）。当前扩展版本 **1.3.0**。

## 1.3.0 验证

### 本地化门禁

- `tsc --noEmit` 通过；90 项单元测试通过（11 个文件）。新增 `tests/i18n.test.ts` 6 项：两份目录键集与参数数量一致、每条消息的替换实参都声明了 `placeholders`、英文目录不残留中日韩字符、每个键都被源码或清单引用、清单 `__MSG_` 在两种语言下都存在且不超过 132 字符、缺参时保留占位符原文而不伪造文案。
- 单元层的界面语言由 `tests/setup.ts` 固定为 `en-US`：Node 的 `navigator.language` 返回主机 ICU 区域（本机为 zh-CN），否则同一份代码在中文 Windows 与英文 CI 上会得到不同结论。
- 26 项完整 MV3 浏览器业务场景通过，`errors` 为空；布局与语言场景由 8 项增至 9 项并通过，新增的 `locale-zh-CN` 场景启动第二个真实浏览器实例，读取中文界面下信息栏的 `aria-label`，同时要求英文实例的文本不含中日韩字符。两套浏览器套件都固定 `locale: "en-US"`。

### 打包与可复现

- `pnpm exec node scripts/check-package.mjs` 通过：`release/x-video-downloader-1.3.0.zip` 含 19 个文件、237,330 字节、SHA-256 `b23e23ecfe3e3d4e72270d2ec31c625e07a972f6e3211663d9a8602a73ba2469`。归档内确认存在 `_locales/en/messages.json`（9,227 字节）与 `_locales/zh_CN/messages.json`（8,789 字节），清单 1,166 字节通过 `__MSG_` 引用两者。
- 同一份源码连续三次 `pnpm build` + `pnpm package` 得到同一 SHA-256；再以 `TZ=UTC`、`America/New_York`、`Asia/Kolkata`、`Pacific/Kiritimati` 四种时区各重打包一次，四次的 SHA-256 与 CI 发布到 GitHub Release 的附件完全相同（`b23e23ec…`），确认可复现且不随开发机时区漂移。
- **两条真实的跨机可复现缺陷**由这次对比暴露并修好（此前"任何机器都能重算出同一哈希"的说法过强）：
  - `public/manifest.json` 在 Windows 检出时带 CRLF（`core.autocrlf`），而构建原样复制 `public/`，使本机构建比 CI 多 42 字节。`scripts/build.mjs` 现在把复制出来的文本项（json/html/css/js/txt/svg/LICENSE）统一成 LF；修复后本机与 CI 归档的 19 个条目逐字节全部一致。
  - `zipSync` 用**本地**时间字段写 DOS 时间戳，因此 `Date.UTC(1980, 0, 1)` 在 UTC+8 的开发机上写成 08:00、CI 写成 00:00，条目相同而容器哈希不同。`scripts/package.mjs` 改为本地零点常量，四个时区实测同一哈希。
  - 一次方法错误带来的假警报，记录以免照抄：先用 shell 循环 `git cat-file blob | grep $'\r'` 扫全仓库，报出 10+ 个"blob 含 CRLF"的文件，包括工作流与 AGENTS.md。改用 Node 逐字节扫（`git ls-files -z` + `Buffer.includes(13)`）后，真实结果只有 8 个 blob 含 `0x0d`，全部是 `docs/site/assets/*.png`——PNG 二进制里本来就有这个字节，不是行结束符。仓库的 91 个受版本控制文件里**所有文本 blob 都是 LF**，含 CR 的只是本机工作副本（`core.autocrlf=true` 在检出时转换，本机 `public/manifest.json` 1,208 字节带 CR，而 `public/_locales/en/messages.json` 9,227 字节不带，因为后者被工具重写过）。因此不需要 `.gitattributes` 与全库 renormalize 提交，构建端的 LF 归一已经覆盖这条路径。
- 影响范围说明：v1.3.0 的 GitHub Release 附件由 CI 产出，就是规范哈希 `b23e23ec…`；本轮早前记录的 `ee4f84b0…` 是修复前 Windows 本机构建的产物，已作废并在提交历史中保留为历史事实。
- 负向门禁实测退出码 1：向 `en` 目录注入未声明的替换实参并重新打包后，门禁报 `en errHttpStatus uses an undeclared substitution`。还原源码并重建后哈希回到与注入前一致的值。
- 上述两条缺陷各配了一道常驻回归门禁，都装在 `scripts/check-package.mjs` 里：
  - 归档内任何文本条目（json/html/css/js/txt/svg/LICENSE）不得出现 `0x0d` 字节，因为一次 CRLF 泄漏就足以让发布哈希随操作系统漂移。
  - 逐个解析本地文件头，断言 19 个条目的 DOS 时间字段为 0、日期字段为 1980-01-01（月是 1 基，编码 `(年-1980)<<9 | 月<<5 | 日` = 33），从而把"容器时间戳不随构建机时区漂移"变成机器检查，而不是一次手工流程。
- 两道断言都实测会拒：向 `dist/manifest.json` 注入 CRLF（1,166 → 1,208 字节）后只重打包，门禁以 `Carriage return in manifest.json: the package is not reproducible across platforms` 退出 1；把 `scripts/package.mjs` 的时间常量退回 `Date.UTC(1980, 0, 1)` 后，`TZ=Pacific/Kiritimati` 与 `TZ=Asia/Shanghai` 下的重打包都以 `Nonzero DOS time in INSTALL.txt` 退出 1（`TZ=UTC` 下仍通过——那里本地零点与 UTC 零点同一，字节本来就与 CI 相同，属该断言的诚实边界）。还原后重建重打包回到 `b23e23ec…`，且修复后的常量在 UTC / +14 / -5 三个时区都通过门禁。
- 一次负向测试自身的方法错误（记录以免把"没测到"当成"测过了"）：最初用 `pnpm package` 复现注入，而该脚本是 `pnpm build && node scripts/package.mjs`，构建先把注入覆盖掉，门禁"通过"其实什么都没校验。改成注入后只跑 `node scripts/package.mjs`，才被拒。

### 已发布产物本身可安装

商店审核方与用户拿到的是 GitHub Release 里的那个 ZIP，不是本机的 `dist`，因此浏览器套件改为直接跑在已发布产物上（`scripts/e2e.mjs` 与 `scripts/layout-test.mjs` 新增 `XVD_EXTENSION` 覆盖，沿用 `live.mjs`/`performance.mjs` 已有约定）：

- `gh release download v1.3.0` 取回 `x-video-downloader-1.3.0.zip`，SHA-256 与 `release/SHA256SUMS.txt` 记的规范哈希 `b23e23ec…` 完全相同——可复现性主张由此在 GitHub 的分发链路上被复核了一次。
- 解压出 19 个文件，与本机 `dist` 逐文件比对：18 个完全一致，唯一差异是多出 `INSTALL.txt`（打包时才生成，本就不在 `dist`）。
- `XVD_EXTENSION=output/published-dist pnpm test:e2e` 全部通过、`"errors": []`；`pnpm test:layout` 同样通过 9 项，含 `locale-zh-CN` 中文界面场景。即首次安装者按 `INSTALL.txt` 选的目录（含 `manifest.json` 的解压根）确实可用。
- 这个开关本身做了反向对照：`XVD_EXTENSION=output/no-such-build pnpm test:layout` 以退出码 1 失败，说明套件真的在用该路径，而不是"设了没生效、实际仍测 `dist`"的假绿。
- 复现命令：`pnpm build && pnpm package && pnpm exec node scripts/check-package.mjs` 之后，`XVD_EXTENSION=<解压目录> pnpm test:e2e && XVD_EXTENSION=<解压目录> pnpm test:layout`。

### 假设否证

- 本轮曾把故障归因为"未声明 `placeholders` 会让 Chrome 拒绝加载整个扩展"。**该结论不成立**，已实测否证：复制同一份 `dist` 五份，分别注入清单引用消息（`extensionDescription`）与运行时消息（`labelUnavailable`）的 `$1` 和 `$NOTHING` 形态，Chrome for Testing 每次都照常注册后台 service worker（`chrome-extension://<id>/background.js`）。
- 站得住的机制是 `chrome.i18n.getMessage` 对未声明占位符返回残缺文本（实测 `$LABEL` 被读成 `ABEL`），从而污染清单文案与页面文本；`docs/webstore/images` 与 `api/i18n` 页面都没有"加载失败"的描述。AGENTS.md、README、CHANGELOG、发布说明与两处代码注释已按此改写，门禁保留——约束本身仍然成立。
- 复现方式：复制 `dist`，改 `_locales/en/messages.json`，用 `--load-extension` 加载并监听 `serviceworker` 事件。探针脚本留在 `output/`（不入库）。
- 端到端套件的文案断言改为按两份目录共同接受任一语言：离屏媒体 Worker 里没有 `chrome.i18n`，其 `navigator.language` 仍取自主机，因此固定 `--lang` 不能决定那一层的文本；严格的双语校验由单元与布局套件承担。

### 发布链路

- `scripts/store-publish.mjs`：`--help` 与 `release`、`webstore-upload`、`webstore-publish`、`webstore-list`、`edge-package` 全部在缺少凭据时自动 dry-run，打印完整计划调用（密钥与未设置项 redacted）并以 0 退出，未发出任何网络请求；上传类命令先按 `release/SHA256SUMS.txt` 校验归档哈希与版本。
- 修复该脚本一处真实缺陷：发布说明未提及当前版本时，`die()` 抛出的错误被"文件不存在"的分支吞掉，命令静默改用生成文案。现在读取与校验分离，缺文件走 fallback，内容不符则失败退出。
- `ci.yml`、`pages.yml`、`release.yml` 三个工作流均通过 YAML 解析；`release.yml` 的 `verify` 作业与 `ci.yml` 步骤逐条一致，商店作业由 `environment: chrome-webstore`、fork 判定和凭据存在性输出三重门控，未配置凭据时只做 dry-run，发布目标为空则停在草稿不发布。
- 推送后对**真实外部状态**做了一次读回（2026-09-24，`gh run list` / `gh release view` / `gh repo view`，不是本地推断）：`Extension Checks` 在 `main`（提交 `edcd0aa`）为 success；`Release` 工作流对 `v1.3.0` 为 success，`gh release view v1.3.0` 显示非草稿、附件 `x-video-downloader-1.3.0.zip` 与 `SHA256SUMS.txt` 都在；仓库 `homepageUrl` 指向站点、八个 topic 全部读回；`hasDiscussionsEnabled` 仍为 false。GH 上的 zip 与本机四种时区重打包同哈希，即 CI 与本地构建一致。
- 同一次 push 的 `Deploy public site` 为 failure，报 `Get Pages site failed … Error: Not Found`：Pages 未为该仓库启用，站点构建本身成功。这是所有者一次开关的事（Settings → Pages → Source: GitHub Actions），不是代码缺陷；启用前 `https://auroraeon.github.io/x-video-downloader/`、`/privacy.html`、`/sitemap.xml` 实测均 404，因此商店表单仍无法填写隐私政策 URL。
- `actions/configure-pages@v5` 的 `enablement` 输入**不是**免凭证的替代路径：上游 `action.yml` 明写"需要提供 `GITHUB_TOKEN` 以外的 token"（PAT 需 `repo` 或 Pages 写权限，GitHub App 需 `administration:write` + `pages:write`）。给工作流存一个长期 PAT 换来的只是省下一次后台点击，却多了一个凭证，因此本仓库不走这条路，仍按所有者手工启用。
- 两处 `gh` 参数写法在本机 gh 2.95.0 上实测纠正：topic 参数是 `--add-topic`（可逗号并列），`--repository-topic` 会打印用法并失败；开启 Discussions 是 `--enable-discussions`，不存在 `--add-discussions`。`docs/distribution.md` 第 0、4 节已按读回结果改写。同类：`gh api /repos/…` 在本机 Git Bash 下会被 MSYS 改写成 `C:/Program Files/Git/repos/…`，必须去掉前导斜杠。
- 推送 `132dd2d`（复现性修复）后 `Extension Checks` 为 success，即新增的 CR 与 ZIP 时间戳断言在 Linux/CI 上也通过。
- 经所有者授权用 API 启用 Pages（`gh api --method POST repos/AuroraAeon/x-video-downloader/pages -f build_type=workflow`，返回 `build_type: workflow`；随后 `GET …/pages` 显示站点记录存在、`https_enforced: true`，仓库 `has_pages: true`），没有为工作流存任何新 token。之后 `Deploy public site` 两次运行 success，deployment `6631151324`/`6631184960` 的状态链为 waiting → queued → in_progress → **success**（`/deployments/{id}/statuses`）。
- 但站点**尚未对外服务**，这一点单独实测：06:08 UTC 首页、`privacy.html`、`privacy-zh.html`、`zh.html`、`sitemap.xml`、`robots.txt` 全部 404。为排除本机网络与 CDN 负缓存做了三组对照：同机访问 `cli.github.com` 得 200；`--noproxy '*'` 直连仍是 404；此前从未被请求过的 `assets/marquee-en.png` 等新路径立即返回 404（`Age: 1`、`X-Cache: HIT`），而首页那次 404 的 `Age: 3000` 说明它确实是启用前那次探测留下的负缓存。再比对响应正文定性：本站所有路径返回的与"该账号下并不存在的仓库"是同一张 GitHub Pages **"Site not found"** 模板（9,115 字节），而**已注册路由**的 Pages 站在缺路径时返回站点自己的 404（对照 `cli.github.com/no-such-page-xyz` 的 15,328 字节 Jekyll 模板）——所以既不是网络也不是缓存，是边缘上没有这条站点路由。`/pages/builds/latest` 与 `/pages/deployments` 返回 404 属正常（那是分支构建型 Pages 的端点，workflow 构建没有 build 记录）。结论：deployment 成功不等于路由生效，记录为"已启用、已部署、暂未服务"，不改写成"已上线"。
- 为免后来者重复尝试：又做过 `PUT repos/…/pages`（`build_type=workflow`，返回空 204）并再 dispatch 一次部署，等待后仍是同一张 "Site not found" 模板；账号级原因（邮箱是否已验证、Pages 是否从未在后台打开过）无法从命令行确认——本机 `gh` 登录没有 `user` scope，`GET /user/emails` 直接 404，因此这一步只能由所有者在浏览器里看 <https://github.com/AuroraAeon/x-video-downloader/settings/pages> 与 <https://github.com/settings/pages>。

### 商店素材

- 新增 `scripts/store-assets.mjs`（`pnpm assets`），用打包后的 `dist` 构建在本机渲染素材，输出 8 个 PNG 到 `docs/site/assets/`：`shot-en.png`/`shot-en-menu.png`/`shot-zh.png`/`shot-zh-menu.png` 为 1280×800（66,865 / 79,044 / 66,991 / 78,246 字节），`tile-en.png`/`tile-zh.png` 为 440×280（9,550 / 9,224 字节），`marquee-en.png`/`marquee-zh.png` 为 1400×560（35,478 / 33,351 字节）。规格取自 [Supplying Images](https://developer.chrome.com/docs/webstore/images)：截图 1–5 张、必须 1280×800 或 640×400，440×280 小促销图为必填，1400×560 大图为可选。
- 素材由脚本断言而非人工目测：截图经 `sharp` 复核实际像素尺寸必须等于目标尺寸；信息栏必须包含当前语言目录里的"最高画质"字样并匹配 `640 × 360`；下载菜单在闭合 shadow root 内读不到文本，因此改为校验几何（宽 > 100、高 > 60）。
- 拦截方式记录：`context.route()` 不拦截 service worker 内的探测，因此脚本起本机 HTTPS 服务（自签 `video.twimg.com`）并用 `--host-resolver-rules=MAP video.twimg.com 127.0.0.1:<port>` 加 `--ignore-certificate-errors`、`--no-proxy-server` 让真实媒体源指向本地。
- 双语产品页新增截图区（`#gallery`），正文与图注都写明图片来自本机测试样例（色条短片、`@fixture` 账号）而非真实登录时间线，并给出重生成命令；站点在本地以 `file://` 与 http 服务两种方式和两种语言渲染，无断图。截图区三张图都带 `loading="lazy" decoding="async"`（首屏以下，不需要提优先级），宽高属性与真实像素一致，避免布局位移。

### 站点可发现性

- 两个产品页新增完整分享与结构化元数据：`og:*`（含 `og:image` 1280×800 与 `og:locale`）、`twitter:card=summary_large_image`、以及 `@type: SoftwareApplication` 的 JSON-LD（`softwareVersion` 取当前版本、`offers.price` 为 `"0"`、`license` MIT、`codeRepository` 指向真实仓库、`featureList` 五项全部是仓库已记录的行为）。**没有** `downloadUrl`：商店条目尚未创建，写一个不存在的下载链接就是虚假声明。
- 四个页面的 `hreflang` 改为绝对 URL 并补齐 `en` / `zh-Hans` / `x-default` 三向声明，产品页与隐私页各自成组互指；新增 `docs/site/sitemap.xml`（4 条 `<loc>`，双语交替用 `xhtml:link`，并声明 `xmlns:xhtml`，否则 XML 解析直接失败）与 `docs/site/robots.txt`（`Sitemap:` 指向绝对地址）。
- 这些事实由 `tests/site.test.ts` 6 项常驻门禁检查（CI 已跑 `pnpm test`）：内部链接与 `content=` 里的绝对分享 URL 必须对应仓库内真实文件；标签为“Version/版本”的版本号必须等于 `package.json`；`hreflang` 组必须绝对化且成对互指；JSON-LD 必须可 `JSON.parse` 且版本与包一致；sitemap 两个命名空间与 `<loc>` 落盘一致；素材 PNG 尺寸必须等于 1280×800 / 440×280 / 1400×560。
- 负向验证逐条实测（7 个注入场景，脚本 `output/site-gate-negative.mjs`，不入库）：结构化数据版本改成 9.9.9 → JSON-LD 用例失败；`hreflang` 改回相对 → 互指用例失败；`og:image` 指向缺失文件 → 链接用例失败；中文页写 1.2.1 → 版本用例失败；删掉 `xmlns:xhtml` → sitemap 用例失败；`robots.txt` 的 `Sitemap:` 改成相对 → 同一用例失败；把 1280×800 截图塞进 `tile-en.png` → 尺寸用例失败。每轮后按 SHA-256 前缀比对确认四个 HTML、sitemap、robots 与两张 PNG 全部还原，还原后套件重新全绿。
- 一处真实教训：`og:image` 指向缺失文件最初**没有**被门禁拒绝——门禁只查 `src`/`href`，不查 `content=` 里的绝对 URL。补上该分支后重跑注入场景才被拒。

### 隐私声明与权限一致性

- 商店"数据隐私"表与实际权限不一致是常见被拒原因，因此新增 `tests/privacy-claims.test.ts` 4 项，把政策文案与 `public/manifest.json` 机械对齐：两份隐私政策正文（去掉标签后的文字）出现的 `https://主机` 必须**恰好**等于清单 `host_permissions` 去掉 `/*` 后的三条（`x.com`、`video.twimg.com`、`cdn.syndication.twimg.com`），中英文两页还须互相一致；两个产品页正文出现的外部主机只能来自"已授权主机 ∪ 自有站点/仓库/许可证/schema.org"这个封闭集合；产品页"权限/Permission"表格第一列的 `<code>` 标记必须与清单的 `permissions` + `host_permissions` 一一对应（不多不少）。
- 负向验证（`output/privacy-gate-negative.mjs`，5 个注入场景，不入库）：政策里把某个已授权主机换成 `analytics.example.com` → 前两条用例失败；产品页正文加入 `sponsor.example.com` → 封闭集合用例失败；清单加入 `cookies` 权限而表格未更新 → 权限表用例失败；中文政策改掉一个 CDN 主机 → 一致性用例失败；把表格里的 `downloads` 换成 `cookies`（页面声称拥有但清单没有）→ 同一用例失败。每轮结束按 SHA-256 前缀确认四个 HTML 与 `public/manifest.json` 均已还原，还原后套件重新全绿。
- 两处**最初写成、后来被否证**的假门禁，记录以免重犯：
  - "政策正文里出现权限名即算已说明"——只要用 `text.includes("cookies")` 这类子串判断，页面里"我们绝不读取 Cookie"这句话就会让"清单新增了 cookies 权限"这种真实漂移蒙混过关（实测四个页面都含 `<code>cookies</code>`，注入后 4 项全绿）。改为只读权限表格第一列的 `<code>` 标记，并加入"表格不得声称清单里没有的权限"的反向断言后才被拒。
  - 负向脚本自身的 `ran` 探针最初用 `describe` 名（"privacy claims"）判断套件是否真的跑过；通过时 vitest 只打印文件路径，导致"没跑"被误判为"跑了"。改用文件名 `privacy-claims.test.ts` 判断。
- 修文案而非放松断言：中文隐私政策原先写"离屏文档"而未点名 API，因此补成 `离屏文档（<code>offscreen</code>）`，英文政策同样把 `offscreen` 标成代码，使政策与用户安装时看到的权限提示用词一致。

### 贡献入口与仓库首页

- 新增 `CONTRIBUTING.md`（把 AGENTS.md 的硬约束翻成九条门禁命令与七条不变量）、`SECURITY.md`（扩展能接触与不能接触什么、`release/SHA256SUMS.txt` 核对方式、私密上报退路）和 `.github/ISSUE_TEMPLATE/` 三个表单（bug、feature、config）。结构与仓库首页事实由 `tests/community.test.ts` 13 项常驻门禁校验：字段类型只能取 GitHub 真正渲染的五种（写成别的类型会让整张表单从 New issue 页面静默消失）、每个字段有唯一 `id` 且有标签、两个确认项都必须 `required: true`、`config.yml` 必须关闭空白 issue 且两个 contact 链接指向仓库内真实存在的页面、两份 README 相对链接不得失效、两份 README 互指、权限表必须与清单 `permissions` + `host_permissions` 完全相等、"当前版本"与 ZIP 文件名版本必须等于 `package.json`、且必须写明"商店尚未上架"而不得出现"审核中/已上架"。仓库无 YAML 解析依赖，因此门禁按行解析；一次性 Python 校验器（`output/issue-forms-check.py`）保留作交叉核对，注入非法 `type: textfield` 时它退出 1。
- 新增 `README.en.md`：仓库首页此前只有中文，而扩展界面与项目主页都提供英文版，英文读者无法在 GitHub 上判断这个扩展做什么。英文页逐段对应中文页，不新增任何能力、速度或用户量声明；两份首页互相链接，并由同一批门禁（链接、版本、权限表、商店状态）同时检查，改一边就会被拒。
- 负向验证逐条实测（18 个注入场景，脚本 `output/community-gate-negative.mjs`，不入库）：`checkboxes` 改成 `textfield` → 类型用例与确认项用例同时失败；删掉一个字段 `id` → id 用例失败；把某个确认项改成 `required: false` → 确认项用例失败；删掉"不要粘贴 Cookie/authorization/token"警告 → 告费用例失败；`blank_issues_enabled` 改成 `true`、contact 链接指向不存在的页面 → config 用例失败；中文首页版本写 1.2.1、英文首页 `Current version` 写 1.2.1 → 版本用例失败；把"商店尚未上架"改回"审核中"、英文首页改写为 "The Chrome Web Store listing is in review." → 商店状态用例失败；`docs/stores.md` 链接改错（两份首页各测一次）→ 链接用例失败；删掉中英互指链接 → 互指用例失败；删掉指向 CONTRIBUTING/SECURITY 的链接（两份各一次）→ 入口用例失败；从权限表删掉一条已授权主机（中英各一次）、或把 `downloads` 写成 `cookies` → 权限表用例失败。每轮后按 SHA-256 前缀确认四个文件字节还原，还原后 13 项重新全绿。
- 两处**由门禁检查暴露出的真实虚假声明**，不是测试问题而是文案问题：
  - `README.md` 原本写"商店版本审核中"，而 `docs/distribution.md` 第 0 节记录的是"待提交"——从未向任何商店提交过，这句话描述了一个不存在的外部状态，对审核方和用户都是误导。改为"商店尚未上架……注册与提交步骤见 docs/stores.md"，并加入"首页不得出现审核中/已上架"的门禁与对应注入场景。`docs/distribution.md` 里的公告草稿有同一处错误（"目前商店审核中"），一并改为"商店条目尚未提交"。
  - 英文 bug 表单原本让报告者去读 README 里的 "what is not supported" 清单，但 README 只有中文 `行为与边界` 一节，英文页面上不存在该标题。改为指名实际章节（`README.md` 的 `行为与边界`）。
- 一处**最初写成、后来被否证**的假门禁，记录以免重犯：确认项用例最初只比较全文 `required: true` 次数与 `validations:` 次数（`8 >= 6` 恒成立），删掉某个复选项的 `required: true` 仍然通过（`7 >= 6`）。改为按缩进分别统计复选项数与其 `required: true` 数、要求两者相等之后，该注入才被拒。
- 外部现状改为实测而非推测（2026-09-24）：`gh repo view` 显示仓库存在、描述已是英文，但 `repositoryTopics` 与 `homepageUrl` 均未设置、Discussions 关闭；直接请求 `https://auroraeon.github.io/x-video-downloader/`、`/privacy.html`、`/sitemap.xml` 都返回 404，确认 Pages 尚未部署。`docs/distribution.md` 第 0 节新增"GitHub 仓库元数据"行，第 4 节按实测状态重写（并修正了原来的重复编号），附上设置 topics 与主页链接的 `gh repo edit` 命令。同日经所有者授权执行该命令后再次读回：`homepageUrl` 已指向站点、八个 topic 全部到位、Discussions 仍关闭、描述 166 字符（GitHub 上限 350，商店的 132 字符上限只约束清单说明，由打包门禁保证）；distribution 第 0、4 节随即从"待所有者设置"改为"已完成"，Pages 三项 URL 仍实测 404，未改。
- 三处**由自查发现并已修正的文案不准**：`README.md` 与 `docs/distribution.md` 草稿都把商店写成"审核中"（实际从未提交）；英文 bug 表单引用了 README 中不存在的英文小标题；`CHANGELOG.md`、`docs/validation.md` 与发布说明把 CONTRIBUTING 的不变量条数写成六条（实际七条，`grep -c '^- \*\*'` 核对）。前两类现在各有门禁，条数类属于一次性笔误，已逐处改正。

### 本轮未实测

- 没有向 Chrome Web Store 或 Edge Add-ons 提交任何内容：注册、条目创建、素材上传和最终提交按钮都属于账号所有者的手工步骤，见 `docs/distribution.md` 第 4 节。
- GitHub Pages 已启用且两次部署都报 success，但截至 2026-09-24 06:08 UTC 站点 URL 实测仍 404（见"发布链路"一节的三组对照），因此 `docs/site` 与双语隐私政策在外部看来仍只是仓库内文件；商店表单要求一个公开可访问的隐私政策 URL，所以真正返回 200 之前无法提交。Search Console 验证与 sitemap 提交同样只能等这一步生效。
- 素材已生成但未上传到任何商店表单，也没有人工确认过商店审核方是否接受"渲染本机测试样例"的截图；如需以真实 X 页面截图提交，需要账号所有者用自己的登录态另行截取，本机样例是为了不把个人时间线送进仓库和商店素材。
- 真实 X 页面的 `test:live`、`test:live-hls`、`test:source` 未运行，原因与 1.2.1 相同：需要外网与真实登录态，不能用本机样例代替。

## 1.2.1 验证

### 修复前复现

- 后台启动恢复阶段任一存储步骤被拒绝时，`ready` 变成永久失败的门闩：之后 `LIST`、`PROBE`、`START` 全部返回失败，直到 worker 重启。
- 探测订阅计数只增不减且没有 `chrome.tabs.onRemoved` 回收：累计 100 个被放弃的探测后，所有内联画质检查长期返回“正在检查其他视频”，而下载仍正常。
- 向 `dist` 添加多余文件、放宽 `host_permissions` 或删除内容安全策略后，旧的打包检查仍然报告 `valid: true`。

### 修复后门禁

- `tsc --noEmit` 通过；61 项单元测试通过（7 个文件），新增 6 项后台用例覆盖消息信任边界、伪造页面无法启动下载或清空队列、启动恢复、订阅按标签页关闭回收、订阅超时过期。恢复用例同时断言失败必须记录一次 `console.error`，即降级可见。
- 26 项完整 MV3 浏览器业务场景通过，`errors` 为空；原有 8 项布局回归继续通过，信息栏仍在播放器外的正常文档流。
- `pnpm exec node scripts/check-package.mjs` 通过：`release/x-video-downloader-1.2.1.zip` 含 17 个文件、207,572 字节、SHA-256 `94217b65a5bef8541713fdc0fee469dcc1748579f4e6d644e608ba55fd6b6d80`，与 `dist` 逐文件哈希一致。多轮完整 `build` + `package` 得到同一 SHA-256，确认可复现。
- 负向门禁逐项实测，退出码均为 1：`dist` 中多余文件报 `dist/stray.js is missing from the archive`；只放宽源码 `manifest` 的 `host_permissions` 而不重建会被深度比对拒绝；重建后的产物内注入 `eval` 报 `Dynamic code evaluation in background.js`。实验后源码、`dist` 与 `release` 已还原，还原后重新构建得到与实验前一致的产物。
- 浏览器语义实测：Chrome for Testing 153.0.8010.12（Playwright 1.63.0，chromium build 1243）中 `ReadableStreamDefaultReader.prototype.cancel` 存在；读取挂起时触发 abort，`boundedText` 立即以“响应读取已取消”结束，`finally` 中的 `releaseLock()` 不抛错且页面无未捕获异常；提前 abort 与超出字节上限同样不挂起。

### 本轮未实测

- 真实 X 页面的 `test:live`、`test:source` 和登录态时间线未运行，需要外网与真实账号；不能用本机集成测试代替。
- 80ms 往返探测基准未重跑。本轮不改变候选采样、探测顺序或合并算法，因此没有新的性能结论；1.2.0 记录的性能数字仍是那一版的基准结果。
- MAIN 世界读取的并发、期限与排队上限常量只在本地流式样例下验证，未对真实 X 时间线做背压压测。

## 1.2.0 验证

- TypeScript 严格类型检查通过，55 项单元测试通过；新增 Range 边界、并发/取消、Worker 队列、会话缓存与长清单用例。
- 26 项完整 MV3 业务场景通过，包括后台和离屏文档关闭后零 CDN 请求恢复缓存；音频输出编码包仍与源音频完全一致。
- 原有 8 项布局回归继续通过，信息栏保持播放器外的正常文档流。
- 固定 80ms 网络往返的三轮探测基准通过，完整候选列表逐项深度相等；单媒体约 1.69s → 0.57s、读取量减少约 86%，三媒体 UI 约 5.20s → 1.17s。完整方法与限制见 performance.md。
- 正常窗口真实 X 页面视频与音频下载通过，完整信息数值一致；独立 M4A 仅含 AAC 音轨、111.278333 秒。实页时间记录在 `live-baseline-1.1.1-report.json`、`live-optimized-1.2.0-report.json`、`live-audio-1.2.0-report.json`。
- 源码与 Git 工作树独立迁移到 `F:\x-video-downloader`；旧 `dist` 路径为指向新构建的兼容链接，文件内容一致。未改动原 MediaCrawler 用户修改。

## 1.1.1 验证

- 修复前在深层绝对定位播放器中复现问题：视频区域为 y=16..454.75，信息栏出现在 y=20..56，互动行未被推开。旧的五层等尺寸向上搜索停在播放器内部。
- 修复后 8 项 MV3 布局回归通过：深层 legacy、带内边距的比例占位、普通流式播放器，分别覆盖 1200px 和 390px 视口；另覆盖同一 video 换父层、隐藏后重新显示。
- 每个场景都检查信息栏位于媒体区域之后、互动行之前；互动行下移至少一个信息栏高度；播放器原始高度保持不变，下载按钮仍在画面内部。截图位于 `output/playwright/layout-*.png`，几何证据保存在 `layout-report.json`。
- 原有 25 项浏览器业务场景继续通过，无页面 JavaScript 异常；37 项单元测试和严格类型检查通过。
- 真实 X 详情页验证通过：信息栏位于播放器外部，菜单正常，实际最高画质视频下载完成。此次未直接访问用户截图对应的登录态页面，因此深层结构问题由明确失败过的布局回归验证，另以公开实页检查兼容性。

## 1.1.0 验证

- TypeScript 严格类型检查通过；37 项单元测试通过；25 项完整 MV3 浏览器集成场景通过，无页面 JavaScript 异常。
- 28px 按钮和 16px 图标尺寸验证通过；截图像素测试确认按钮随背景颜色变化，透明背景不是固定黑色填充。390px 窄视口及 1200px 桌面菜单截图已检查，没有越界或信息栏遮挡。
- 未点击下载时，视频下方自动显示分辨率、帧率、音频编码、估计码率、采样率和声道数，下载任务数保持零。重新访问相同媒体不增加 CDN 探测请求。
- 视频与音频菜单分别启动对应任务；键盘选择、Escape、点击外部关闭均通过，无音轨时标明并禁用音频选项。
- HLS 样例包含默认低码率音轨和非默认高码率音轨。音频功能正确选择约 191 kb/s、48 kHz、双声道音轨；M4A 仅含 AAC 音轨，编码包逐包 SHA-256 与源音频相同。
- MP4-only 样例成功无损提取 M4A，编码包同样与源文件一致；同一媒体的视频和音频下载分别去重。
- 真实 X 页面在不下载时自动显示 `480 × 360 · 29.97 fps` 和 `AAC · ≈68 kb/s · 48 kHz · 2 ch`。信息栏位于播放器下方，不遮挡现有时间戳或操作栏。
- 通过真实页面的音频菜单完成 M4A 下载：仅有 AAC 音轨、48 kHz、双声道，时长 111.278333 秒，完整 FFmpeg 解码无错误。
- 原有视频、HLS、降级、取消、service worker 重启、离屏文档丢失、节点复用、多视频独立定位及 OPFS 清理回归场景继续通过。

当前证据：`output/playwright/e2e-report.json`、`live-audio-report.json`、`live-audio-before.png`、`live-audio-menu.png`、`live-audio-after.png`、`v1.1-menu-desktop.png`、`v1.1-menu-narrow.png`。测试使用独立 Chrome for Testing 145.0.7632.6；没有修改用户日常 Chrome 配置。

音质排序基于可取得编码音轨的码率，抽样估计值带 `≈`，不声称对不同编码、内容或听感作绝对优劣判断。网络未响应时无法预先知道全部参数，信息栏使用短暂检测状态，失败明确提示，不输出猜测数据。

## 1.0.0 历史验证

## 已通过

| 检查                        | 结果                                                     |
| --------------------------- | -------------------------------------------------------- |
| TypeScript 严格类型检查     | 通过                                                     |
| 解析与网络边界单元测试      | 31 项通过                                                |
| 完整 MV3 浏览器集成场景     | 16 项通过，无页面 JavaScript 异常                        |
| 当前 X SSR 数据解析         | 两条公开帖子通过，普通视频 3 个候选、视频卡片 4 个候选   |
| 真实 X 页面点击下载         | 通过，480×360 H.264 + AAC，111.278333 秒，无降级警告     |
| 真实 X CDN HLS 无损合并     | 通过，480×360 H.264 + AAC，111.278333 秒，4,867,874 字节 |
| 真实直链与 HLS 输出完整解码 | FFmpeg 全文件解码通过，无错误                            |

浏览器集成使用独立 Chrome for Testing 145.0.7632.6 配置，加载实际 `dist`。Playwright 控制版本为 1.63.0，通过 `XVD_CHROME` 指定现有 CFT 可执行文件。安装更高版本测试浏览器时下载耗时较长，未作为验证前提；扩展运行不依赖 Playwright。

真实 X 实测使用正常可见 Chrome 窗口。无头模式访问同一 X 页面收到 HTTP 403；未试图绕过该拒绝。`test:live` 因此默认使用可见窗口，可设置 `XVD_HEADLESS=1` 重现无头条件。

## 集成场景

1. 伪造页面下载消息不能启动任务。
2. HLS 比 MP4 更清晰时选择 HLS；输出包含预期视频、AAC 音轨和时长；重复点击不会产生重复下载。
3. HLS 返回 403 时降级到 MP4，并保留警告。
4. 只有首屏初始状态、没有 GraphQL 响应时仍可提取。
5. MPEG-TS HLS 可以无损封装。
6. 合并期间分片失效可降级到 MP4。
7. 强制停止 service worker 后，离屏任务继续并只创建一次下载。
8. 离开来源页面不影响任务。
9. 429 限流立即停止，不形成重试风暴。
10. 390px 窄视口按钮保持在视频内。
11. 视频 DOM 节点替换后不重复插入按钮。
12. 取消会中断活动处理。
13. 离屏文档被关闭后任务标记 interrupted，手动重试能恢复。
14. 每个视频独立绑定并下载正确的媒体 ID 与序号。
15. 完成、失败和取消后 OPFS 临时目录没有残留文件。
16. Chrome 原生直链下载中断后，任务对账不会提前终止后续 HLS 候选。

真实 HLS 检查额外直接调用发布构建的媒体 Worker，以真实 SSR 返回的 HLS URL 作为唯一输入，执行探测、无损合并、OPFS 输出、Chrome 保存及 ffprobe 检查。它证明真实 CDN 分片的处理能力，不替代完整页面按钮集成测试；页面按钮下载由另一项实测覆盖。

## 证据位置

- `output/playwright/e2e-report.json`：集成结果及 ffprobe 输出。
- `output/playwright/source-report.json`：当前公开页面 SSR 提取结果与时间。
- `output/playwright/live-report.json`：正常 Chrome 窗口的真实页面下载结果。
- `output/playwright/live-hls-report.json`：实际 CDN HLS 合并与输出流信息。
- `output/playwright/live-x-after.png`：真实 X 页面上的扩展按钮和完成状态。
- `output/playwright/live-popup.png`：真实任务完成记录。
- `output/playwright/desktop.png`、`narrow.png`：明确标注为本机测试页面的布局检查截图。

## 尚未实测的边界

没有在用户平时使用的 Chrome 配置中安装扩展，也没有访问用户已登录账号。登录后的个性化时间线、受保护账号、不同实验组或地区尚需在安装后验证。代码支持新旧响应与页面结构，这不等于上述所有线上组合均已验证。

未通过填满真实磁盘验证配额耗尽，也未执行数小时或数 GB 的压力下载。相关错误处理、流式写入和资源限制已经实现。整机退出后的 HLS 任务只能重试，不能恢复任意分片位置。网站未来变更仍可能需要维护提取器。
