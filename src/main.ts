import { boundedText, graphUrl, safeJson } from "./security";
import { extractMedia } from "./extract";
import { CHANNEL } from "./types";

const publish = (value: unknown) => {
  const records = extractMedia(value, "graphql");
  for (let i = 0; i < records.length; i += 10)
    window.postMessage(
      { channel: CHANNEL, type: "MEDIA", records: records.slice(i, i + 10) },
      location.origin,
    );
};
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
          if (
            response.ok &&
            /json/i.test(response.headers.get("content-type") ?? "")
          )
            void boundedText(response.clone())
              .then((t) => publish(safeJson(t)))
              .catch(() => {});
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
          if (this.status >= 200 && this.status < 300) {
            if (this.responseType === "json") publish(this.response);
            else if (!this.responseType || this.responseType === "text")
              publish(safeJson(this.responseText));
          }
        } catch {}
      },
      { once: true },
    );
  return Reflect.apply(originalSend, this, args);
};
