import {
  errorText,
  planKey,
  PLAN_TTL,
  type MediaPlan,
  type MediaRecord,
  type QualitySummary,
} from "./types";
import { summarize } from "./quality";
interface Queued {
  record: MediaRecord;
  priority: number;
  sequence: number;
}
interface Running {
  worker: Worker;
  promise: Promise<MediaPlan | undefined>;
  pinned: boolean;
  stop: () => void;
}
/** Two independent lanes avoid head-of-line blocking; visible media outranks prefetch. */
export class ProbeQueue {
  private queue = new Map<string, Queued>();
  private cache = new Map<string, { result: MediaPlan; time: number }>();
  private active = new Map<string, Running>();
  private workers: Worker[] = [];
  private sequence = 0;
  constructor(
    private publish: (
      key: string,
      result: QualitySummary,
      plan?: MediaPlan,
    ) => Promise<unknown>,
    private idle: () => void,
    private canRun: () => boolean,
  ) {}
  get busy() {
    return this.active.size > 0 || this.queue.size > 0;
  }
  get(record: MediaRecord) {
    const value = this.cache.get(planKey(record));
    return value && Date.now() - value.time < PLAN_TTL
      ? value.result
      : undefined;
  }
  wait(record: MediaRecord) {
    const active = this.active.get(planKey(record));
    if (active) active.pinned = true;
    return active?.promise;
  }
  put(record: MediaRecord, result: MediaPlan) {
    const key = planKey(record);
    this.queue.delete(key);
    this.cache.delete(key);
    this.cache.set(key, { result, time: Date.now() });
    while (this.cache.size > 64)
      this.cache.delete(this.cache.keys().next().value!);
  }
  add(record: MediaRecord, priority = 0) {
    const key = planKey(record),
      cached = this.get(record);
    if (cached) {
      void this.publish(key, summarize(cached), cached).catch(() => {});
      return true;
    }
    if (this.active.has(key)) return true;
    if (this.queue.size >= 40 && !this.queue.has(key)) return false;
    this.queue.set(key, { record, priority, sequence: ++this.sequence });
    this.pump();
    return true;
  }
  remove(key: string) {
    this.queue.delete(key);
    const active = this.active.get(key);
    if (active && !active.pinned) active.stop();
  }
  pump() {
    while (this.active.size < 2 && this.canRun() && this.queue.size) {
      const [key, item] = [...this.queue.entries()].sort(
        ([, a], [, b]) => a.priority - b.priority || b.sequence - a.sequence,
      )[0]!;
      this.queue.delete(key);
      this.start(key, item.record);
    }
    if (!this.busy) this.idle();
  }
  private start(key: string, record: MediaRecord) {
    const worker =
      this.workers.pop() ?? new Worker("media-worker.js", { type: "module" });
    let resolve!: (result: MediaPlan | undefined) => void,
      ended = false;
    const promise = new Promise<MediaPlan | undefined>((r) => {
      resolve = r;
    });
    const finish = (
      quality?: QualitySummary,
      plan?: MediaPlan,
      reusable = true,
    ) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      this.active.delete(key);
      if (reusable && this.workers.length < 2) this.workers.push(worker);
      else worker.terminate();
      if (plan) this.put(record, plan);
      resolve(plan);
      if (quality) void this.publish(key, quality, plan).catch(() => {});
      this.pump();
    };
    const timer = setTimeout(
      () =>
        finish(
          { warnings: [], checkedAt: Date.now(), error: "媒体信息暂不可用" },
          undefined,
          false,
        ),
      20000,
    );
    this.active.set(key, {
      worker,
      promise,
      pinned: false,
      stop: () => finish(undefined, undefined, false),
    });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.requestId !== key) return;
      if (m.type === "partial")
        void this.publish(key, m.quality).catch(() => {});
      if (m.type === "result") {
        const plan = m.result as MediaPlan;
        finish(summarize(plan), plan);
      }
      if (m.type === "error")
        finish(
          { warnings: [], checkedAt: Date.now(), error: m.error },
          undefined,
          false,
        );
    };
    worker.onerror = (e) =>
      finish(
        { warnings: [], checkedAt: Date.now(), error: errorText(e.message) },
        undefined,
        false,
      );
    worker.postMessage({ type: "plan", requestId: key, record });
  }
}
