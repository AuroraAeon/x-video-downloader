import {
  errorText,
  planKey,
  type MediaPlan,
  type MediaRecord,
  type QualitySummary,
} from "./types";
import { summarize } from "./quality";

export class ProbeQueue {
  private queue = new Map<string, MediaRecord>();
  private cache = new Map<string, { result: MediaPlan; time: number }>();
  private active?: { key: string; worker: Worker };
  private inFlight = new Map<string, Promise<MediaPlan | undefined>>();
  constructor(
    private publish: (key: string, result: QualitySummary) => Promise<unknown>,
    private idle: () => void,
    private canRun: () => boolean,
  ) {}
  get busy() {
    return !!this.active || this.queue.size > 0;
  }
  get(record: MediaRecord) {
    const entry = this.cache.get(planKey(record));
    return entry && Date.now() - entry.time < 120000 ? entry.result : undefined;
  }
  wait(record: MediaRecord) {
    return this.inFlight.get(planKey(record));
  }
  put(record: MediaRecord, result: MediaPlan) {
    const key = planKey(record);
    this.cache.delete(key);
    this.cache.set(key, { result, time: Date.now() });
    while (this.cache.size > 100)
      this.cache.delete(this.cache.keys().next().value!);
  }
  add(record: MediaRecord) {
    const key = planKey(record),
      cached = this.get(record);
    if (cached) {
      void this.publish(key, summarize(cached));
      return true;
    }
    if (this.active?.key === key || this.queue.has(key)) return true;
    if (this.queue.size >= 40) return false;
    this.queue.set(key, record);
    this.pump();
    return true;
  }
  remove(key: string) {
    this.queue.delete(key);
  }
  pump() {
    if (this.active || !this.canRun()) return;
    const next = this.queue.entries().next().value;
    if (!next) {
      this.idle();
      return;
    }
    const [key, record] = next;
    this.queue.delete(key);
    const worker = new Worker("media-worker.js", { type: "module" });
    this.active = { key, worker };
    let resolve!: (result: MediaPlan | undefined) => void;
    this.inFlight.set(
      key,
      new Promise((r) => {
        resolve = r;
      }),
    );
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: QualitySummary) => {
      clearTimeout(timer);
      worker.terminate();
      this.active = undefined;
      resolve(this.get(record));
      this.inFlight.delete(key);
      void this.publish(key, result)
        .catch(() => {})
        .finally(() => this.pump());
    };
    timer = setTimeout(
      () =>
        finish({
          warnings: [],
          checkedAt: Date.now(),
          error: "媒体信息暂不可用",
        }),
      90000,
    );
    worker.onmessage = (e) => {
      if (e.data.type === "result") {
        const plan = e.data.result as MediaPlan;
        this.put(record, plan);
        finish(summarize(plan));
      }
      if (e.data.type === "error")
        finish({ warnings: [], checkedAt: Date.now(), error: e.data.error });
    };
    worker.onerror = (e) =>
      finish({
        warnings: [],
        checkedAt: Date.now(),
        error: errorText(e.message),
      });
    worker.postMessage({ type: "plan", requestId: key, record });
  }
}
