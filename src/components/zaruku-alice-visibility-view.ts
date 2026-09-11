import type { ZarukuAliceVisibilityQuery, ZarukuAliceVisibilitySnapshot } from "@/lib/types";

export const ALICE_QUERY_PAGE_SIZE = 25;

export type AlicePresenceFilter = "all" | "present" | "absent";

export type AliceQueryFilter = {
  text: string;
  presence: AlicePresenceFilter;
};

export type AliceDetailState = "ready" | "summary-only" | "empty";

export type AliceHistoryChartRow = {
  month: string;
  sov: number | null;
};

export type AliceHistoryChart = {
  rows: AliceHistoryChartRow[];
  width: number;
};

const ALICE_HISTORY_MONTH_WIDTH = 112;
const ALICE_HISTORY_MIN_WIDTH = 240;

const RUSSIAN_MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
] as const;

export function formatAliceMonthLabel(month: string, locale: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return month;
  const [, year, monthNumber] = match;
  if (locale.toLowerCase().startsWith("ru")) {
    return `${RUSSIAN_MONTHS[Number(monthNumber) - 1]} ${year} г.`;
  }
  return month;
}

export function selectAliceSnapshot(
  snapshots: ZarukuAliceVisibilitySnapshot[],
  month: string | null,
): ZarukuAliceVisibilitySnapshot | null {
  if (month) {
    const selected = snapshots.find((snapshot) => snapshot.month === month);
    if (selected) return selected;
  }
  return [...snapshots].sort((left, right) => right.month.localeCompare(left.month))[0] ?? null;
}

function aliceMonthOrdinal(month: string): number | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function aliceMonthFromOrdinal(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = ordinal % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function buildAliceHistoryChart(
  snapshots: Array<Pick<ZarukuAliceVisibilitySnapshot, "month" | "officialSovPct">>,
): AliceHistoryChart {
  const ordered = [...snapshots].sort((left, right) => left.month.localeCompare(right.month));
  const ordinals = ordered.map((snapshot) => aliceMonthOrdinal(snapshot.month));
  const allMonthsAreCanonical = ordinals.every((ordinal): ordinal is number => ordinal != null);
  const values = new Map(ordered.map((snapshot) => [snapshot.month, snapshot.officialSovPct]));
  const rows = allMonthsAreCanonical && ordinals.length > 0
    ? Array.from({ length: ordinals.at(-1)! - ordinals[0]! + 1 }, (_, index) => {
      const month = aliceMonthFromOrdinal(ordinals[0]! + index);
      return { month, sov: values.get(month) ?? null };
    })
    : ordered.map((snapshot) => ({ month: snapshot.month, sov: snapshot.officialSovPct }));

  return {
    rows,
    width: Math.max(ALICE_HISTORY_MIN_WIDTH, rows.length * ALICE_HISTORY_MONTH_WIDTH),
  };
}

export function monthlySovDelta(
  snapshots: Array<Pick<ZarukuAliceVisibilitySnapshot, "month" | "officialSovPct">>,
  month: string | null,
): number | null {
  if (!month) return null;
  const ordered = [...snapshots].sort((left, right) => left.month.localeCompare(right.month));
  const index = ordered.findIndex((snapshot) => snapshot.month === month);
  if (index < 1) return null;
  return Number((ordered[index].officialSovPct - ordered[index - 1].officialSovPct).toFixed(2));
}

export function filterAliceQueries(
  rows: ZarukuAliceVisibilityQuery[],
  filter: AliceQueryFilter,
): ZarukuAliceVisibilityQuery[] {
  const text = filter.text.trim().toLocaleLowerCase("ru-RU");
  return rows
    .filter((row) => filter.presence === "all" || (filter.presence === "present" ? row.portalPresent : !row.portalPresent))
    .filter((row) => !text || row.queryText.toLocaleLowerCase("ru-RU").includes(text))
    .map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.queryText.localeCompare(right.row.queryText, "ru-RU") || left.index - right.index)
    .map(({ row }) => row);
}

export function paginateAliceQueries(rows: ZarukuAliceVisibilityQuery[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / ALICE_QUERY_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * ALICE_QUERY_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + ALICE_QUERY_PAGE_SIZE),
    page,
    totalPages,
    totalRows: rows.length,
  };
}

export function aliceDetailState(snapshot: ZarukuAliceVisibilitySnapshot | null): AliceDetailState {
  if (!snapshot) return "empty";
  return snapshot.queries.length > 0 ? "ready" : "summary-only";
}
