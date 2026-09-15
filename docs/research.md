# X 接口与 MV3 调研

1.1.0 更新：视频进入可视区域时自动检查媒体信息，复用网页元数据和受限的 CDN 读取。音频从所有候选输入的音轨独立选取，通过编码包抽样估计码率；选中后无损封装为 M4A。公开嵌入回退已从「仅点击后」扩展为「可视视频元数据不足时」，仍不轮询账号接口或绕过访问限制。

调研时间：2026-09-14 至 2026-09-15（Asia/Shanghai）。以下地址和 query ID 是本次观察，不是永久接口契约。源码中不固定 X query ID，也不重新实现其事务签名。

## 1. 实测范围

规划阶段通过浏览器实际访问公开详情页，并通过 HTTPS 读取当前站点脚本、公开嵌入数据和媒体清单。此时得到的未登录页面属于新的 `x-web` 前端，包含 SSR、Relay 与 TanStack Router 的数据流；不能由此推断所有登录账号、实验组或地区都已迁移。

实测公开样例：

- `https://x.com/BrooklynNets/status/1349794411333394432`：X 托管的 `unified_card` 视频。卡片同时链接 YouTube，但可下载媒体来自 `video.twimg.com`。
- `https://x.com/LisPower1/status/1001551623938805763`：普通视频，元数据提供 MP4 与 HLS。`original_info` 为 640×480，但所提供的最高 MP4/HLS 档位为 480×360，说明不能以预览元数据承诺画质。

## 2. 新旧查询协议

新版公开页面当前使用：

```text
GET https://api.x.com/graphql/{queryId}/{operationName}?variables={JSON}
POST https://api.x.com/graphql/{queryId}/{operationName}
body: { queryId, variables }  // 实际客户端也支持未持久化 query 文本
```

站点当前源码中，查询通常使用 GET，mutation 或显式强制时使用 POST。这里只观察响应中的视频元数据，不生成 mutation。浏览器侧前缀为 `api.x.com/graphql`，站点服务端源码还出现 `api.twitter.com/graphql`。

当次 `TweetResultByRestId` 的 query ID 为 `nAb4iR7t9iSaqeI9fUzDVw`，变量使用 `restId`；`TweetDetail` 的 query ID 为 `b37oyMgjk6rTfU9Re2aFkg`，变量涉及 `focalTweetId`、cursor、rankingMode、referrer。它们只是调研证据，未进入运行配置。

旧版兼容路径：

```text
https://x.com/i/api/graphql/{queryId}/{operationName}
variables={JSON}&features={JSON}&fieldToggles={JSON}
```

独立维护的 yt-dlp 提取器仍展示另一套 `TweetResultByRestId` 查询与 `tweetResult.result` 结果，不能把它的 query ID 当作用户当前页面的请求模板。

## 3. 媒体结构

```text
新版：data.tweet_result_by_rest_id.result.media_entities2[]
旧版：Tweet.legacy.extended_entities.media[]
嵌入：mediaDetails[]
卡片：card.legacy.binding_values[unified_card].value.string_value
      -> JSON -> media_entities
```

```json
{
  "id_str": "1001551417340022785",
  "type": "video",
  "media_url_https": "https://pbs.twimg.com/ext_tw_video_thumb/.../image.jpg",
  "video_info": {
    "duration_millis": 111278,
    "variants": [
      {
        "content_type": "application/x-mpegURL",
        "url": "https://video.twimg.com/ext_tw_video/.../master.m3u8"
      },
      {
        "content_type": "video/mp4",
        "bitrate": 832000,
        "url": "https://video.twimg.com/ext_tw_video/.../480x360/video.mp4"
      }
    ]
  }
}
```

需要处理 `TweetWithVisibilityResults.tweet`、引用和转帖，以及 `TweetUnavailable`/`TweetTombstone`。归属不能只依赖一条响应中第一个 `video_info`。IDs 必须保留字符串，Snowflake 超出 JavaScript 安全整数范围。

新版 SSR 脚本出现 `relayRecords` 映射和 `__ref`/`__refs` 引用；序列化形式含 `$R[n] = {...}`，不是 JSON。页面水合后可能删除 `$R.tsr` 与 `$_TSR`。本实现于 `document_start` 观察新增 script 元素，使用 Acorn 解码允许的数据表达式和 Relay 引用，禁止执行脚本文本。

播放器实测 `currentSrc` 为 `blob:https://x.com/...`，它是 MediaSource 播放状态，不是可保存的完整视频。HLS master 清单提供 `RESOLUTION`、`BANDWIDTH`、`FRAME-RATE` 和 `AUDIO` 组；样例存在独立 AAC 音轨、`EXT-X-MAP` 初始化 MP4 以及 `.m4s` 视频片段。旧 TS 形式也需要支持。

## 4. 鉴权与访问边界

当前站点客户端源码包含 Bearer、会话 Cookie、`ct0`/`x-csrf-token`、`OAuth2Session`、`x-twitter-active-user`、访客令牌刷新、事务 ID 和页面挑战流程。Bearer 的存在不意味着可独立无限查询，也不能把公开脚本中的常量视作稳定授权。

扩展让网页完成正常登录和请求，仅复制允许范围内的响应；不导出凭证，不生成事务签名，不轮换代理或账号，不自动应对挑战。后备详情请求在原 X 页面同会话执行；401、403、429 停止继续尝试公开后备查询。公开嵌入端点可能返回不完整或空结果，不保证受保护内容、所有画质或长期可用。

请求端点：`https://cdn.syndication.twimg.com/tweet-result?id={id}&token={token}`。token 算法与当前 yt-dlp 一致，故意使用 JS Number 转换来符合该端点公式；这不改变内部 ID 的字符串表示。仅用户点击后使用，不周期抓取。

## 5. MV3 约束

- MAIN 世界可以观察页面 fetch/XHR，但没有隔离内容脚本的扩展 API；ISOLATED 世界负责按钮和安全消息。
- 内容脚本仍受页面源的跨域限制。媒体请求由扩展来源执行，且 host permissions 精确列出允许域名。
- Service worker 通常在 30 秒无活动后停止，不能作为长时间音视频合并的唯一执行环境。
- Offscreen document 仅能使用 `chrome.runtime` 扩展 API，因此 Chrome 下载和 storage 写入都由后台执行。
- Worker 中通过 Mediabunny 解析媒体并无损复制编码包到 OPFS；离屏页面创建 File/Blob URL，Chrome 确认保存完成后清理。
- 发布构建只含本地代码，不启用 `eval`、远程模块、远程 WASM 或本机辅助进程。

## 来源

- [当前 X GraphQL transport](https://abs.twimg.com/x-web/x-web/assets/environment-DdwN2g8c.js)
- [当前 TweetResultByRestId](https://abs.twimg.com/x-web/x-web/assets/tweet-result-by-id-CCWRBjCL.js)
- [当前 TweetDetail](https://abs.twimg.com/x-web/x-web/assets/conversation-CRI1GG3M.js)
- [当前请求与鉴权处理](https://abs.twimg.com/x-web/x-web/assets/fetcher-Csafxd3c.js)
- [yt-dlp Twitter/X extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [MV3 remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Mediabunny HLS](https://mediabunny.dev/guide/reading-hls)
- [Mediabunny conversion and forced packet copy](https://mediabunny.dev/guide/converting-media-files)
