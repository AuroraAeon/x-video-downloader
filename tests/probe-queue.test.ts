import { afterEach, it, expect, vi } from "vitest";
import { ProbeQueue } from "../src/probes";
import { planKey, type MediaRecord } from "../src/types";
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: any;
  stopped = false;
  messages: any[] = [];
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(m: any) {
    this.messages.push(m);
  }
  terminate() {
    this.stopped = true;
  }
  finish() {
    this.onmessage?.({
      data: {
        type: "result",
        requestId: this.messages.at(-1).requestId,
        result: { candidates: [], audioCandidates: [], warnings: [] },
      },
    });
  }
}
const record = (id: string): MediaRecord => ({
  tweetId: id,
  sourceTweetId: id,
  mediaId: id,
  index: 1,
  author: "a",
  poster: "",
  variants: [],
  animated: false,
  source: "graphql",
  observedAt: 0,
});
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.created = [];
  vi.useRealTimers();
});
function queue() {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  return new ProbeQueue(
    vi.fn(async () => {}),
    () => {},
    () => true,
  );
}
it("runs two lanes, prioritizes visible media, and reuses idle workers", () => {
  const q = queue();
  q.add(record("1"));
  q.add(record("2"));
  q.add(record("3"), 1);
  q.add(record("4"), 0);
  expect(FakeWorker.created).toHaveLength(2);
  FakeWorker.created[0]!.finish();
  expect(FakeWorker.created[0]!.messages.at(-1).record.mediaId).toBe("4");
  FakeWorker.created[0]!.finish();
  expect(FakeWorker.created[0]!.messages.at(-1).record.mediaId).toBe("3");
  expect(FakeWorker.created).toHaveLength(2);
  FakeWorker.created.forEach((w) => w.finish());
});
it("aborts an active offscreen probe when its last unpinned subscriber leaves", () => {
  const q = queue();
  q.add(record("1"));
  q.add(record("2"));
  q.add(record("3"));
  q.remove(planKey(record("1")));
  expect(FakeWorker.created[0]!.stopped).toBe(true);
  expect(FakeWorker.created).toHaveLength(3);
  FakeWorker.created.slice(1).forEach((w) => w.finish());
});
it("keeps a probe that an explicit download is awaiting", async () => {
  const q = queue();
  q.add(record("1"));
  const pending = q.wait(record("1"));
  q.remove(planKey(record("1")));
  expect(FakeWorker.created[0]!.stopped).toBe(false);
  FakeWorker.created[0]!.finish();
  expect(await pending).toEqual({
    candidates: [],
    audioCandidates: [],
    warnings: [],
  });
});
it("does not treat provisional summaries as completed downloadable plans", async () => {
  const q = queue();
  q.add(record("1"));
  const w = FakeWorker.created[0]!;
  w.onmessage?.({
    data: {
      type: "partial",
      requestId: planKey(record("1")),
      quality: { pending: true, warnings: [], checkedAt: Date.now() },
    },
  });
  expect(q.get(record("1"))).toBeUndefined();
  expect(q.busy).toBe(true);
  w.finish();
  expect(q.get(record("1"))).toBeDefined();
});
