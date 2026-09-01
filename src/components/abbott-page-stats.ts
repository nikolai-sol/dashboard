import type { AbbottBiPageStatRow } from "@/lib/types";

export const ABBOTT_UNMAPPED_LABEL = "Не определено";

export function labelAbbottPageDimension(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || ABBOTT_UNMAPPED_LABEL;
}

export function matchesSelectedPageDimension(value: string | null | undefined, selectedValue: string) {
  return !selectedValue || labelAbbottPageDimension(value) === selectedValue;
}

function normalizeSearchValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase("ru");
}

type AbbottPageStatsFilters = {
  query: string;
  pageTitleQuery: string;
  direction: string;
  mnn: string[];
  materialTypes: string[];
  access: string;
};

export function matchesSelectedMaterialType(materialType: string | null, selectedTypes: string[]) {
  if (selectedTypes.length === 0) return true;
  return selectedTypes.includes(labelAbbottPageDimension(materialType));
}

export function matchesSelectedMnn(mnn: string[] | null | undefined, selectedMnn: string[]) {
  if (selectedMnn.length === 0) return true;
  const values = (mnn ?? []).map((value) => String(value).trim()).filter(Boolean);
  if (values.length === 0) return selectedMnn.includes(ABBOTT_UNMAPPED_LABEL);
  return values.some((value) => selectedMnn.includes(value));
}

export function buildAbbottPageDimensionOptions<T>(
  rows: T[],
  keySelector: (row: T) => string | null | undefined,
) {
  return [...new Set(rows.map((row) => labelAbbottPageDimension(keySelector(row))))]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((value) => ({ value, label: value }));
}

export function groupAbbottPageStatsByDimension<T>(
  rows: T[],
  keySelector: (row: T) => string | null | undefined,
  valueSelector: (row: T) => number,
) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const label = labelAbbottPageDimension(keySelector(row));
    totals.set(label, (totals.get(label) ?? 0) + valueSelector(row));
  });
  return Array.from(totals, ([label, value]) => ({ label, value })).sort(
    (left, right) => right.value - left.value || left.label.localeCompare(right.label, "ru"),
  );
}

export function limitAbbottPageDimensionGroups(
  groups: Array<{ label: string; value: number }>,
  mappedLimit = 8,
) {
  const unmapped = groups.filter((group) => group.label === ABBOTT_UNMAPPED_LABEL);
  const mapped = groups.filter((group) => group.label !== ABBOTT_UNMAPPED_LABEL);
  return [...mapped.slice(0, Math.max(0, mappedLimit)), ...unmapped].sort(
    (left, right) => right.value - left.value || left.label.localeCompare(right.label, "ru"),
  );
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
        ...(row.mnn ?? []),
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
    if (!matchesSelectedMnn(row.mnn, filters.mnn)) return false;
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

export function buildAbbottPageviewsByDirection(rows: AbbottBiPageStatRow[], limit = 8) {
  return limitAbbottPageDimensionGroups(
    groupAbbottPageStatsByDimension(rows, (row) => row.direction, (row) => row.pageviews),
    limit,
  );
}

export function summarizeAbbottPageMetadataCoverage(rows: AbbottBiPageStatRow[]) {
  return rows.reduce(
    (coverage, row) => {
      const mapped = String(row.material_type ?? "").trim().length > 0;
      return {
        mappedRows: coverage.mappedRows + Number(mapped),
        totalRows: coverage.totalRows + 1,
        mappedPageviews: coverage.mappedPageviews + (mapped ? row.pageviews : 0),
        totalPageviews: coverage.totalPageviews + row.pageviews,
      };
    },
    { mappedRows: 0, totalRows: 0, mappedPageviews: 0, totalPageviews: 0 },
  );
}

export function buildAbbottPageStatsExportRows(rows: AbbottBiPageStatRow[]): Array<Record<string, string | number>> {
  return rows.map((row) => ({
    "Заголовок страницы": row.page_title || "—",
    URL: row.url || "—",
    Направление: labelAbbottPageDimension(row.direction),
    МНН: row.mnn?.length ? row.mnn.join("; ") : ABBOTT_UNMAPPED_LABEL,
    "Тип материала": labelAbbottPageDimension(row.material_type),
    Доступ: labelAbbottPageDimension(row.access),
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
