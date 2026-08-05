import type { AbbottBiPageStatRow } from "@/lib/types";

function normalizeSearchValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase("ru");
}

type AbbottPageStatsFilters = {
  query: string;
  pageTitleQuery: string;
  direction: string;
  materialTypes: string[];
  access: string;
};

export function matchesSelectedMaterialType(materialType: string | null, selectedTypes: string[]) {
  if (selectedTypes.length === 0) return true;
  return selectedTypes.includes(String(materialType ?? ""));
}

export function matchesPageStatsSearch(pageTitle: string, url: string, query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;
  return [pageTitle, url].some((value) => normalizeSearchValue(value).includes(normalizedQuery));
}

export function filterAbbottPageStatsRows(rows: AbbottBiPageStatRow[], filters: AbbottPageStatsFilters) {
  const normalizedQuery = normalizeSearchValue(filters.query);
  return rows.filter((row) => {
    if (
      normalizedQuery &&
      ![
        row.page_title,
        row.url,
        row.direction,
        row.material_type,
        row.access,
        row.pageviews,
        row.users,
        row.bitrix_pageviews,
        row.bitrix_sessions,
        row.bitrix_users,
      ].some((value) => normalizeSearchValue(String(value ?? "")).includes(normalizedQuery))
    ) {
      return false;
    }
    if (!matchesPageStatsSearch(row.page_title, row.url, filters.pageTitleQuery)) return false;
    if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
    if (!matchesSelectedMaterialType(row.material_type, filters.materialTypes)) return false;
    if (filters.access && (row.access ?? "") !== filters.access) return false;
    return true;
  });
}

export function summarizeAbbottPageStats(rows: AbbottBiPageStatRow[]) {
  return rows.reduce(
    (totals, row) => ({
      pageviews: totals.pageviews + row.pageviews,
      users: totals.users + row.users,
    }),
    { pageviews: 0, users: 0 },
  );
}

const unnamedDirections = new Set(["", "—", "Без значения", "Без названия", "Без направления"]);

export function buildAbbottPageviewsByDirection(rows: AbbottBiPageStatRow[], limit = 8) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const direction = String(row.direction ?? "").trim();
    if (unnamedDirections.has(direction)) return;
    totals.set(direction, (totals.get(direction) ?? 0) + row.pageviews);
  });

  return Array.from(totals, ([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "ru"))
    .slice(0, Math.max(0, limit));
}

export function buildAbbottPageStatsExportRows(rows: AbbottBiPageStatRow[]): Array<Record<string, string | number>> {
  return rows.map((row) => ({
    "Заголовок страницы": row.page_title || "—",
    URL: row.url || "—",
    Направление: row.direction || "—",
    "Тип материала": row.material_type || "—",
    Доступ: row.access || "—",
    "Просмотры Метрики": row.pageviews,
    "Пользователи Метрики (page-level)": row.users,
    "Просмотры Bitrix": row.bitrix_pageviews,
    "Сессии Bitrix": row.bitrix_sessions,
    "User ID Bitrix": row.bitrix_users,
    "Сессии с User ID": row.bitrix_logged_in_sessions,
    "Анонимные сессии": row.bitrix_anonymous_sessions,
    "Средняя сессия Bitrix, мин": Number((row.bitrix_avg_session_duration / 60).toFixed(2)),
  }));
}
