import type {
  ZarukuAiVisibilityRow,
  ZarukuYandexWebmasterPageRow,
  ZarukuYandexWebmasterQueryRow,
} from "@/lib/types";

export type WebmasterKpiSummary = {
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
};

export type AiVisibilitySummary = {
  checked: number;
  mentioned: number;
  presence_rate: number | null;
  mentions: number;
  citations: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weightedAverage(rows: Array<{ impressions: number; average_position: number | null }>) {
  const weighted = rows.reduce(
    (total, row) => {
      if (row.average_position == null || row.impressions <= 0) return total;
      return {
        value: total.value + row.average_position * row.impressions,
        weight: total.weight + row.impressions,
      };
    },
    { value: 0, weight: 0 },
  );
  return weighted.weight > 0 ? round(weighted.value / weighted.weight, 2) : null;
}

export function summarizeWebmasterKpis(rows: ZarukuYandexWebmasterQueryRow[]): WebmasterKpiSummary {
  const totals = rows.reduce(
    (total, row) => ({
      impressions: total.impressions + row.impressions,
      clicks: total.clicks + row.clicks,
    }),
    { impressions: 0, clicks: 0 },
  );
  return {
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: totals.impressions > 0 ? round((totals.clicks / totals.impressions) * 100, 2) : null,
    average_position: weightedAverage(rows),
  };
}

export function topWebmasterQueries(rows: ZarukuYandexWebmasterQueryRow[], limit = 12) {
  return [...rows]
    .sort((left, right) => right.impressions - left.impressions || right.clicks - left.clicks || left.query.localeCompare(right.query))
    .slice(0, limit);
}

export function topWebmasterPages(rows: ZarukuYandexWebmasterPageRow[], limit = 10) {
  return [...rows]
    .sort((left, right) => right.impressions - left.impressions || right.clicks - left.clicks || left.url.localeCompare(right.url))
    .slice(0, limit);
}

export function resolveRowsForWeek<T extends { week: string }>(rows: T[], selectedWeek: string | null, fallbackWeek: string | null) {
  if (selectedWeek) {
    const selectedRows = rows.filter((row) => row.week === selectedWeek);
    if (selectedRows.length > 0) return { week: selectedWeek, rows: selectedRows };
  }
  if (fallbackWeek) {
    const fallbackRows = rows.filter((row) => row.week === fallbackWeek);
    if (fallbackRows.length > 0) return { week: fallbackWeek, rows: fallbackRows };
  }

  const latestWeek = [...new Set(rows.map((row) => row.week))].sort().at(-1) ?? null;
  return latestWeek ? { week: latestWeek, rows: rows.filter((row) => row.week === latestWeek) } : { week: null, rows };
}

export function buildWebmasterSelectionMeta<T extends { week: string; week_from: string; week_to: string }>(
  selection: { week: string | null; rows: T[] },
  selectedWeek: string | null,
) {
  const firstRow = selection.rows[0];
  const periodLabel = firstRow
    ? `${selection.week ?? firstRow.week} · ${firstRow.week_from} — ${firstRow.week_to}`
    : (selection.week ?? "week —");
  const fallbackNote = selectedWeek && selection.week && selectedWeek !== selection.week
    ? `Выбрана ${selectedWeek}, но в Яндекс Вебмастере за неё нет строк; показана последняя доступная неделя ${selection.week}.`
    : null;

  return {
    periodLabel,
    sourceNote: "Источник: Яндекс Вебмастер / seo_webmaster_queries_weekly.",
    fallbackNote,
  };
}

export function selectRowsForWeek<T extends { week: string }>(rows: T[], selectedWeek: string | null, fallbackWeek: string | null) {
  return resolveRowsForWeek(rows, selectedWeek, fallbackWeek).rows;
}

export function summarizeAiVisibility(rows: ZarukuAiVisibilityRow[]): AiVisibilitySummary {
  const summary = rows.reduce(
    (total, row) => ({
      checked: total.checked + 1,
      mentioned: total.mentioned + (row.mentioned ? 1 : 0),
      mentions: total.mentions + row.mention_count,
      citations: total.citations + row.citation_count,
    }),
    { checked: 0, mentioned: 0, mentions: 0, citations: 0 },
  );
  return {
    ...summary,
    presence_rate: summary.checked > 0 ? round((summary.mentioned / summary.checked) * 100, 2) : null,
  };
}
