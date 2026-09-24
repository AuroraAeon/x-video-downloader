import { createElement, X, RotateCcw, Trash2, FolderDown } from "lucide";
import { ACTIVE, errorText, type Job, type JobState } from "./types";
import { t, uiLanguage } from "./i18n";
const main = document.querySelector<HTMLElement>("#jobs")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const stateKeys: Record<JobState, string> = {
  queued: "stateQueued",
  analyzing: "stateAnalyzing",
  waiting: "stateWaiting",
  merging: "stateMerging",
  saving: "stateSaving",
  complete: "stateComplete",
  failed: "stateFailed",
  cancelled: "stateCancelled",
  interrupted: "stateInterrupted",
};
const modeKeys = { video: "modeVideo", audio: "modeAudio" } as const;
const send = (m: unknown) => chrome.runtime.sendMessage(m);
function element(tag: string, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function localizeStatic() {
  document.documentElement.lang = uiLanguage();
  document.title = t("extensionName");
  document.querySelector("h1")!.textContent = t("extensionName");
  main.setAttribute("aria-label", t("menuJobHeading"));
  for (const [id, key] of [
    ["clear", "popupClearTitle"],
    ["downloads", "popupDownloadsTitle"],
  ] as const) {
    const node = document.getElementById(id)!;
    node.title = t(key);
    node.setAttribute("aria-label", t(key));
  }
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
  if (!jobs.length) main.append(element("div", t("popupEmpty"), "empty"));
  for (const job of jobs) {
    const row = element("article", undefined, "job"),
      line = element("div", undefined, "line");
    line.append(
      element(
        "div",
        `@${job.record.author || "user"} · ${t(modeKeys[job.mode])} ${job.record.index}`,
        "name",
      ),
    );
    if (job.state !== "complete") {
      const button = element("button") as HTMLButtonElement;
      const cancel = ACTIVE.has(job.state);
      button.title = t(cancel ? "actionCancel" : "actionRetry");
      button.setAttribute("aria-label", button.title);
      button.append(createElement(cancel ? X : RotateCcw));
      button.onclick = () => void action(cancel ? "CANCEL" : "RETRY", job.id);
      line.append(button);
    }
    row.append(
      line,
      element(
        "div",
        job.candidate
          ? t(
              "jobStatusCandidate",
              t(stateKeys[job.state]),
              `${job.candidate.label}${job.candidate.fps ? ` · ${Math.round(job.candidate.fps)} fps` : ""}`,
            )
          : t(stateKeys[job.state]),
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
  summary.textContent = t("popupSummary", [
    String(jobs.filter((j) => ACTIVE.has(j.state)).length),
    String(jobs.filter((j) => j.state === "complete").length),
  ]);
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
localizeStatic();
chrome.storage.onChanged.addListener(() => void render());
void render().catch((e) => {
  summary.textContent = errorText(e);
});
