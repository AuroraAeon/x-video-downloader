import {
  object,
  isId,
  mediaUrl,
  mediaIdFromUrl,
  positive,
  safeJson,
  validateRecord,
} from "./security";
import {
  MAX_RECORDS,
  type MediaRecord,
  type Source,
  type Variant,
} from "./types";

function mediaArray(tweet: Record<string, any>): unknown[] {
  const list =
    tweet.media_entities2 ??
    tweet.legacy?.extended_entities?.media ??
    tweet.extended_entities?.media ??
    tweet.mediaDetails ??
    tweet.legacy?.entities?.media ??
    [];
  const result = Array.isArray(list) ? [...list] : [];
  const card = tweet.card?.legacy ?? tweet.card;
  const bindings = card?.binding_values;
  const unified = Array.isArray(bindings)
    ? bindings.find((v) => v?.key === "unified_card")?.value?.string_value
    : bindings?.unified_card?.string_value;
  if (typeof unified === "string") {
    try {
      const parsed = object(safeJson(unified));
      if (object(parsed?.media_entities))
        result.push(...Object.values(parsed!.media_entities));
    } catch {}
  }
  return result;
}

export function extractMedia(root: unknown, source: Source): MediaRecord[] {
  const stack: unknown[] = [root],
    seen = new WeakSet<object>(),
    result = new Map<string, MediaRecord>();
  let budget = 40000;
  while (stack.length && budget-- > 0 && result.size < MAX_RECORDS) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value.slice(0, 2000));
      continue;
    }
    const tweet = object(value)!;
    const id = tweet.rest_id ?? tweet.id_str;
    if (
      isId(id) &&
      (tweet.__typename === "Tweet" ||
        tweet.mediaDetails ||
        tweet.extended_entities ||
        tweet.legacy ||
        tweet.card)
    ) {
      const author =
        tweet.core?.user_results?.result?.core?.screen_name ??
        tweet.core?.user_results?.result?.legacy?.screen_name ??
        tweet.user?.screen_name ??
        "";
      for (const [i, item] of mediaArray(tweet).slice(0, 20).entries()) {
        const m = object(item);
        if (!m || !["video", "animated_gif"].includes(m.type)) continue;
        const info = object(m.video_info);
        const variants: Variant[] = [];
        for (const v of Array.isArray(info?.variants)
          ? info.variants.slice(0, 24)
          : []) {
          const url = mediaUrl(v?.url);
          if (!url) continue;
          const kind =
            v.content_type === "video/mp4"
              ? "mp4"
              : /mpegurl/i.test(v.content_type ?? "")
                ? "hls"
                : undefined;
          if (!kind) continue;
          const size = new URL(url).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
          variants.push({
            kind,
            url,
            bitrate: positive(v.bitrate),
            width: size ? Number(size[1]) : undefined,
            height: size ? Number(size[2]) : undefined,
          });
        }
        const poster =
          typeof m.media_url_https === "string" ? m.media_url_https : "";
        const mediaId =
          typeof m.id_str === "string"
            ? m.id_str
            : typeof m.media_key === "string"
              ? m.media_key
              : (mediaIdFromUrl(poster) ??
                variants.map((v) => mediaIdFromUrl(v.url)).find(Boolean) ??
                `${id}:${i + 1}`);
        const record = validateRecord({
          tweetId: id,
          sourceTweetId: isId(m.source_status_id_str)
            ? m.source_status_id_str
            : id,
          mediaId,
          author,
          index: i + 1,
          poster,
          durationMs: positive(info?.duration_millis),
          animated: m.type === "animated_gif",
          variants,
          source,
        });
        if (record) result.set(`${id}:${mediaId}`, record);
      }
    }
    for (const [key, child] of Object.entries(tweet)) {
      if (
        !["__proto__", "constructor", "prototype"].includes(key) &&
        child &&
        typeof child === "object"
      )
        stack.push(child);
    }
  }
  return [...result.values()];
}

export function expandRelay(records: Record<string, any>): unknown[] {
  const memo = new Map<string, unknown>();
  let budget = 50000;
  function expand(value: any, depth = 0): any {
    if (depth > 45 || --budget < 0) return;
    if (!value || typeof value !== "object") return value;
    if (typeof value.__ref === "string") {
      const id = value.__ref;
      if (memo.has(id)) return memo.get(id);
      const record = object(records[id]);
      if (!record) return;
      const out: Record<string, unknown> = Object.create(null);
      memo.set(id, out);
      for (const [k, v] of Object.entries(record))
        if (!["__proto__", "constructor", "prototype"].includes(k))
          out[k] = expand(v, depth + 1);
      return out;
    }
    if (Array.isArray(value.__refs))
      return value.__refs
        .slice(0, 2000)
        .map((id: unknown) =>
          typeof id === "string" ? expand({ __ref: id }, depth + 1) : undefined,
        );
    if (Array.isArray(value))
      return value.slice(0, 2000).map((v) => expand(v, depth + 1));
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value))
      if (!["__proto__", "constructor", "prototype"].includes(k))
        out[k] = expand(v, depth + 1);
    return out;
  }
  return Object.entries(records)
    .filter(([, v]) => v?.__typename === "Tweet")
    .slice(0, 500)
    .map(([id]) => expand({ __ref: id }));
}

export function mergeRecord(
  a: MediaRecord | undefined,
  b: MediaRecord,
): MediaRecord {
  if (!a) return b;
  const variants = new Map(
    a.variants.map((v) => {
      const u = new URL(v.url);
      return [`${u.origin}${u.pathname}`, v];
    }),
  );
  for (const v of b.variants) {
    const u = new URL(v.url);
    variants.set(`${u.origin}${u.pathname}`, v);
  }
  return {
    ...a,
    ...b,
    source:
      b.source === "syndication" && a.source !== "syndication"
        ? a.source
        : b.source,
    variants: [...variants.values()].slice(0, 24),
  };
}
