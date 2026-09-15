import { CustomPathedSource, CustomSource, type SourceRef } from "mediabunny";
import { mediaUrl } from "./security";
import { createMediaFetch, DownloadError } from "./network";
import { Limiter } from "./concurrency";

const BLOCK = 32 * 1024,
  MAX_FILE = 4 * 1024 * 1024,
  MAX_TOTAL = 16 * 1024 * 1024;
/** Probing needs sample tables and fragment headers, not video payload prefetch. */
export class ProbeSources {
  private readonly fetcher: typeof fetch;
  private readonly limiter: Limiter;
  private files = new Map<string, ReturnType<ProbeSources["file"]>>();
  private pins: SourceRef[] = [];
  private lifetime = new AbortController();
  private total = 0;
  private signal: AbortSignal;
  constructor(parent: AbortSignal, limiter = new Limiter(4)) {
    this.limiter = limiter;
    this.signal = AbortSignal.any([parent, this.lifetime.signal]);
    this.fetcher = createMediaFetch(this.signal, {
      attempts: 1,
      timeoutMs: 8000,
    });
  }
  source(url: string) {
    return new CustomPathedSource(url, (request) => {
      const path = mediaUrl(String(request.path));
      if (!path)
        throw new DownloadError("UNSAFE_URL", "媒体地址不在允许范围内", true);
      let file = this.files.get(path);
      if (!file) {
        file = this.file(path);
        this.files.set(path, file);
        this.pins.push(file.ref());
      }
      // Resolve the root synchronously: CustomPathedSource's pending-root disposal
      // does not handle rejected promises. Child playlists must expose size first.
      return request.isRoot ? file : file.getSize().then(() => file);
    });
  }
  dispose() {
    this.lifetime.abort();
    for (const pin of this.pins) pin.free();
    this.pins = [];
    this.files.clear();
  }
  private file(url: string): CustomSource {
    const playlist = new URL(url).pathname.endsWith(".m3u8");
    // A playlist is small; parse it once and retain an in-flight promise.
    let size = 0,
      whole: Uint8Array | undefined;
    const blocks = new Map<number, Promise<Uint8Array>>();
    const load = (index: number): Promise<Uint8Array> => {
      let pending = blocks.get(index);
      if (pending) return pending;
      pending = this.limiter.run(async () => {
        const start = index * BLOCK,
          end = start + BLOCK - 1;
        const response = await this.fetcher(
          url,
          playlist ? {} : { headers: { Range: `bytes=${start}-${end}` } },
        );
        const range = response.headers
          .get("content-range")
          ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (response.status === 206) {
          if (
            !range ||
            Number(range[1]) !== start ||
            Number(range[2]) > end ||
            !Number.isSafeInteger(Number(range[3])) ||
            Number(range[3]) <= Number(range[2])
          ) {
            void response.body?.cancel();
            throw Error("媒体 Range 响应无效");
          }
          const bytes = await readBytes(response, BLOCK);
          size = Number(range[3]);
          if (bytes.length !== Number(range[2]) - start + 1)
            throw Error("媒体响应不完整");
          this.total += bytes.length;
          if (this.total > MAX_TOTAL) throw Error("媒体头部探测超出读取预算");
          return bytes;
        }
        // Some CDNs ignore Range. Accept only a bounded small file; never buffer a long video.
        const bytes = await readBytes(
          response,
          playlist ? 1024 * 1024 : MAX_FILE,
        );
        this.total += bytes.length;
        if (this.total > MAX_TOTAL) throw Error("媒体头部探测超出读取预算");
        size = bytes.length;
        whole = bytes;
        return bytes.slice(start, end + 1);
      }, this.signal);
      blocks.set(index, pending);
      return pending;
    };
    return new CustomSource({
      getSize: async () => {
        await load(0);
        return size;
      },
      read: async (start, end) => {
        this.signal.throwIfAborted();
        if (whole) return whole.subarray(start, end);
        const first = Math.floor(start / BLOCK),
          last = Math.floor((end - 1) / BLOCK),
          parts: Uint8Array[] = [];
        for (let i = first; i <= last; i++) parts.push(await load(i));
        const result = new Uint8Array(end - start);
        let offset = 0;
        for (let i = first; i <= last; i++) {
          const from = Math.max(start, i * BLOCK) - i * BLOCK,
            to = Math.min(end, (i + 1) * BLOCK) - i * BLOCK;
          const part = parts[i - first]!.subarray(from, to);
          result.set(part, offset);
          offset += part.length;
        }
        return result;
      },
      maxCacheSize: 1024 * 1024,
      prefetchProfile: "none",
      handleUnhandledError: () => {},
    });
  }
}
async function readBytes(response: Response, limit: number) {
  const length = Number(response.headers.get("content-length"));
  if (length > limit) {
    void response.body?.cancel();
    throw Error("服务器未提供受限 Range 读取");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("空媒体响应");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("媒体探测响应过大");
      parts.push(value);
    }
  } catch (e) {
    void reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
