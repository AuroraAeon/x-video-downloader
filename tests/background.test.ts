import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WATCHER_TTL } from "../src/types";

const ID = "aaaabbbbccccddddeeeeffffgggghhhh";
const BASE = `chrome-extension://${ID}/`;

interface Stub {
  listeners: {
    runtime: ((
      m: any,
      sender: chrome.runtime.MessageSender,
      reply: (r: unknown) => void,
    ) => boolean | undefined)[];
    tabRemoved: ((tabId: number) => void)[];
  };
  offscreenAlive: { value: boolean };
  toOffscreen: any[];
  localGet: { failing: boolean };
}

function stubChrome(): Stub {
  const stub: Stub = {
    listeners: { runtime: [], tabRemoved: [] },
    offscreenAlive: { value: false },
    toOffscreen: [],
    localGet: { failing: false },
  };
  const storage = {
    local: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
  };
  (globalThis as any).chrome = {
    runtime: {
      id: ID,
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getURL: (path: string) => `${BASE}${path}`,
      getContexts: async () =>
        stub.offscreenAlive.value
          ? [{ contextType: "OFFSCREEN_DOCUMENT" }]
          : [],
      onMessage: { addListener: (fn: any) => stub.listeners.runtime.push(fn) },
      onStartup: { addListener: () => {} },
      sendMessage: async (message: any) => {
        stub.toOffscreen.push(message);
        // The offscreen document accepts the inspection but publishes nothing,
        // which is what an abandoned probe looks like from the background side.
        if (message.type === "PROBE") return { ok: true };
        if (message.type === "STATUS") return { ids: [], probing: false };
        return { ok: true };
      },
    },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => {
          if (stub.localGet.failing) throw Error("storage unavailable");
          return structuredClone(storage.local);
        },
        set: async (value: Record<string, unknown>) =>
          Object.assign(storage.local, structuredClone(value)),
      },
      session: {
        get: async (key: string) => structuredClone(storage.session[key] ?? {}),
        set: async (value: Record<string, unknown>) =>
          Object.assign(storage.session, structuredClone(value)),
      },
      onChanged: { addListener: () => {} },
    },
    offscreen: {
      Reason: { BLOBS: "BLOBS", WORKERS: "WORKERS" },
      createDocument: async () => {
        stub.offscreenAlive.value = true;
      },
      closeDocument: async () => {
        stub.offscreenAlive.value = false;
      },
    },
    tabs: {
      sendMessage: async () => {},
      onRemoved: {
        addListener: (fn: any) => stub.listeners.tabRemoved.push(fn),
      },
    },
    downloads: {
      download: async () => 1,
      search: async () => [],
      cancel: async () => {},
      onChanged: { addListener: () => {} },
    },
  };
  return stub;
}

const record = (n: number) => ({
  tweetId: `1${String(n).padStart(18, "0")}`,
  sourceTweetId: `1${String(n).padStart(18, "0")}`,
  mediaId: `9${String(n).padStart(18, "0")}`,
  author: "tester",
  index: 1,
  poster: "",
  animated: false,
  source: "graphql",
  variants: [
    {
      kind: "mp4",
      url: `https://video.twimg.com/ext_tw_video/${n}/mp4/avc/1280x720.mp4`,
      bitrate: 2_500_000,
      width: 1280,
      height: 720,
    },
  ],
});

const contentSender = (tabId: number): chrome.runtime.MessageSender =>
  ({
    id: ID,
    frameId: 0,
    tab: { id: tabId },
    url: "https://x.com/tester/status/123",
  }) as any;
const popupSender = (): chrome.runtime.MessageSender =>
  ({ id: ID, url: `${BASE}popup.html` }) as any;

async function send(
  stub: Stub,
  message: unknown,
  sender: chrome.runtime.MessageSender,
) {
  return new Promise<any>((resolve) => {
    const listener = stub.listeners.runtime[0]!;
    if (!listener(message, sender, resolve)) resolve(undefined);
  });
}

let stub: Stub;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
  stub = stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).chrome;
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  const mod: any = await import("../src/background");
  await vi.runAllTimersAsync();
  return mod;
}

describe("message source trust", () => {
  test("only own-context frame zero x.com pages are content senders", async () => {
    const { content } = await load();
    expect(content(contentSender(1))).toBe(true);
    expect(content({ ...contentSender(1), id: "other" })).toBe(false);
    expect(content({ ...contentSender(1), frameId: 1 })).toBe(false);
    expect(content({ ...contentSender(1), url: "https://evil.example/x" })).toBe(
      false,
    );
    expect(content({ id: ID, frameId: 0, url: "https://x.com/" })).toBe(false);
    expect(content({ ...contentSender(1), url: "not a url" })).toBe(false);
  });

  test("extension pages are only trusted for their own document", async () => {
    const { internal } = await load();
    expect(internal(popupSender(), "popup.html")).toBe(true);
    expect(internal(popupSender(), "offscreen.html")).toBe(false);
    expect(
      internal(
        { id: "other", url: `${BASE}popup.html` } as any,
        "popup.html",
      ),
    ).toBe(false);
  });

  test("a web page cannot start a download or clear the queue", async () => {
    await load();
    const forged = {
      id: ID,
      frameId: 0,
      tab: { id: 3 },
      url: "https://evil.example/x",
    } as chrome.runtime.MessageSender;
    expect(
      (await send(stub, { type: "START", record: record(1), mode: "video" }, forged))
        .error,
    ).toBe("Message source is not trusted");
    // A content script has no path to the queue-clearing action.
    expect((await send(stub, { type: "CLEAR" }, contentSender(3))).ok).toBe(
      false,
    );
    expect((await send(stub, { type: "CLEAR" }, popupSender())).ok).toBe(true);
  });
});

describe("worker recovery", () => {
  test("a startup storage failure does not disable later operations", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    stub.localGet.failing = true;
    await load();
    stub.localGet.failing = false;
    // Recovery has to be visible, not just survivable.
    expect(reported).toHaveBeenCalledOnce();
    const list = await send(stub, { type: "LIST" }, popupSender());
    expect(list.ok).toBe(true);
    const probe = await send(
      stub,
      { type: "PROBE", record: record(7) },
      contentSender(1),
    );
    expect(probe.ok).toBe(true);
    const start = await send(
      stub,
      { type: "START", record: record(7), mode: "video" },
      contentSender(1),
    );
    expect(start.ok).toBe(true);
  });
});

describe("probe watcher accounting", () => {
  async function abandonProbes(count: number) {
    for (let i = 1; i <= count; i++)
      expect(
        (await send(
          stub,
          { type: "PROBE", record: record(i) },
          contentSender(i),
        ))?.ok,
      ).toBe(true);
  }

  test("closed tabs stop consuming watcher slots", async () => {
    await load();
    await abandonProbes(100);
    expect(
      (await send(stub, { type: "PROBE", record: record(900) }, contentSender(500)))
        .ok,
    ).toBe(false);

    expect(stub.listeners.tabRemoved.length).toBe(1);
    for (let i = 1; i <= 100; i++) stub.listeners.tabRemoved[0]!(i);
    await vi.runAllTimersAsync();

    const reopened = await send(
      stub,
      { type: "PROBE", record: record(900) },
      contentSender(500),
    );
    expect(reopened.ok).toBe(true);
    expect(stub.toOffscreen).toContainEqual(
      expect.objectContaining({ type: "FORGET_TAB", tabId: 1 }),
    );
  });

  test("abandoned watchers expire without a tab close event", async () => {
    await load();
    await abandonProbes(100);
    const blocked = await send(
      stub,
      { type: "PROBE", record: record(900) },
      contentSender(500),
    );
    expect(blocked.ok).toBe(false);
    vi.setSystemTime(Date.now() + WATCHER_TTL + 1000);
    const later = await send(
      stub,
      { type: "PROBE", record: record(900) },
      contentSender(500),
    );
    expect(later.ok).toBe(true);
  });
});
