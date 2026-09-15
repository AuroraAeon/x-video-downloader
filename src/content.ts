import {
  createElement,
  Download,
  LoaderCircle,
  Video,
  AudioLines,
} from "lucide";
import {
  CHANNEL,
  MAX_RECORDS,
  ACTIVE,
  errorText,
  keyOf,
  planKey,
  type MediaRecord,
  type Job,
  type DownloadMode,
  type QualitySummary,
} from "./types";
import { boundedText, postUrl, validateRecord } from "./security";
import { mergeRecord } from "./extract";
import { SsrDecoder } from "./ssr";
import { identify, postIds } from "./dom";
import { audioQuality, videoQuality } from "./quality";

interface Player {
  host: HTMLElement;
  button: HTMLButtonElement;
  info: HTMLElement;
  videoLine: HTMLElement;
  audioLine: HTMLElement;
  status: HTMLElement;
  busy: boolean;
  visible: boolean;
  fingerprint: string;
  record?: MediaRecord;
  quality?: QualitySummary;
  probeKey?: string;
  probePending?: boolean;
  probeTime?: number;
  job?: Job;
  resolveAttempt?: boolean;
}
const records = new Map<string, MediaRecord>(),
  decoder = new SsrDecoder(),
  players = new Map<HTMLVideoElement, Player>();
const parsed = new WeakSet<HTMLScriptElement>();
let scheduled = false,
  bridgeCount = 0,
  bridgeStart = Date.now();
let menu:
  | {
      host: HTMLElement;
      owner: HTMLVideoElement;
      buttons: HTMLButtonElement[];
      update: () => void;
    }
  | undefined;
let resolving = false;
const unresolved = new Set<HTMLVideoElement>();
const send = (m: unknown) => chrome.runtime.sendMessage(m);
function ingest(list: unknown) {
  if (!Array.isArray(list)) return;
  for (const item of list.slice(0, 100)) {
    const r = validateRecord(item);
    if (!r) continue;
    const k = `${r.tweetId}:${r.mediaId}`,
      previous = records.get(k);
    records.delete(k);
    records.set(k, mergeRecord(previous, r));
  }
  while (records.size > MAX_RECORDS)
    records.delete(records.keys().next().value!);
  schedule();
}
window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== CHANNEL ||
    event.data?.type !== "MEDIA"
  )
    return;
  if (Date.now() - bridgeStart > 1000) {
    bridgeStart = Date.now();
    bridgeCount = 0;
  }
  if (++bridgeCount <= 30) ingest(event.data.records);
});
function parseScript(script: HTMLScriptElement) {
  if (parsed.has(script) || script.src) return;
  parsed.add(script);
  const source = script.textContent ?? "";
  if (/relayRecords|__INITIAL_STATE__/.test(source))
    ingest(decoder.decode(source));
}
function scanScripts(root: ParentNode) {
  for (const s of root.querySelectorAll<HTMLScriptElement>("script"))
    parseScript(s);
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan();
  }, 100);
}
const tooltip = "下载视频或音频";
function render(p: Player) {
  const job = p.job,
    active = job && ACTIVE.has(job.state);
  p.button.replaceChildren(
    createElement(p.busy || active ? LoaderCircle : Download),
  );
  p.button.title = tooltip;
  p.button.setAttribute("aria-label", tooltip);
  const q = p.quality;
  p.videoLine.textContent = q
    ? `${q.warnings.length ? "可用画质" : "最高画质"}：${q.error ? "暂不可用" : videoQuality(q.video)}`
    : "最高画质：检测中…";
  p.audioLine.textContent = q
    ? `${q.warnings.length ? "可用音质" : "最高音质"}：${q.error ? "暂不可用" : audioQuality(q.audio)}`
    : "最高音质：检测中…";
  p.info.title = q?.error ?? q?.warnings.join("\n") ?? "";
  p.info.setAttribute(
    "aria-label",
    `${p.videoLine.textContent}；${p.audioLine.textContent}`,
  );
  p.info.dataset.state = q ? (q.error ? "error" : "ready") : "loading";
  const state: Record<string, string> = {
    queued: "排队中",
    analyzing: "检查中",
    waiting: "等待处理",
    merging: "正在处理",
    saving: "正在下载",
    complete: "已下载",
    failed: "下载失败",
    cancelled: "已取消",
    interrupted: "已中断",
  };
  p.status.textContent = job
    ? `${job.mode === "audio" ? "音频" : "视频"}${state[job.state]}${job.candidate ? ` · ${job.candidate.label}` : ""}${job.warnings.length ? " · 受限或降级" : ""}`
    : p.busy
      ? "正在准备下载…"
      : "";
  p.status.title = job
    ? [job.error, ...job.warnings].filter(Boolean).join("\n")
    : "";
  p.status.hidden = !p.status.textContent;
  if (menu && players.get(menu.owner) === p) menu.update();
}
function stopProbe(p: Player) {
  if (p.probePending && p.probeKey)
    void send({ type: "CANCEL_PROBE", key: p.probeKey }).catch(() => {});
  p.probePending = false;
}
function requestProbe(p: Player) {
  if (!p.visible || document.visibilityState === "hidden" || !p.record) return;
  const key = planKey(p.record);
  if (
    p.probeKey === key &&
    (p.probePending ||
      (p.quality &&
        Date.now() - p.quality.checkedAt < (p.quality.error ? 30000 : 120000)))
  )
    return;
  if (p.probeTime && Date.now() - p.probeTime < 1500) return;
  stopProbe(p);
  p.probeKey = key;
  p.probePending = true;
  p.probeTime = Date.now();
  void send({ type: "PROBE", record: p.record })
    .then((response) => {
      if (p.probeKey !== key) return;
      if (response?.quality) {
        p.quality = response.quality;
        p.probePending = false;
        render(p);
      } else if (!response?.ok) {
        p.probePending = false;
        p.quality = {
          checkedAt: Date.now(),
          warnings: [],
          error: response?.error ?? "检测暂不可用",
        };
        render(p);
      }
    })
    .catch((e) => {
      if (p.probeKey !== key) return;
      p.probePending = false;
      p.quality = { checkedAt: Date.now(), warnings: [], error: errorText(e) };
      render(p);
    });
}
async function resolveVisible() {
  if (resolving || document.visibilityState === "hidden") return;
  const video = unresolved.values().next().value;
  if (!video) return;
  unresolved.delete(video);
  const p = players.get(video);
  if (!p || !p.visible || p.record || p.resolveAttempt) {
    void resolveVisible();
    return;
  }
  p.resolveAttempt = true;
  resolving = true;
  const fingerprint = p.fingerprint;
  try {
    const r = await resolve(video);
    if (video.isConnected && p.fingerprint === fingerprint) {
      p.record = r;
      requestProbe(p);
    }
  } catch (e) {
    if (p.fingerprint === fingerprint) {
      p.quality = { checkedAt: Date.now(), warnings: [], error: errorText(e) };
      render(p);
    }
  } finally {
    resolving = false;
    void resolveVisible();
  }
}
const intersection = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const video = entry.target as HTMLVideoElement,
        p = players.get(video);
      if (!p) continue;
      p.visible = entry.isIntersecting;
      if (p.visible) {
        requestProbe(p);
        if (!p.record) {
          unresolved.add(video);
          setTimeout(() => void resolveVisible(), 900);
        }
      } else {
        stopProbe(p);
        unresolved.delete(video);
      }
    }
  },
  { rootMargin: "180px 0px", threshold: 0 },
);
async function resolve(video: HTMLVideoElement): Promise<MediaRecord> {
  scanScripts(document);
  let record = identify(video, [...records.values()]);
  if (record) return record;
  const ids = postIds(video);
  if (!ids.length) throw Error("无法确认所属帖子，请打开原帖重试");
  for (const id of ids.slice(0, 2)) {
    const response = await fetch(`https://x.com/i/status/${id}`, {
      credentials: "include",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if ([401, 403, 429].includes(response.status))
      throw Error(`X 返回 HTTP ${response.status}，请完成登录或稍后重试`);
    if (response.ok) {
      const doc = new DOMParser().parseFromString(
          await boundedText(response),
          "text/html",
        ),
        local = new SsrDecoder();
      for (const s of doc.querySelectorAll("script"))
        ingest(local.decode(s.textContent ?? ""));
      record = identify(video, [...records.values()]);
      if (record) return record;
    }
    const data = await send({ type: "SYNDICATION", id });
    if (data?.ok) ingest(data.records);
    record = identify(video, [...records.values()]);
    if (record) return record;
  }
  throw Error("暂未取得视频元数据，请刷新或打开原帖后重试");
}
async function start(video: HTMLVideoElement, mode: DownloadMode) {
  const p = players.get(video);
  if (!p || p.busy) return;
  closeMenu();
  p.busy = true;
  render(p);
  const fingerprint = p.fingerprint;
  try {
    const record = await resolve(video);
    if (!video.isConnected || fingerprint !== p.fingerprint)
      throw Error("视频已切换，请重试");
    const result = await send({ type: "START", mode, record });
    if (!result?.ok) throw Error(result?.error ?? "无法开始下载");
    p.job = result.job;
  } catch (e) {
    p.status.textContent = errorText(e);
    p.status.hidden = false;
    p.status.title = errorText(e);
  } finally {
    p.busy = false;
    if (p.job) render(p);
    else p.button.replaceChildren(createElement(Download));
  }
}
function closeMenu(focus = false) {
  if (!menu) return;
  const p = players.get(menu.owner);
  menu.host.remove();
  menu = undefined;
  p?.button.setAttribute("aria-expanded", "false");
  if (focus) p?.button.focus();
}
function openMenu(video: HTMLVideoElement) {
  const p = players.get(video);
  if (!p) return;
  if (menu?.owner === video) {
    closeMenu();
    return;
  }
  closeMenu();
  const host = document.createElement("xvd-menu");
  host.style.cssText =
    "position:fixed;z-index:2147483646;display:block;width:248px;max-width:calc(100vw - 20px);";
  const shadow = host.attachShadow({ mode: "closed" }),
    style = document.createElement("style");
  style.textContent =
    ":host{font:13px/1.45 system-ui;letter-spacing:0;color:#fff}section{padding:4px;border:1px solid rgba(255,255,255,.22);border-radius:7px;background:rgba(28,32,36,.76);backdrop-filter:blur(18px);box-shadow:0 6px 22px #0003}button{font:inherit;display:flex;align-items:center;gap:10px;width:100%;min-height:56px;text-align:left;color:inherit;border:0;border-radius:4px;background:transparent;padding:8px 10px;cursor:pointer}button:hover,button:focus-visible{background:#ffffff20;outline:none}button:disabled{opacity:.45;cursor:default}svg{height:18px;width:18px;flex:none}span{display:block;min-width:0}small{display:block;font-size:11px;color:#d2d9dd;overflow-wrap:anywhere}";
  const list = document.createElement("section");
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", tooltip);
  const buttons: HTMLButtonElement[] = [];
  const details: HTMLElement[] = [];
  for (const mode of ["video", "audio"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.mode = mode;
    const span = document.createElement("span"),
      title = document.createElement("span"),
      detail = document.createElement("small");
    title.textContent =
      mode === "video" ? "下载最高画质视频" : "下载最高音质音频";
    span.append(title, detail);
    button.append(createElement(mode === "video" ? Video : AudioLines), span);
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) void start(video, mode);
    });
    list.append(button);
    buttons.push(button);
    details.push(detail);
  }
  const update = () => {
    const q = p.quality;
    details[0]!.textContent = q && !q.error ? videoQuality(q.video) : "MP4";
    details[1]!.textContent =
      q && !q.error ? `${audioQuality(q.audio)} · M4A` : "M4A";
    buttons[0]!.disabled =
      p.busy || !!(p.job?.mode === "video" && ACTIVE.has(p.job.state));
    buttons[1]!.disabled =
      p.busy ||
      !!(p.job?.mode === "audio" && ACTIVE.has(p.job.state)) ||
      !!(q && !q.error && !q.warnings.length && !q.audio);
  };
  shadow.append(style, list);
  document.documentElement.append(host);
  menu = { host, owner: video, buttons, update };
  update();
  const box = p.button.getBoundingClientRect(),
    height = host.getBoundingClientRect().height,
    width = host.getBoundingClientRect().width;
  host.style.left = `${Math.max(10, Math.min(innerWidth - width - 10, box.right - width))}px`;
  host.style.top = `${Math.max(10, box.bottom + height + 8 < innerHeight ? box.bottom + 6 : box.top - height - 6)}px`;
  p.button.setAttribute("aria-expanded", "true");
  (buttons.find((b) => !b.disabled) ?? buttons[0])?.focus();
  requestProbe(p);
  list.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const allowed = buttons.filter((b) => !b.disabled),
        index = allowed.indexOf(shadow.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? allowed.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + allowed.length) %
              allowed.length;
      allowed[next]?.focus();
    }
  });
}
document.addEventListener(
  "pointerdown",
  (e) => {
    if (
      menu &&
      !e.composedPath().includes(menu.host) &&
      !e.composedPath().includes(players.get(menu.owner)!.host)
    )
      closeMenu();
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") closeMenu(true);
  },
  true,
);
window.addEventListener("scroll", () => closeMenu(), true);
window.addEventListener("resize", () => closeMenu());
function frameFor(video: HTMLVideoElement): HTMLElement {
  let frame = video.parentElement!,
    next = frame.parentElement;
  const box = video.getBoundingClientRect();
  for (let i = 0; next && i < 5; i++, next = next.parentElement) {
    const r = next.getBoundingClientRect();
    if (
      next.tagName === "ARTICLE" ||
      next.querySelectorAll("video").length !== 1 ||
      Math.abs(r.width - box.width) > 5 ||
      Math.abs(r.height - box.height) > 5
    )
      break;
    frame = next;
  }
  return frame;
}
function attach(video: HTMLVideoElement) {
  if (!video.parentElement) return;
  const frame = frameFor(video),
    host = document.createElement("xvd-download"),
    info = document.createElement("xvd-quality");
  host.style.cssText =
    "position:absolute;top:6px;right:6px;z-index:10;display:block;width:28px;height:28px;pointer-events:auto;";
  const shadow = host.attachShadow({ mode: "closed" }),
    style = document.createElement("style");
  style.textContent =
    ":host{letter-spacing:0}button{width:28px;height:28px;padding:5px;display:grid;place-items:center;color:#fff;background:rgba(20,24,28,.22);backdrop-filter:blur(12px) saturate(1.3);-webkit-backdrop-filter:blur(12px) saturate(1.3);border:1px solid rgba(255,255,255,.2);border-radius:5px;cursor:pointer;box-shadow:0 1px 3px #0002}button:hover{background:rgba(20,24,28,.38)}button:focus-visible{outline:2px solid #93ded7;outline-offset:2px}svg{width:16px;height:16px;filter:drop-shadow(0 1px 1px #0005)}";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  shadow.append(style, button);
  info.style.cssText =
    "display:block;position:relative;flex:0 0 auto;width:100%;box-sizing:border-box;min-height:36px;margin:4px 0 2px;";
  const infoShadow = info.attachShadow({ mode: "closed" }),
    infoStyle = document.createElement("style");
  infoStyle.textContent =
    ":host{font:11px/16px system-ui;letter-spacing:0;color:inherit;font-variant-numeric:tabular-nums}div{opacity:.68;overflow-wrap:anywhere}span{display:block;color:inherit;opacity:.88;font-size:11px;line-height:16px}span[hidden]{display:none}";
  const videoLine = document.createElement("div"),
    audioLine = document.createElement("div"),
    status = document.createElement("span");
  status.hidden = true;
  status.setAttribute("role", "status");
  infoShadow.append(infoStyle, videoLine, audioLine, status);
  if (getComputedStyle(frame).position === "static")
    frame.style.position = "relative";
  frame.append(host);
  frame.after(info);
  const p: Player = {
    host,
    button,
    info,
    videoLine,
    audioLine,
    status,
    busy: false,
    visible: false,
    fingerprint: video.poster || video.currentSrc,
  };
  players.set(video, p);
  for (const type of ["pointerdown", "mousedown", "dblclick"])
    host.addEventListener(type, (e) => e.stopPropagation());
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.isTrusted) openMenu(video);
  });
  render(p);
  intersection.observe(video);
}
function detach(video: HTMLVideoElement, p: Player) {
  if (menu?.owner === video) closeMenu();
  stopProbe(p);
  unresolved.delete(video);
  intersection.unobserve(video);
  p.host.remove();
  p.info.remove();
  players.delete(video);
}
function scan() {
  for (const [video, p] of players) {
    if (!video.isConnected || !p.host.isConnected || !p.info.isConnected) {
      detach(video, p);
      continue;
    }
    const fingerprint = video.poster || video.currentSrc;
    if (fingerprint !== p.fingerprint) {
      stopProbe(p);
      p.fingerprint = fingerprint;
      p.job = undefined;
      p.quality = undefined;
      p.probeKey = undefined;
      p.record = undefined;
      p.resolveAttempt = false;
      p.probeTime = undefined;
      if (menu?.owner === video) closeMenu();
    }
    const r = identify(video, [...records.values()]);
    if (r && (!p.record || planKey(r) !== planKey(p.record))) {
      stopProbe(p);
      p.record = r;
      p.quality = undefined;
      p.probeKey = undefined;
    }
    render(p);
    requestProbe(p);
  }
  for (const video of document.querySelectorAll("video"))
    if (
      !players.has(video) &&
      (video.closest('article,[data-testid="tweet"],[role="dialog"]') ||
        postUrl(location.href))
    ) {
      attach(video);
      const p = players.get(video)!;
      p.record = identify(video, [...records.values()]);
    }
}
const observer = new MutationObserver((changes) => {
  let relevant = false;
  for (const change of changes) {
    if (
      change.target instanceof Element &&
      change.target.closest("xvd-download,xvd-quality,xvd-menu")
    )
      continue;
    if (change.type === "attributes") {
      relevant = true;
      continue;
    }
    for (const node of change.addedNodes) {
      if (node instanceof HTMLScriptElement) parseScript(node);
      else if (node instanceof Element && !node.tagName.startsWith("XVD-")) {
        scanScripts(node);
        relevant = true;
      }
    }
    for (const node of change.removedNodes)
      if (node instanceof Element && !node.tagName.startsWith("XVD-"))
        relevant = true;
  }
  if (relevant) schedule();
});
observer.observe(document, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src", "poster", "href"],
});
scanScripts(document);
schedule();
window.addEventListener("pageshow", schedule);
window.addEventListener("popstate", schedule);
document.addEventListener("visibilitychange", () => {
  for (const p of players.values()) {
    if (document.visibilityState === "hidden") stopProbe(p);
    else requestProbe(p);
  }
  void resolveVisible();
});
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "QUALITY") {
    for (const p of players.values())
      if (p.probeKey === m.key) {
        p.quality = m.quality;
        p.probePending = false;
        render(p);
      }
    return;
  }
  if (m?.type !== "JOB") return;
  const job = m.job as Job;
  for (const p of players.values())
    if (
      p.job?.id === job.id ||
      (p.record && keyOf(p.record) === keyOf(job.record))
    ) {
      p.job = job;
      render(p);
    }
});
