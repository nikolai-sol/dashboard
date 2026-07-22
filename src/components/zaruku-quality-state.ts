import type { ZarukuDatasetMeta, ZarukuSourceFreshnessRow } from "@/lib/types";

export type ZarukuTrustLevel = "trusted" | "partial" | "critical";

export function buildZarukuTrustState({ traffic, datasets, freshness }: { traffic: ZarukuDatasetMeta; datasets: ZarukuDatasetMeta[]; freshness: ZarukuSourceFreshnessRow[] }) {
  const counts = datasets.reduce((result, dataset) => {
    result[dataset.state] += 1;
    return result;
  }, { ready: 0, partial: 0, empty: 0, unavailable: 0 });
  const coreFreshnessFailed = freshness.some((row) => row.source_key === "yandex_metrika" && row.freshness_status === "failed");
  const incomplete = counts.partial > 0 || counts.unavailable > 0 || freshness.some((row) => row.freshness_status === "delayed" || row.freshness_status === "failed");
  const level: ZarukuTrustLevel = traffic.state === "unavailable" || coreFreshnessFailed ? "critical" : incomplete ? "partial" : "trusted";
  return {
    level,
    label: level === "critical" ? "Критическая проблема" : level === "partial" ? "Частичные данные" : "Можно доверять",
    counts,
  };
}
