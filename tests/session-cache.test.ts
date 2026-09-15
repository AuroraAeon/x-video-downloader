import { it, expect, vi, afterEach } from "vitest";
import { SessionCache } from "../src/session-cache";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("persists completed summaries and plans across worker instances but not partial results", async () => {
  let store: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async () => store,
        set: async (v: Record<string, unknown>) => {
          store = structuredClone(v);
        },
      },
    },
  });
  const a = new SessionCache(),
    plan = { candidates: [], audioCandidates: [], warnings: [] },
    quality = { warnings: [], checkedAt: Date.now() };
  await a.put("partial", { ...quality, pending: true }, plan);
  await a.put("complete", quality, plan);
  const b = new SessionCache();
  await b.restore();
  expect(b.getQuality("partial")).toBeUndefined();
  expect(b.getPlan("complete")).toEqual(plan);
  expect(b.getQuality("complete")).toEqual(quality);
});
it("expires signed download plans sooner than display summaries", async () => {
  vi.stubGlobal("chrome", {
    storage: { session: { get: async () => ({}), set: async () => {} } },
  });
  const now = 1000000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  const cache = new SessionCache();
  await cache.put(
    "x",
    { warnings: [], checkedAt: now },
    { candidates: [], audioCandidates: [], warnings: [] },
  );
  vi.mocked(Date.now).mockReturnValue(now + 180000);
  expect(cache.getPlan("x")).toBeUndefined();
  expect(cache.getQuality("x")).toBeDefined();
  vi.mocked(Date.now).mockReturnValue(now + 1000000);
  expect(cache.getQuality("x")).toBeUndefined();
});
