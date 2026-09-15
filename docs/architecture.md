# 架构与恢复约定

## 组件

```text
X fetch/XHR -> MAIN observer -> validated media records -> ISOLATED buttons
X SSR scripts -> Acorn data decoder -> Relay expansion -> media records
trusted button click -> background job registry -> offscreen scheduler
offscreen -> media Worker -> CDN -> OPFS -> offscreen File/Blob URL
offscreen -> background -> chrome.downloads -> completion -> cleanup
popup -> background -> list / cancel / retry / clear
visible video -> background -> offscreen probe queue -> media Worker
media plan -> summary cache -> content quality strip and menu
```

`src/types.ts` 定义内部 MediaRecord、Candidate、Job。`src/security.ts` 包含 JSON 大小限制、ID/URL/记录校验与文件名构造；没有面向网页的任意 fetch/download 接口。SSR 解码器只能读取数据节点、受限 `$R` 引用与布尔/负数/undefined 表达式，不能运行调用、getter、模板表达式或一般属性访问。

## 任务状态

正常流程：`queued -> analyzing -> waiting/merging -> saving -> complete`。视频直链 MP4 跳过 waiting/merging；音频总是经过无损提取和 M4A 验证。失败候选重新选择下一档；终态为 complete、failed、cancelled 或 interrupted。任务键包含媒体源 ID、媒体 ID 和 video/audio 类型。

后台将修改串行化，避免 `downloads.onChanged`、弹窗和离屏事件交错覆盖状态。创建离屏文档时去重。离屏文档以两个任务为上限调度，HLS 锁保护同时合并数量；命令立即确认，长操作通过事件上报，避免依赖长期悬挂的后台消息。

Chrome 下载 ID 在启动成功后持久化。后台重启时读取本地任务，向离屏页面查询所有活动 ID，并查询 Chrome 下载状态；已有任务不会重新创建下载。整体浏览器重启后，不存在的媒体处理任务标记为 interrupted，用户可以重试。

## 内存、文件与失败

- 每个 UrlSource 缓存上限为 8 MiB，网络并发为 2；媒体探测按输入依次进行，完成后 dispose。
- HLS 输出为 fragmented MP4，StreamTarget 按 1 MiB 块写入 OPFS，执行流保持背压。
- 所选视频和配对音轨必须能通过 forced copy 无损封装，否则该候选失败；不会把库静默丢弃音轨的结果作为成功。
- 合并后重新打开输出，检查文件非空、分辨率和必要音轨，再交给 Chrome 下载。开发验证另用 ffprobe 检查时长和流信息。
- 文件完成、失败或取消后释放 Blob URL、Worker 和临时文件。新离屏实例清理无所有者的遗留临时文件。没有任务时主动关闭离屏页面。
- 单次请求无数据进展 20 秒超时；可恢复网络错误最多尝试 3 次。任务 RPC 无进展 90 秒超时。401/403/404 不盲目重试，429 停止任务；不同可用版本可自动降级。
- 所有 CDN 请求逐次验证协议、主机和路径，拒绝重定向；不请求 HLS 加密密钥。无法完整比较全部候选时保留警告。

## 页面绑定与维护

1.1.0 使用 28px 毛玻璃按钮和文档级固定定位菜单，菜单不会被播放器的 overflow 裁切。信息栏位于播放器外部，预留两行高度，使用 11px 字号。菜单只响应可信点击；自动检查没有创建下载的权限路径。

IntersectionObserver 对视口附近 180px 的视频安排检查，一次最多一个背景探测、最多排队 40 个；离开视口取消排队。元数据不足时详情回退串行执行，每个播放器身份只自动尝试一次。媒体 URL 改变时失效，结果缓存两分钟。下载复用完成或进行中的探测，避免重复请求。

ProbeQueue 保留当前订阅标签页，后台重启后仍可将结果投递到来源页面。后台和离屏文档分别持有小型信息摘要缓存与媒体候选缓存；未生成的文件不写入 OPFS，也不进入下载任务记录。空闲十五秒后关闭离屏文档。

音频候选由全部音轨独立生成，不以最高视频档位的默认音轨代替最高音质。每条音轨抽取 96 个编码包估计平均码率，显示约等号；相同码率再比较采样率和声道数。输出 forced copy，重新读取检查编码、采样率、声道数及没有视频轨。测试通过编码包哈希逐包比对验证没有重编码。

优先按 poster/媒体 ID 找到唯一媒体，再使用最近帖子链接消歧。没有足够证据时显示错误，不凭 DOM 顺序推测引用帖归属。视频节点被替换、poster 或 src 改变时清理或重新绑定控件。

网络观察与 SSR 解码是可独立维护的入口。站点变化时先更新 fixture 和调研证据，再修改提取器；不要把远程执行、固定 Bearer 或固定 query ID 当作修复方式。扩大权限或更改公开行为时同步更新 manifest、README 和测试。
