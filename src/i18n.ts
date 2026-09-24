import en from "../public/_locales/en/messages.json";
import zh from "../public/_locales/zh_CN/messages.json";

export type MessageKey = keyof typeof en;
interface Entry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}
type Catalog = Record<string, Entry>;
const catalogs: Record<string, Catalog> = {
  en: en as Catalog,
  "zh-CN": zh as Catalog,
};
const cjk = /^zh\b|^zh[-_]/i;

/**
 * `chrome.i18n` is unavailable inside the offscreen media worker, and
 * `navigator.language` is the only signal every context exposes, so either can
 * win depending on where the text is rendered.
 */
export function uiLanguage(): string {
  const declared =
    globalThis.chrome?.i18n?.getUILanguage?.() ||
    globalThis.navigator?.language ||
    "en";
  return cjk.test(declared) ? "zh-CN" : "en";
}
const take = (values: string[], index: number, fallback: string) => {
  const value = values[index];
  return value === undefined || value === "" ? fallback : value;
};

/** Mirrors Chrome: a named placeholder resolves through its `$n` content. */
const fill = (entry: Entry, values: string[]) =>
  entry.message.replace(
    /\$([A-Za-z0-9_]+)|\$(\d+)/g,
    (match, name: string | undefined, digit: string | undefined) => {
      if (digit !== undefined) return take(values, Number(digit) - 1, match);
      const content = entry.placeholders?.[name!]?.content;
      const position = content?.match(/^\$(\d+)$/);
      if (position) return take(values, Number(position[1]) - 1, match);
      return content ?? match;
    },
  );

type Substitution = string | number | undefined;

/**
 * Only the manifest goes through `chrome.i18n`, whose named-placeholder
 * handling differs from page code; the runtime renders the same JSON in every
 * context, including the offscreen media worker where `chrome.i18n` is absent.
 */
export function t(
  key: MessageKey | string,
  ...args: (Substitution | Substitution[])[]
): string {
  const substitutions = args
    .flat()
    .map((value) => String(value === undefined ? "" : value));
  const entry =
    catalogs[uiLanguage()]?.[String(key)] ?? catalogs.en?.[String(key)];
  return entry ? fill(entry, substitutions) : String(key);
}
