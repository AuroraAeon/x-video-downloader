import { it, expect, afterEach, vi } from "vitest";
import { ProbeSources } from "../src/probe-source";
import { Limiter, mapLimit } from "../src/concurrency";
const url = "https://video.twimg.com/ext_tw_video/123/vid/640x360/a.mp4";
afterEach(() => vi.unstubAllGlobals());
it("limits a probe to 32 KiB and shares overlapping in-flight requests", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(new Uint8Array(32768), {
        status: 206,
        headers: { "content-range": "bytes 0-32767/5000000" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const factory = new ProbeSources(new AbortController().signal),
    a = factory.source(url),
    b = factory.source(url),
    ar = a.ref(),
    br = b.ref();
  try {
    expect(await Promise.all([a.getSize(), b.getSize()])).toEqual([
      5000000, 5000000,
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toBeDefined();
  } finally {
    ar.free();
    br.free();
    factory.dispose();
  }
});
it("retains source data when a library consumer temporarily releases its reference", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(new Uint8Array(64), {
        status: 206,
        headers: { "content-range": "bytes 0-63/64" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const factory = new ProbeSources(new AbortController().signal);
  for (let i = 0; i < 2; i++) {
    const source = factory.source(url),
      ref = source.ref();
    expect(await source.getSize()).toBe(64);
    ref.free();
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  factory.dispose();
});
it("reads a signed playlist over 32 KiB whole, rather than treating its next range as an invalid new playlist", async () => {
  const text = "#EXTM3U\n" + "# comment\n".repeat(5000);
  const fetch = vi.fn(async () => new Response(text));
  vi.stubGlobal("fetch", fetch);
  const f = new ProbeSources(new AbortController().signal),
    s = f.source(
      "https://video.twimg.com/ext_tw_video/123/pl/master.m3u8?tag=3",
    ),
    ref = s.ref();
  try {
    expect(await s.getSize()).toBe(text.length);
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(request[1].headers).has("range")).toBe(false);
  } finally {
    ref.free();
    f.dispose();
  }
});
it.each(["bytes 1-32768/60000", "bytes 0-99999/100000", "not-a-range"])(
  "rejects inconsistent range responses (%s)",
  async (range) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(32768), {
            status: 206,
            headers: { "content-range": range },
          }),
      ),
    );
    const f = new ProbeSources(new AbortController().signal),
      s = f.source(url),
      ref = s.ref();
    try {
      await expect(s.getSize()).rejects.toThrow("Range");
    } finally {
      ref.free();
      f.dispose();
    }
  },
);
it("rejects a truncated range", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array(12), {
          status: 206,
          headers: { "content-range": "bytes 0-32767/60000" },
        }),
    ),
  );
  const f = new ProbeSources(new AbortController().signal),
    s = f.source(url),
    ref = s.ref();
  try {
    await expect(s.getSize()).rejects.toThrow("不完整");
  } finally {
    ref.free();
    f.dispose();
  }
});
it("supports small responses when Range is ignored", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(1000))),
  );
  const f = new ProbeSources(new AbortController().signal),
    s = f.source(url),
    ref = s.ref();
  try {
    expect(await s.getSize()).toBe(1000);
  } finally {
    ref.free();
    f.dispose();
  }
});
it("refuses unbounded non-Range video downloads during inspection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array(12), {
          headers: { "content-length": "90000000" },
        }),
    ),
  );
  const f = new ProbeSources(new AbortController().signal),
    s = f.source(url),
    ref = s.ref();
  try {
    await expect(s.getSize()).rejects.toThrow("Range");
  } finally {
    ref.free();
    f.dispose();
  }
});
it("does not send requests after cancellation", async () => {
  const control = new AbortController();
  control.abort();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const f = new ProbeSources(control.signal),
    s = f.source(url),
    ref = s.ref();
  try {
    await expect(s.getSize()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    ref.free();
    f.dispose();
  }
});
it("limits network concurrency and releases slots on failure", async () => {
  const limiter = new Limiter(2);
  let live = 0,
    max = 0;
  await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      limiter.run(async () => {
        max = Math.max(max, ++live);
        await new Promise((r) => setTimeout(r, 2));
        live--;
        if (i === 1) throw Error("test");
      }),
    ),
  );
  expect(max).toBe(2);
  expect(await limiter.run(async () => 42)).toBe(42);
});
it("waits for already-running inspection work before propagating failures", async () => {
  let complete = false;
  await expect(
    mapLimit([1, 2], 2, async (i) => {
      if (i === 1) throw Error("bad");
      await new Promise((r) => setTimeout(r, 5));
      complete = true;
    }),
  ).rejects.toThrow("bad");
  expect(complete).toBe(true);
});
