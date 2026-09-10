import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";

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

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly ExportRow[]): string {
  return ["Поле;Значение", ...rows.map((row) => `${csvCell(row.field)};${csvCell(row.value)}`)].join("\r\n");
}
