import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaFetch } from "../src/network";
const url = "https://video.twimg.com/ext_tw_video/123/pl/master.m3u8";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("restricted media network", () => {
  it("rejects hostile hosts before making any network request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      createMediaFetch(new AbortController().signal)(
        "https://evil.test/segment.ts",
      ),
    ).rejects.toMatchObject({ stop: true });
    expect(spy).not.toHaveBeenCalled();
  });
  it("strips session headers and refuses redirects", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(new Response("#EXTM3U\n#EXT-X-ENDLIST"));
    vi.stubGlobal("fetch", spy);
    await createMediaFetch(new AbortController().signal)(url, {
      headers: {
        authorization: "private",
        "x-csrf-token": "private",
        range: "bytes=0-999",
      },
    });
    const init = spy.mock.calls[0]![1];
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect([...init.headers.keys()]).toEqual(["range"]);
  });
  it.each([401, 403, 404, 429])("bounds HTTP %s failures", async (status) => {
    const spy = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", spy);
    await expect(
      createMediaFetch(new AbortController().signal)(url),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("retries a temporary server failure a finite number of times", async () => {
    vi.useFakeTimers();
    const spy = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", spy);
    const promise = expect(
      createMediaFetch(new AbortController().signal)(url),
    ).rejects.toThrow("503");
    await vi.runAllTimersAsync();
    await promise;
    expect(spy).toHaveBeenCalledTimes(3);
  });
  it.each([
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.test/key"',
    '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"',
  ])("refuses encrypted playlists without fetching a key", async (body) => {
    const spy = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", spy);
    await expect(
      createMediaFetch(new AbortController().signal)(url),
    ).rejects.toThrow("加密");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("rejects HTML error content even if the response says HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>login</html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(
      createMediaFetch(new AbortController().signal)(url),
    ).rejects.toThrow("非视频");
  });
  it("cancels oversized playlist reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          () => new Response("#EXTM3U\n" + "a".repeat(1024 * 1024)),
        ),
    );
    await expect(
      createMediaFetch(new AbortController().signal)(url),
    ).rejects.toThrow("过大");
  });
  it("respects cancellation before any request", async () => {
    const control = new AbortController();
    control.abort();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(createMediaFetch(control.signal)(url)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
