import type { DatasetMeta, GscView, Period, SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "./read-model.ts";
import type { PeriodSelection } from "./period-selection.ts";

export type ExportRow = Readonly<{ field: string; value: string }>;

export function buildExportRows(input: Readonly<{ title: string; period: Period; source: DatasetMeta }>): ExportRow[] {
  const limitation = input.source.state === "missing"
    ? "Нужна выгрузка"
    : input.source.state === "partial"
      ? "Источник содержит неполные данные"
      : input.source.state === "complete_empty"
        ? "Подтверждённо пустой период"
        : input.source.state === "failed"
          ? "Последняя загрузка завершилась ошибкой"
          : "Нет";
  return [
    { field: "Раздел", value: input.title },
    { field: "Период от", value: input.period.from },
    { field: "Период до", value: input.period.to },
    { field: "Источник", value: input.source.sourceKey },
    { field: "Состояние", value: input.source.state },
    { field: "Ограничение", value: limitation },
    { field: "Загружено", value: input.source.loadedAt ?? "неизвестно" },
  ];
}

export function buildGscExportRows(input: Pick<GscView, "summary" | "daily" | "dimensions"> & Readonly<{ period: Period; source: DatasetMeta }>): ExportRow[] {
  const rows = buildExportRows({ title: "Google Search Console", period: input.period, source: input.source });
  if (input.summary) rows.push(
    { field: "Итоговые клики", value: String(input.summary.clicks) },
    { field: "Итоговые показы", value: String(input.summary.impressions) },
    { field: "CTR, %", value: input.summary.ctrPct === null ? "неизвестно" : String(input.summary.ctrPct) },
    { field: "Средняя позиция", value: input.summary.averagePosition === null ? "неизвестно" : String(input.summary.averagePosition) },
  );
  for (const row of input.daily) rows.push({ field: `День ${row.date}`, value: `клики ${row.metrics.clicks}; показы ${row.metrics.impressions}` });
  for (const row of input.dimensions) rows.push({ field: `${row.dimension}: ${row.value}`, value: `клики ${row.metrics.clicks}; показы ${row.metrics.impressions}` });
  return rows;
}

export function buildDashboardExportRows(input: Readonly<{
  profile: Pick<SiteProfile, "sources">;
  selection: PeriodSelection;
  model: Pick<DashboardReadModel, "gsc" | "datasets">;
}>): ExportRow[] {
  const gscEnabled = input.profile.sources.some((source) => source.sourceKey === "google_search_console" && source.mode !== "disabled");
  if (gscEnabled) return buildGscExportRows({ ...input.model.gsc, period: input.selection.gsc, source: input.model.gsc.meta });
  return input.profile.sources
    .filter((source) => source.mode !== "disabled" && source.sourceKey !== "google_search_console")
    .flatMap((source) => {
      const meta = input.model.datasets[source.sourceKey];
      if (!meta) return [];
      const period = source.sourceKey === "yandex_webmaster_alice_manual" ? input.selection.alice : input.selection.traffic.primary;
      return buildExportRows({ title: source.sourceKey, period, source: meta });
    });
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly ExportRow[]): string {
  return ["Поле;Значение", ...rows.map((row) => `${csvCell(row.field)};${csvCell(row.value)}`)].join("\r\n");
}
