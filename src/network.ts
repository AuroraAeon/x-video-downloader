import { boundedText, mediaUrl } from "./security";

export class DownloadError extends Error {
  constructor(
    public code: string,
    message: string,
    public stop = false,
  ) {
    super(message);
  }
}
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMediaFetch(parent: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = mediaUrl(input instanceof Request ? input.url : String(input));
    if (!url)
      throw new DownloadError("UNSAFE_URL", "媒体地址不在允许范围内", true);
    const headers = new Headers();
    const range = new Headers(init?.headers).get("range");
    if (range) headers.set("range", range);
    for (let attempt = 0; attempt < 3; attempt++) {
      parent.throwIfAborted();
      const timeout = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => timeout.abort(new DownloadError("TIMEOUT", "媒体请求超时")),
          20000,
        );
      };
      refresh();
      const signal = AbortSignal.any([
        parent,
        timeout.signal,
        ...(init?.signal ? [init.signal] : []),
      ]);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal,
          cache: "no-store",
        });
        if (response.status === 429)
          throw new DownloadError(
            "RATE_LIMIT",
            "X 媒体服务限流，请稍后重试",
            true,
          );
        if (!response.ok)
          throw new DownloadError(
            String(response.status),
            `媒体服务返回 HTTP ${response.status}`,
          );
        if (response.url && !mediaUrl(response.url))
          throw new DownloadError("UNSAFE_REDIRECT", "媒体重定向被拒绝", true);
        const mime = response.headers.get("content-type") ?? "";
        if (/text\/html|application\/json/i.test(mime))
          throw new DownloadError("BAD_MEDIA", "媒体服务返回了非视频内容");
        if (new URL(url).pathname.endsWith(".m3u8")) {
          const text = await boundedText(response, 1024 * 1024);
          clearTimeout(timer!);
          if (!text.trimStart().startsWith("#EXTM3U"))
            throw new DownloadError("BAD_PLAYLIST", "HLS 清单无效");
          if (
            /#EXT-X-(?:SESSION-)?KEY:[^\r\n]*METHOD=(?!NONE(?:,|\s|$))/i.test(
              text,
            )
          )
            throw new DownloadError(
              "ENCRYPTED",
              "该 HLS 使用加密，不支持无损下载",
            );
          return new Response(text, {
            status: response.status,
            headers: response.headers,
          });
        }
        const reader = response.body?.getReader();
        if (!reader) {
          clearTimeout(timer!);
          throw new DownloadError("EMPTY", "媒体响应为空");
        }
        return new Response(
          new ReadableStream({
            async pull(controller) {
              try {
                const { done, value } = await reader.read();
                refresh();
                if (done) {
                  clearTimeout(timer);
                  controller.close();
                } else controller.enqueue(value);
              } catch (e) {
                clearTimeout(timer);
                controller.error(e);
              }
            },
            cancel(reason) {
              clearTimeout(timer);
              return reader.cancel(reason);
            },
          }),
          { status: response.status, headers: response.headers },
        );
      } catch (e) {
        clearTimeout(timer!);
        if (parent.aborted || init?.signal?.aborted) throw e;
        const err = e as DownloadError;
        if (
          err.stop ||
          (err.code &&
            !["TIMEOUT", "408", "500", "502", "503", "504"].includes(
              err.code,
            )) ||
          attempt === 2
        )
          throw e;
        await sleep([600, 1800][attempt]!);
      }
    }
    throw new DownloadError("NETWORK", "媒体网络请求失败");
  };
}
