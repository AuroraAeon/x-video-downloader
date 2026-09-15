import { createElement, X, RotateCcw, Trash2, FolderDown } from "lucide";
import { ACTIVE, errorText, type Job } from "./types";
const main = document.querySelector<HTMLElement>("#jobs")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const names: Record<string, string> = {
  queued: "排队中",
  analyzing: "检查画质",
  waiting: "等待合并",
  merging: "正在合并",
  saving: "Chrome 正在下载",
  complete: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
const send = (m: unknown) => chrome.runtime.sendMessage(m);
function element(tag: string, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
async function action(type: string, id?: string) {
  try {
    const r = await send({ type, id });
    if (!r?.ok) throw Error(r?.error);
    await render();
  } catch (e) {
    summary.textContent = errorText(e);
  }
}
async function render() {
  const data = await send({ type: "LIST" });
  if (!data?.ok) return;
  const jobs = data.jobs as Job[];
  main.replaceChildren();
  if (!jobs.length) main.append(element("div", "暂无下载任务", "empty"));
  for (const job of jobs) {
    const row = element("article", undefined, "job"),
      line = element("div", undefined, "line");
    line.append(
      element(
        "div",
        `@${job.record.author || "user"} · ${job.mode === "audio" ? "音频" : "视频"} ${job.record.index}`,
        "name",
      ),
    );
    if (job.state !== "complete") {
      const button = element("button") as HTMLButtonElement;
      const cancel = ACTIVE.has(job.state);
      button.title = cancel ? "取消" : "重试";
      button.setAttribute("aria-label", button.title);
      button.append(createElement(cancel ? X : RotateCcw));
      button.onclick = () => void action(cancel ? "CANCEL" : "RETRY", job.id);
      line.append(button);
    }
    row.append(
      line,
      element(
        "div",
        `${names[job.state]}${job.candidate ? ` · ${job.candidate.label}${job.candidate.fps ? ` · ${Math.round(job.candidate.fps)} fps` : ""}` : ""}`,
        "meta",
      ),
    );
    if (ACTIVE.has(job.state)) {
      const progress = document.createElement("progress");
      progress.max = 1;
      if (job.progress && job.state === "merging")
        progress.value = job.progress;
      row.append(progress);
    }
    if (job.error) row.append(element("div", job.error, "detail error"));
    for (const warning of job.warnings.slice(-3))
      row.append(element("div", warning, "detail warning"));
    if (job.filename) row.append(element("div", job.filename, "detail"));
    main.append(row);
  }
  summary.textContent = `${jobs.filter((j) => ACTIVE.has(j.state)).length} 个进行中 · ${jobs.filter((j) => j.state === "complete").length} 个已完成`;
}
document.querySelector("#clear")!.append(createElement(Trash2));
document
  .querySelector("#clear")!
  .addEventListener("click", () => void action("CLEAR"));
document.querySelector("#downloads")!.append(createElement(FolderDown));
document
  .querySelector("#downloads")!
  .addEventListener(
    "click",
    () => void chrome.tabs.create({ url: "chrome://downloads" }),
  );
chrome.storage.onChanged.addListener(() => void render());
void render().catch((e) => {
  summary.textContent = errorText(e);
});
