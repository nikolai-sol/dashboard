import type { ZarukuSeoData, ZarukuSeoSourceId } from "@/lib/types";

function formatSidebarDate(dateText: string): string {
  const normalized = String(dateText).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized.slice(8, 10)}.${normalized.slice(5, 7)}.${normalized.slice(0, 4)}`;
  }
  return normalized;
}

function formatSidebarMonthDate(dateText: string): string {
  const normalized = String(dateText).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(normalized)) {
    return `01.${normalized.slice(5, 7)}.${normalized.slice(0, 4)}`;
  }
  return normalized;
}

function formatAliceDataThrough(dateText: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(dateText)
    ? formatSidebarDate(dateText)
    : formatSidebarMonthDate(dateText);
}

const SOURCE_FRESHNESS_SOURCE_KEYS: Partial<Record<ZarukuSeoSourceId, string>> = {
  metrika: "yandex_metrika",
  gsc: "google_search_console",
  webmaster: "yandex_webmaster",
};

export function getZarukuSourceRowsLabel(
  data: ZarukuSeoData,
  sourceId: ZarukuSeoSourceId,
): string | null {
  const sourceFreshnessKey = SOURCE_FRESHNESS_SOURCE_KEYS[sourceId];
  if (sourceFreshnessKey) {
    const row = data.source_freshness.find((item) => item.source_key === sourceFreshnessKey);
    if (row?.date_to) return `посл. дата: ${formatSidebarDate(row.date_to)}`;
    return row?.last_success_at ? `посл. дата: ${formatSidebarDate(row.last_success_at)}` : null;
  }
  if (sourceId === "yandex_gen_search") {
    const source = data.sources.find((item) => item.id === sourceId);
    if (data.alice_visibility.status !== "unavailable") {
      const canonicalDataThrough = source?.data_through ?? data.alice_visibility.latestMonth;
      return canonicalDataThrough
        ? `посл. дата: ${formatAliceDataThrough(canonicalDataThrough)}`
        : null;
    }
    const fallbackActive = source?.status === "connected" || source?.status === "partial";
    return fallbackActive && source.data_through
      ? `посл. дата: ${formatAliceDataThrough(source.data_through)}`
      : null;
  }
  if (sourceId === "seo_os") {
    return data.seo_os.latest_week ? `посл. неделя: ${data.seo_os.latest_week}` : null;
  }
  return null;
}
