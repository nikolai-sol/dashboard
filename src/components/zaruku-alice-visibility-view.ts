import type { ZarukuAliceVisibilityQuery, ZarukuAliceVisibilitySnapshot } from "@/lib/types";

export const ALICE_QUERY_PAGE_SIZE = 25;

export type AlicePresenceFilter = "all" | "present" | "absent";

export type AliceQueryFilter = {
  text: string;
  presence: AlicePresenceFilter;
};

export type AliceDetailState = "ready" | "summary-only" | "empty";

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
