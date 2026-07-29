import type { AbbottBiUserActionRow } from "@/lib/types";

export const ABBOTT_WITHOUT_UTM = "__without_utm__";

export type AbbottFilterOption = { value: string; label: string };

export type AbbottUserActionFilters = {
  query?: string;
  user_id?: string;
  user_id_traffic?: string;
  traffic_source?: string;
  utm_source?: string;
  direction?: string;
  traffic_source_label?: (value: string) => string;
};

function normalizedUtmSource(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function buildAbbottUtmSourceOptions(
  rows: readonly AbbottBiUserActionRow[],
): AbbottFilterOption[] {
  const exact = new Set<string>();
  let hasMissing = false;
  rows.forEach((row) => {
    const value = normalizedUtmSource(row.utm_source);
    if (value === null) hasMissing = true;
    else exact.add(value);
  });
  return [
    ...(hasMissing ? [{ value: ABBOTT_WITHOUT_UTM, label: "Без UTM" }] : []),
    ...[...exact]
      .sort((left, right) => left.localeCompare(right, "ru"))
      .map((value) => ({ value, label: value })),
  ];
}

export function selectAbbottUserActions(
  rows: readonly AbbottBiUserActionRow[],
  filters: AbbottUserActionFilters,
  page: number,
  pageSize: number,
) {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const filteredRows = rows.filter((row) => {
    const utmSource = normalizedUtmSource(row.utm_source);
    if (query) {
      const trafficSource = filters.traffic_source_label?.(row.traffic_source) ?? row.traffic_source;
      const values = [
        row.has_user_id ? row.user_id : "Без User ID",
        trafficSource,
        utmSource ?? "Без UTM",
        row.direction,
        row.start_url,
        row.end_url,
        row.visits,
      ];
      if (!values.some((value) => String(value ?? "").toLowerCase().includes(query))) return false;
    }
    if (filters.user_id && row.user_id !== filters.user_id) return false;
    if (filters.user_id_traffic === "with_user_id" && !row.has_user_id) return false;
    if (filters.user_id_traffic === "without_user_id" && row.has_user_id) return false;
    if (filters.traffic_source && row.traffic_source !== filters.traffic_source) return false;
    if (filters.utm_source === ABBOTT_WITHOUT_UTM && utmSource !== null) return false;
    if (
      filters.utm_source
      && filters.utm_source !== ABBOTT_WITHOUT_UTM
      && utmSource !== filters.utm_source
    ) return false;
    if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
    return true;
  });
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / safePageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (currentPage - 1) * safePageSize;
  return {
    filteredRows,
    pageRows: filteredRows.slice(start, start + safePageSize),
    currentPage,
    totalPages,
  };
}
