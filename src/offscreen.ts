import {
  errorText,
  extensionOf,
  type Job,
  type Candidate,
  type MediaPlan,
} from "./types";
import { ProbeQueue } from "./probes";

interface Task {
  job: Job;
  worker?: Worker;
  cancelled: boolean;
  native?: (value: { ok: boolean; error?: string }) => void;
  reject?: (e: Error) => void;
  blob?: string;
}
const tasks = new Map<string, Task>();
const pending: Task[] = [];
let running = 0,
  hlsOwner: string | undefined;
const hlsWaiters: (() => void)[] = [];
const send = (message: unknown) =>
  chrome.runtime.sendMessage({ target: "background", ...(message as object) });
const probeTabs = new Map<string, Set<number>>();
const probes = new ProbeQueue(
  (key, quality) => {
    const tabIds = [...(probeTabs.get(key) ?? [])];
    probeTabs.delete(key);
    return send({ type: "QUALITY_RESULT", key, quality, tabIds });
  },
  scheduleIdle,
  () => running < 2,
);
async function update(task: Task, patch: Partial<Job>) {
  if (task.cancelled && patch.state !== "cancelled") return;
  Object.assign(task.job, patch);
  await send({ type: "EVENT", id: task.job.id, patch });
}
function rpc(task: Task, payload: object): Promise<any> {
  const worker = task.worker!;
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(Error("媒体处理超时，请重试")), 90000);
    };
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", error);
      task.reject = undefined;
    };
    const finish = (e?: Error, result?: unknown) => {
      cleanup();
      e ? reject(e) : resolve(result);
    };
    const listener = (event: MessageEvent) => {
      const m = event.data;
      reset();
      if (m.type === "progress")
        void update(task, {
          progress: Math.max(0, Math.min(0.99, m.progress)),
        }).catch(() => {});
      if (m.requestId !== requestId) return;
      if (m.type === "result") finish(undefined, m.result);
      if (m.type === "error")
        finish(Object.assign(Error(m.error), { stop: m.stop }));
    };
    const error = () => finish(Error("媒体 Worker 意外退出"));
    task.reject = (e) => finish(e);
    worker.addEventListener("message", listener);
    worker.addEventListener("error", error);
    reset();
    worker.postMessage({ ...payload, requestId });
  });
}
async function acquireHls(task: Task) {
  while (hlsOwner && !task.cancelled) {
    await update(task, { state: "waiting" });
    await new Promise<void>((resolve) => hlsWaiters.push(resolve));
  }
  if (task.cancelled) throw Error("已取消");
  hlsOwner = task.job.id;
}
function releaseHls(id: string) {
  if (hlsOwner === id) {
    hlsOwner = undefined;
    hlsWaiters.splice(0).forEach((fn) => fn());
  }
}
async function cleanup(task: Task) {
  if (task.blob) URL.revokeObjectURL(task.blob);
  task.blob = undefined;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("xvd-temp");
    await dir.removeEntry(`${task.job.id}.${extensionOf(task.job.mode)}`);
  } catch {}
}
async function nativeDownload(task: Task, candidate: Candidate, url: string) {
  let resolve!: Task["native"];
  const completion = new Promise<{ ok: boolean; error?: string }>(
    (r) => (resolve = r),
  );
  task.native = resolve;
  const response = await send({
    type: "DOWNLOAD",
    id: task.job.id,
    candidate,
    url,
  });
  if (!response?.ok) {
    task.native = undefined;
    throw Object.assign(Error(response?.error ?? "Chrome 未能启动下载"), {
      stop: response?.stop,
    });
  }
  const outcome = await completion;
  task.native = undefined;
  if (!outcome.ok)
    throw Object.assign(Error(outcome.error ?? "下载中断"), {
      stop:
        outcome.error === "USER_CANCELED" || outcome.error?.startsWith("FILE_"),
    });
}
async function run(task: Task) {
  try {
    await update(task, { state: "analyzing", progress: 0 });
    task.worker = new Worker("media-worker.js", { type: "module" });
    const plan =
      probes.get(task.job.record) ??
      (await probes.wait(task.job.record)) ??
      ((await rpc(task, {
        type: "plan",
        record: task.job.record,
      })) as MediaPlan);
    if (task.cancelled) return;
    probes.put(task.job.record, plan);
    const { warnings } = plan,
      candidates =
        task.job.mode === "audio" ? plan.audioCandidates : plan.candidates;
    if (!candidates.length)
      throw Error(
        task.job.mode === "audio"
          ? "此视频没有可下载的音轨"
          : "没有可下载的视频轨",
      );
    await update(task, { warnings: [...task.job.warnings, ...warnings] });
    let lastError = "所有画质均下载失败";
    for (const [index, candidate] of candidates.entries()) {
      if (task.cancelled) return;
      if (index > 0)
        await update(task, {
          warnings: [
            ...task.job.warnings,
            `自动改用 ${candidate.label}：${lastError}`,
          ].slice(-16),
        });
      await update(task, { candidate, progress: 0 });
      try {
        let url = candidate.url;
        if (candidate.kind === "hls" || task.job.mode === "audio") {
          await acquireHls(task);
          await update(task, { state: "merging" });
          await rpc(task, {
            type: "render",
            jobId: task.job.id,
            candidate,
            record: task.job.record,
            mode: task.job.mode,
          });
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle("xvd-temp");
          const handle = await dir.getFileHandle(
            `${task.job.id}.${extensionOf(task.job.mode)}`,
          );
          task.blob = URL.createObjectURL(await handle.getFile());
          url = task.blob;
        }
        if (task.cancelled) return;
        await update(task, {
          state: "saving",
          progress: task.blob ? 0.99 : 0,
        });
        await nativeDownload(task, candidate, url);
        await update(task, {
          state: "complete",
          progress: 1,
          error: undefined,
        });
        return;
      } catch (e) {
        if (task.cancelled) return;
        lastError = errorText(e);
        if ((e as { stop?: boolean }).stop) throw e;
      } finally {
        await cleanup(task);
        releaseHls(task.job.id);
      }
    }
    throw Error(lastError);
  } catch (e) {
    if (!task.cancelled)
      await update(task, { state: "failed", error: errorText(e) }).catch(
        () => {},
      );
  } finally {
    task.worker?.terminate();
    await cleanup(task);
    releaseHls(task.job.id);
    tasks.delete(task.job.id);
    running--;
    pump();
  }
}
let idleTimer: ReturnType<typeof setTimeout>;
function scheduleIdle() {
  clearTimeout(idleTimer);
  if (!tasks.size && !probes.busy)
    idleTimer = setTimeout(() => {
      void send({ type: "IDLE" }).catch(() => {});
    }, 15000);
}
function pump() {
  clearTimeout(idleTimer);
  while (running < 2 && pending.length) {
    const t = pending.shift()!;
    if (t.cancelled) {
      tasks.delete(t.job.id);
      continue;
    }
    running++;
    void run(t);
  }
  probes.pump();
  scheduleIdle();
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js") ||
    sender.tab ||
    m?.target !== "offscreen"
  )
    return;
  if (m.type === "STATUS") {
    reply({ ids: [...tasks.keys()], probing: probes.busy });
    return;
  }
  if (m.type === "PROBE") {
    clearTimeout(idleTimer);
    const tabs = probeTabs.get(m.key) ?? new Set<number>();
    tabs.add(m.tabId);
    probeTabs.set(m.key, tabs);
    const ok = probes.add(m.record);
    if (!ok) probeTabs.delete(m.key);
    reply({ ok });
    return;
  }
  if (m.type === "CANCEL_PROBE") {
    const tabs = probeTabs.get(m.key);
    tabs?.delete(m.tabId);
    if (!tabs?.size) {
      probeTabs.delete(m.key);
      probes.remove(m.key);
    }
    scheduleIdle();
    reply({ ok: true });
    return;
  }
  if (m.type === "ENQUEUE") {
    void initialized.then(() => {
      if (!tasks.has(m.job.id)) {
        const task: Task = { job: m.job, cancelled: false };
        tasks.set(m.job.id, task);
        pending.push(task);
        pump();
      }
      reply({ ok: true });
    });
    return true;
  }
  const task = tasks.get(m.id);
  if (m.type === "NATIVE") {
    if (task?.native && m.candidateId === task.job.candidate?.id) {
      task.native(m.outcome);
      reply({ handled: true, exists: true });
    } else reply({ handled: false, exists: !!task });
    return;
  }
  if (m.type === "CANCEL") {
    if (task) {
      task.cancelled = true;
      task.worker?.postMessage({ type: "cancel" });
      task.reject?.(Error("已取消"));
      task.native?.({ ok: false, error: "USER_CANCELED" });
      hlsWaiters.splice(0).forEach((fn) => fn());
    }
    reply({ ok: true });
    return;
  }
});
// A newly created offscreen document has no live file owners.
const initialized = (async () => {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("xvd-temp");
    for await (const [name] of (dir as any).entries())
      if (/^[\w-]+\.(?:mp4|m4a)$/.test(name)) await dir.removeEntry(name);
  } catch {}
})();
