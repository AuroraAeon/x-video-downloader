import { boundedText, graphUrl, safeJson } from "./security";
import { extractMedia } from "./extract";
import { CHANNEL, MAX_JSON } from "./types";

// Cloning every API response has to stay bounded. A clone is only released once
// both branches are consumed, so a page that abandons a response would otherwise
// park its reader, the buffered text and a main-world parse indefinitely.
const MAX_READS = 3,
  READ_TIMEOUT = 8000,
  MAX_QUEUED = 6 * 1024 * 1024;
const queued: string[] = [];
let reading = 0,
  queuedBytes = 0,
  draining = false;

function publish(value: unknown) {
  const records = extractMedia(value, "graphql");
  for (let i = 0; i < records.length; i += 10)
    window.postMessage(
      { channel: CHANNEL, type: "MEDIA", records: records.slice(i, i + 10) },
      location.origin,
    );
}
// One parse per task keeps a burst of timeline responses off the critical path.
function drain() {
  if (draining) return;
  draining = true;
  setTimeout(() => {
    const text = queued.shift();
    if (text) {
      queuedBytes -= text.length;
      try {
        publish(safeJson(text));
      } catch {}
    }
    draining = false;
    if (queued.length) drain();
  }, 0);
}
function enqueue(text: string) {
  queued.push(text);
  queuedBytes += text.length;
  while (queuedBytes > MAX_QUEUED && queued.length > 1) {
    const dropped = queued.shift()!;
    queuedBytes -= dropped.length;
  }
  drain();
}
function collect(clone: Response) {
  reading++;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), READ_TIMEOUT);
  void boundedText(clone, MAX_JSON, abort.signal)
    .then((text) => {
      if (text) enqueue(text);
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      reading--;
    });
}

const originalFetch = window.fetch;
window.fetch = function (this: Window, ...args: Parameters<typeof fetch>) {
  const result = Reflect.apply(originalFetch, this, args) as ReturnType<
    typeof fetch
  >;
  try {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (graphUrl(url))
      void result
        .then((response) => {
          if (reading >= MAX_READS) return;
          if (
            response.ok &&
            /json/i.test(response.headers.get("content-type") ?? "")
          )
            collect(response.clone());
        })
        .catch(() => {});
  } catch {}
  return result;
};
const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const originalOpen = XMLHttpRequest.prototype.open,
  originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  ...args: any[]
) {
  const result = Reflect.apply(originalOpen, this, args);
  xhrUrls.set(this, String(args[1]));
  return result;
} as typeof originalOpen;
XMLHttpRequest.prototype.send = function (
  ...args: Parameters<typeof originalSend>
) {
  if (graphUrl(xhrUrls.get(this) ?? ""))
    this.addEventListener(
      "load",
      () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === "json") publish(this.response);
          else if (!this.responseType || this.responseType === "text")
            enqueue(this.responseText);
        } catch {}
      },
      { once: true },
    );
  return Reflect.apply(originalSend, this, args);
};
