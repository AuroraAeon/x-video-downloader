import type { MediaRecord } from "./types";
import { mediaIdFromUrl, posterKey, postUrl } from "./security";

export function identify(
  element: HTMLVideoElement,
  records: MediaRecord[],
): MediaRecord | undefined {
  const poster = posterKey(element.poster),
    id = mediaIdFromUrl(element.poster) ?? mediaIdFromUrl(element.currentSrc);
  let candidates = records.filter(
    (r) =>
      (poster && posterKey(r.poster) === poster) ||
      (id &&
        (r.mediaId === id || mediaIdFromUrl(r.variants[0]?.url ?? "") === id)),
  );
  const ids = postIds(element);
  if (candidates.length > 1) {
    const local = candidates.filter((r) => ids.includes(r.tweetId));
    if (local.length) candidates = local;
  }
  const unique = new Map(
    candidates.map((r) => [`${r.sourceTweetId}:${r.mediaId}`, r]),
  );
  if (unique.size === 1) return [...unique.values()][0];
  // Index alone cannot distinguish a quoted post or a recycled player.
  return;
}
export function postIds(element: Element): string[] {
  let node: Element | null = element.parentElement;
  while (node && node !== document.body) {
    const links = [...node.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((a) => postUrl(a.href))
      .filter(Boolean);
    const ids = [...new Set(links.map((p) => p!.id))];
    if (ids.length) return ids;
    if (node.tagName === "ARTICLE") break;
    node = node.parentElement;
  }
  const current = postUrl(location.href);
  return current ? [current.id] : [];
}
