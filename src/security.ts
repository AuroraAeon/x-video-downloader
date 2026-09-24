import { t } from "./i18n";
import {
  MAX_JSON,
  extensionOf,
  type DownloadMode,
  type MediaRecord,
} from "./types";
export const object = (v: unknown): Record<string, any> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : undefined;
export const isId = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,25}$/.test(v);
export function safeJson(text: string): unknown {
  if (text.length > MAX_JSON) throw Error(t("errTooLarge"));
  return JSON.parse(text);
}
export function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      u.hostname === "video.twimg.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      /^\/(?:ext_tw_video|amplify_video|tweet_video)\//.test(u.pathname)
    )
      return u.href;
  } catch {}
}
export function posterKey(value: string): string {
  try {
    const u = new URL(value);
    return u.hostname === "pbs.twimg.com"
      ? `${u.origin}${u.pathname.replace(/:(?:small|large|orig|medium)$/, "")}`
      : "";
  } catch {
    return "";
  }
}
export function mediaIdFromUrl(value: string): string | undefined {
  try {
    return new URL(value).pathname.match(
      /\/(?:ext_tw_video|amplify_video)(?:_thumb)?\/(\d+)\//,
    )?.[1];
  } catch {
    return;
  }
}
export function postUrl(
  value: string,
): { id: string; url: string; index?: number } | undefined {
  try {
    const u = new URL(value, "https://x.com");
    const m = u.pathname.match(
      /^\/([\w]+)\/(?:web\/)?status\/(\d{1,25})(?:\/video\/(\d+))?\/?$/,
    );
    if (u.origin !== "https://x.com" || !m || !m[2]) return;
    return {
      id: m[2],
      url: `https://x.com/${m[1]}/status/${m[2]}`,
      index: m[3] ? Number(m[3]) : undefined,
    };
  } catch {
    return;
  }
}
export function graphUrl(value: string): boolean {
  try {
    const u = new URL(value, "https://x.com");
    return (
      u.protocol === "https:" &&
      ["x.com", "api.x.com", "api.twitter.com"].includes(u.hostname) &&
      /^\/(?:i\/api\/)?graphql\/[^/]+\/[^/]+$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export async function boundedText(
  response: Response,
  limit = MAX_JSON,
  signal?: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error(t("errTooLarge"));
      text += decoder.decode(value, { stream: true });
    }
    // Cancelling a locked reader ends the read early instead of rejecting it.
    if (signal?.aborted) throw Error(t("errReadCancelled"));
    return text + decoder.decode();
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
export function validateRecord(value: unknown): MediaRecord | undefined {
  const r = object(value);
  if (
    !r ||
    !isId(r.tweetId) ||
    !isId(r.sourceTweetId) ||
    typeof r.mediaId !== "string" ||
    !/^[\w:-]{1,100}$/.test(r.mediaId) ||
    typeof r.author !== "string" ||
    !/^\w{0,40}$/.test(r.author) ||
    !Number.isInteger(r.index) ||
    r.index < 1 ||
    r.index > 20 ||
    typeof r.poster !== "string" ||
    r.poster.length > 4096 ||
    !Array.isArray(r.variants) ||
    r.variants.length > 24 ||
    !["graphql", "ssr", "initial", "syndication"].includes(r.source)
  )
    return;
  const variants = r.variants.flatMap((v: unknown) => {
    const x = object(v);
    const url = mediaUrl(x?.url);
    if (!x || !url || !["mp4", "hls"].includes(x.kind)) return [];
    return [
      {
        kind: x.kind,
        url,
        bitrate: positive(x.bitrate),
        width: positive(x.width),
        height: positive(x.height),
      },
    ];
  });
  if (!variants.length) return;
  return {
    tweetId: r.tweetId,
    sourceTweetId: r.sourceTweetId,
    mediaId: r.mediaId,
    author: r.author,
    index: r.index,
    poster: posterKey(r.poster),
    durationMs: positive(r.durationMs),
    animated: r.animated === true,
    variants,
    source: r.source,
    observedAt: Date.now(),
  };
}
export function positive(v: unknown): number | undefined {
  return typeof v === "number" &&
    Number.isFinite(v) &&
    v > 0 &&
    v < Number.MAX_SAFE_INTEGER
    ? v
    : undefined;
}
export function filename(
  record: MediaRecord,
  label: string,
  mode: DownloadMode = "video",
): string {
  return `x_${record.author || "user"}_${record.tweetId}_${record.index}_${label}.${extensionOf(mode)}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 220);
}
