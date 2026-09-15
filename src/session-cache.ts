import {
  PLAN_TTL,
  QUALITY_TTL,
  type MediaPlan,
  type QualitySummary,
} from "./types";
interface Entry {
  quality: QualitySummary;
  plan?: MediaPlan;
  planTime?: number;
}
/** Session storage survives extension-worker suspension, never crosses a browser session. */
export class SessionCache {
  private entries = new Map<string, Entry>();
  private writing: Promise<unknown> = Promise.resolve();
  async restore() {
    const data = await chrome.storage.session.get("mediaCacheV2");
    for (const [key, entry] of Array.isArray(data.mediaCacheV2)
      ? data.mediaCacheV2
      : []) {
      if (
        typeof key === "string" &&
        entry?.quality &&
        Date.now() - entry.quality.checkedAt < QUALITY_TTL
      )
        this.entries.set(key, entry);
    }
  }
  getQuality(key: string) {
    const e = this.entries.get(key);
    return e &&
      Date.now() - e.quality.checkedAt < (e.quality.error ? 30000 : QUALITY_TTL)
      ? e.quality
      : undefined;
  }
  getPlan(key: string) {
    const e = this.entries.get(key);
    return e?.plan && Date.now() - (e.planTime ?? 0) < PLAN_TTL
      ? e.plan
      : undefined;
  }
  async put(key: string, quality: QualitySummary, plan?: MediaPlan) {
    if (quality.pending) return;
    this.entries.delete(key);
    this.entries.set(key, {
      quality,
      plan,
      planTime: plan ? Date.now() : undefined,
    });
    while (this.entries.size > 128)
      this.entries.delete(this.entries.keys().next().value!);
    await this.flush();
  }
  private async flush() {
    const entries = [...this.entries.entries()];
    let budget = 0;
    const saved = entries
      .reverse()
      .filter(([key, e]) => {
        if (e.planTime && Date.now() - e.planTime > PLAN_TTL) {
          delete e.plan;
          delete e.planTime;
        }
        const size = JSON.stringify([key, e]).length * 2;
        if (budget + size > 4 * 1024 * 1024) return false;
        budget += size;
        return true;
      })
      .reverse();
    this.writing = this.writing
      .catch(() => {})
      .then(() => chrome.storage.session.set({ mediaCacheV2: saved }));
    await this.writing;
  }
}
