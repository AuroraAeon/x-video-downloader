import { t } from "./i18n";
import {
  ACTIVE,
  ALL_STATES,
  WATCHER_TTL,
  errorText,
  jobKey,
  planKey,
  type Candidate,
  type Job,
  type QualitySummary,
} from "./types";
import {
  boundedText,
  filename,
  isId,
  mediaUrl,
  safeJson,
  validateRecord,
} from "./security";
import { extractMedia } from "./extract";
import { SessionCache } from "./session-cache";

const jobs = new Map<string, Job>();
const cache = new SessionCache();
const watchers = new Map<string, Map<number, number>>();
const MAX_WATCHERS = 100;
let creating: Promise<void> | undefined;
let serial: Promise<unknown> = Promise.resolve();
const stage = async (label: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (e) {
    // A rejected gate promise would fail every later handler for the whole
    // worker lifetime, so each recovery step degrades on its own.
    console.error(`[xvd] ${label}失败`, e);
  }
};
const ready = (async () => {
  await stage("会话缓存恢复", async () => {
    await cache.restore();
  });
  await stage("存储权限收紧", async () => {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
  await stage("历史任务恢复", async () => {
    const data = await chrome.storage.local.get("jobs");
    for (const job of Array.isArray(data.jobs) ? data.jobs : [])
      if (job?.id && validateRecord(job.record)) {
        job.mode ??= "video";
        // A worker restart leaves no live owner, and states written by another
        // version must not reach the popup or content label maps.
        if (!ALL_STATES.includes(job.state)) {
          job.state = "interrupted";
          job.error ??= t("errRestarted");
        }
        job.warnings ??= [];
        job.progress = typeof job.progress === "number" ? job.progress : 0;
        job.key = jobKey(job.record, job.mode);
        jobs.set(job.id, job);
      }
  });
})();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = serial.then(() => ready).then(fn);
  serial = next.catch(() => {});
  return next;
};
const offscreen = (message: object) =>
  chrome.runtime.sendMessage({ target: "offscreen", ...message });
async function contexts() {
  return chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
}
async function ensureOffscreen() {
  if ((await contexts()).length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS],
      justification:
        "Read HLS video and audio in a worker, stream a lossless MP4 to local storage, and keep its Blob URL alive until Chrome finishes saving.",
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}
async function persist() {
  const finished = [...jobs.values()]
    .filter((j) => !ACTIVE.has(j.state))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const job of finished.slice(60)) jobs.delete(job.id);
  await chrome.storage.local.set({ jobs: [...jobs.values()] });
}
async function patch(job: Job, values: Partial<Job>) {
  Object.assign(job, values, { updatedAt: Date.now() });
  await persist();
  if (job.tabId !== undefined)
    void chrome.tabs
      .sendMessage(job.tabId, { type: "JOB", job })
      .catch(() => {});
}
function nativeStatus(item: chrome.downloads.DownloadItem) {
  return item.state === "complete"
    ? { ok: true }
    : item.state === "interrupted"
      ? { ok: false, error: item.error ?? t("errInterrupted") }
      : undefined;
}
async function reconcile() {
  const exists = (await contexts()).length > 0;
  const live = exists
    ? await offscreen({ type: "STATUS" }).catch(() => ({ ids: [] }))
    : { ids: [] };
  for (const job of jobs.values()) {
    if (!ACTIVE.has(job.state)) continue;
    if (job.downloadId !== undefined) {
      const item = (await chrome.downloads.search({ id: job.downloadId }))[0];
      if (item) {
        const outcome = nativeStatus(item);
        if (!outcome) continue;
        if (live.ids?.includes(job.id)) {
          await offscreen({
            type: "NATIVE",
            id: job.id,
            outcome,
            candidateId: job.candidate?.id,
          });
          continue;
        }
        await patch(job, {
          state: outcome.ok ? "complete" : "interrupted",
          error: outcome.error,
          progress: outcome.ok ? 1 : job.progress,
        });
        continue;
      }
    }
    if (!live.ids?.includes(job.id))
      await patch(job, {
        state: "interrupted",
        error: t("errRestarted"),
      });
  }
}
/**
 * Drop watcher records nobody will notify again. Without this the admission
 * counter below only ever grew, so enough abandoned tabs permanently disabled
 * inline quality for every later video in the worker's lifetime.
 */
export function pruneWatchers(
  watchers: Map<string, Map<number, number>>,
  tabId?: number,
  now = Date.now(),
): string[] {
  const dropped: string[] = [];
  for (const [key, tabs] of watchers) {
    if (tabId !== undefined) tabs.delete(tabId);
    for (const [id, seen] of tabs)
      if (now - seen >= WATCHER_TTL) tabs.delete(id);
    if (!tabs.size) {
      watchers.delete(key);
      dropped.push(key);
    }
  }
  return dropped;
}
export function internal(sender: chrome.runtime.MessageSender, path: string) {
  return (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL(path)
  );
}
export function content(sender: chrome.runtime.MessageSender) {
  try {
    return (
      sender.id === chrome.runtime.id &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      new URL(sender.url ?? "").origin === "https://x.com"
    );
  } catch {
    return false;
  }
}
async function handle(
  m: any,
  sender: chrome.runtime.MessageSender,
): Promise<any> {
  const fromContent = content(sender),
    fromPopup = internal(sender, "popup.html"),
    fromOffscreen = internal(sender, "offscreen.html");
  if (fromOffscreen && m.target === "background") {
    if (m.type === "IDLE") {
      const active = await offscreen({ type: "STATUS" });
      if (
        !active.ids?.length &&
        !active.probing &&
        ![...jobs.values()].some((j) => ACTIVE.has(j.state))
      )
        await chrome.offscreen.closeDocument();
      return { ok: true };
    }
    if (m.type === "QUALITY_RESULT") {
      // Cache storage failure must not suppress a completed inspection result.
      await cache.put(m.key, m.quality, m.plan).catch(() => {});
      const tabIds = new Set<number>(
        (Array.isArray(m.tabIds) ? m.tabIds : []).filter(Number.isInteger),
      );
      for (const [tabId, time] of watchers.get(m.key) ?? [])
        if (Date.now() - time < WATCHER_TTL) tabIds.add(tabId);
      for (const tabId of tabIds)
        void chrome.tabs
          .sendMessage(tabId, {
            type: "QUALITY",
            key: m.key,
            quality: m.quality,
          })
          .catch(() => {});
      if (!m.quality.pending) watchers.delete(m.key);
      return { ok: true };
    }
    const job = jobs.get(m.id);
    if (!job || !ACTIVE.has(job.state))
      return { ok: false, error: t("errTaskFinished"), stop: true };
    if (m.type === "EVENT") {
      const p = m.patch;
      if (p.candidate && p.candidate.id !== job.candidate?.id) {
        delete job.downloadId;
        delete job.filename;
      }
      await patch(job, {
        ...p,
        id: job.id,
        key: job.key,
        record: job.record,
        createdAt: job.createdAt,
        tabId: job.tabId,
      });
      return { ok: true };
    }
    if (m.type === "DOWNLOAD") {
      const candidate = m.candidate as Candidate;
      const url =
        candidate.kind === "mp4" && job.mode === "video"
          ? mediaUrl(m.url)
          : typeof m.url === "string" &&
              m.url.startsWith(
                `blob:${chrome.runtime.getURL("").replace(/\/$/, "")}/`,
              )
            ? m.url
            : undefined;
      if (
        !url ||
        (candidate.kind === "mp4" &&
          job.mode === "video" &&
          url !== candidate.url)
      )
        return { ok: false, error: t("errUrlValidation"), stop: true };
      const name = filename(job.record, candidate.label, job.mode);
      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: name,
          conflictAction: "uniquify",
          saveAs: false,
        });
        const started = (await chrome.downloads.search({ id: downloadId }))[0];
        if (
          candidate.kind === "mp4" &&
          job.mode === "video" &&
          started?.finalUrl &&
          !mediaUrl(started.finalUrl)
        ) {
          await chrome.downloads.cancel(downloadId).catch(() => {});
          return {
            ok: false,
            error: t("errRedirectBlocked"),
            stop: true,
          };
        }
        await patch(job, {
          state: "saving",
          downloadId,
          filename: name,
          candidate,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorText(e) };
      }
    }
  }
  if (!fromContent && !fromPopup)
    return { ok: false, error: t("errUntrustedSender") };
  if (m.type === "PROBE" && fromContent) {
    const record = validateRecord(m.record);
    if (!record) return { ok: false, error: t("errInvalidMetadata") };
    const key = planKey(record),
      cached = cache.getQuality(key);
    if (cached) return { ok: true, quality: cached, key };
    pruneWatchers(watchers);
    if (watchers.size >= MAX_WATCHERS && !watchers.has(key))
      return { ok: false, error: t("errBusyInspecting") };
    const tabs = watchers.get(key) ?? new Map<number, number>();
    tabs.set(sender.tab!.id!, Date.now());
    watchers.set(key, tabs);
    await ensureOffscreen();
    const reply = await offscreen({
      type: "PROBE",
      record,
      key,
      tabId: sender.tab!.id,
      priority: m.priority === 1 ? 1 : 0,
    });
    if (!reply?.ok) watchers.delete(key);
    return { ...reply, key };
  }
  if (m.type === "CANCEL_PROBE" && fromContent && typeof m.key === "string") {
    const tabs = watchers.get(m.key);
    tabs?.delete(sender.tab!.id!);
    if (tabs && !tabs.size) watchers.delete(m.key);
    if ((await contexts()).length)
      await offscreen({
        type: "CANCEL_PROBE",
        key: m.key,
        tabId: sender.tab!.id,
      });
    return { ok: true };
  }
  if (m.type === "LIST") {
    await reconcile();
    return {
      ok: true,
      jobs: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  if (m.type === "CLEAR" && fromPopup) {
    for (const [id, j] of jobs) if (!ACTIVE.has(j.state)) jobs.delete(id);
    await persist();
    return { ok: true };
  }
  if (m.type === "SYNDICATION" && fromContent) {
    if (!isId(m.id)) return { ok: false, error: t("errInvalidPostId") };
    const token = ((Number(m.id) / 1e15) * Math.PI)
      .toString(36)
      .replace(/(0+|\.)/g, "");
    const response = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${m.id}&token=${token}`,
      {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      return { ok: false, error: t("errSyndicationHttp", response.status) };
    return {
      ok: true,
      records: extractMedia(
        safeJson(await boundedText(response)),
        "syndication",
      ),
    };
  }
  if (m.type === "START") {
    if (!fromContent) return { ok: false, error: t("errStartFromButton") };
    const record = validateRecord(m.record);
    if (!record) return { ok: false, error: t("errInvalidVideoMetadata") };
    const mode =
      m.mode === "audio"
        ? "audio"
        : m.mode === "video" || m.mode === undefined
          ? "video"
          : undefined;
    if (!mode) return { ok: false, error: t("errInvalidMode") };
    const existing = [...jobs.values()].find(
      (j) => j.key === jobKey(record, mode) && ACTIVE.has(j.state),
    );
    if (existing) return { ok: true, job: existing };
    if ([...jobs.values()].filter((j) => ACTIVE.has(j.state)).length >= 20)
      return { ok: false, error: t("errQueueFull") };
    const now = Date.now();
    const job: Job = {
      id: crypto.randomUUID(),
      key: jobKey(record, mode),
      mode,
      record,
      state: "queued",
      createdAt: now,
      updatedAt: now,
      tabId: sender.tab!.id,
      warnings:
        record.source === "syndication"
          ? [t("warnSyndicationPartial")]
          : [],
    };
    jobs.set(job.id, job);
    await persist();
    await ensureOffscreen();
    await offscreen({
      type: "ENQUEUE",
      job,
      plan: cache.getPlan(planKey(record)),
    });
    return { ok: true, job };
  }
  if (m.type === "CANCEL" || m.type === "RETRY") {
    const job = jobs.get(m.id);
    if (!job || (fromContent && job.tabId !== sender.tab!.id))
      return { ok: false, error: t("errJobNotFound") };
    if (m.type === "CANCEL") {
      if (!ACTIVE.has(job.state)) return { ok: true };
      await patch(job, { state: "cancelled", error: t("errCancelled") });
      if ((await contexts()).length)
        await offscreen({ type: "CANCEL", id: job.id });
      if (job.downloadId !== undefined)
        await chrome.downloads.cancel(job.downloadId).catch(() => {});
      return { ok: true };
    }
    if (ACTIVE.has(job.state)) return { ok: true, job };
    const live = (await contexts()).length
      ? await offscreen({ type: "STATUS" })
      : { ids: [] };
    if (live.ids?.includes(job.id))
      return { ok: false, error: t("errCleanupRetry") };
    await patch(job, {
      state: "queued",
      error: undefined,
      downloadId: undefined,
      filename: undefined,
      candidate: undefined,
      progress: 0,
      warnings:
        job.record.source === "syndication"
          ? [t("warnSyndicationPartial")]
          : [],
    });
    await ensureOffscreen();
    await offscreen({
      type: "ENQUEUE",
      job,
      plan: cache.getPlan(planKey(job.record)),
    });
    return { ok: true, job };
  }
  return { ok: false, error: t("errUnknownAction") };
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.target === "offscreen") return;
  // A 15-second external fallback must not hold the global job mutation queue.
  const operation =
    m?.type === "SYNDICATION"
      ? ready.then(() => handle(m, sender))
      : enqueue(() => handle(m, sender));
  void operation
    .then(reply)
    .catch((e) => reply({ ok: false, error: errorText(e) }));
  return true;
});
chrome.downloads.onChanged.addListener((delta) => {
  void enqueue(async () => {
    const job = [...jobs.values()].find(
      (j) => j.downloadId === delta.id && ACTIVE.has(j.state),
    );
    if (!job) return;
    if (
      job.candidate?.kind === "mp4" &&
      job.mode === "video" &&
      delta.finalUrl?.current &&
      !mediaUrl(delta.finalUrl.current)
    ) {
      await chrome.downloads.cancel(delta.id).catch(() => {});
      await patch(job, {
        state: "failed",
        error: t("errRedirectBlocked"),
      });
      if ((await contexts()).length)
        await offscreen({ type: "CANCEL", id: job.id });
      return;
    }
    if (
      delta.state?.current !== "complete" &&
      delta.state?.current !== "interrupted"
    )
      return;
    const item = (await chrome.downloads.search({ id: delta.id }))[0];
    if (!item) return;
    const outcome = nativeStatus(item);
    if (!outcome) return;
    const r = (await contexts()).length
      ? await offscreen({
          type: "NATIVE",
          id: job.id,
          outcome,
          candidateId: job.candidate?.id,
        }).catch(() => undefined)
      : undefined;
    if (!r?.exists)
      await patch(job, {
        state: outcome.ok ? "complete" : "interrupted",
        error: outcome.error,
        progress: outcome.ok ? 1 : job.progress,
      });
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void enqueue(reconcile).catch(() => {});
});
// A closed tab's content script dies with it and can never send CANCEL_PROBE,
// so its inspection registrations have to be reclaimed from this side.
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const before = watchers.size;
    pruneWatchers(watchers, tabId);
    if (watchers.size === before) return;
    if (!(await contexts()).length) return;
    await offscreen({ type: "FORGET_TAB", tabId });
  }).catch(() => {});
});
void enqueue(reconcile).catch(() => {});
