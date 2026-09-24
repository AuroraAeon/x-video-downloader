// The runtime picks its language from `chrome.i18n.getUILanguage()` and falls
// back to `navigator.language`, which in Node reports the machine's ICU locale.
// Chrome always knows its UI language, so pin it to keep assertions stable on
// non-English development machines.
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US" },
  configurable: true,
});
