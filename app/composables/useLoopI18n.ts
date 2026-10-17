import { messageKeys } from "#shared/message-keys";

export function useLoopI18n() {
  const { t, locale } = useI18n();
  const localeTag = computed(() => locale.value === "th" ? "th-TH" : "en-US");
  // Data records and API errors retain stable English values on the server.
  // Resolve their display text through the same Vue I18n message catalog.
  function tr(source: string | null | undefined, values: Record<string, string | number> = {}) {
    if (!source) return "";
    return messageKeys[source] ? t(messageKeys[source]!, values) : source;
  }
  function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(localeTag.value, { timeZone: "America/Los_Angeles", ...options }).format(date);
  }
  return { t, tr, locale, localeTag, formatDate };
}
