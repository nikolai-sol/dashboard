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

function aggregateAbbottUserActions(
  rows: readonly AbbottBiUserActionRow[],
  trafficSourceLabel?: (value: string) => string,
): AbbottBiUserActionRow[] {
  const groups = new Map<
    string,
    { row: AbbottBiUserActionRow; durationTotal: number; pageviewsTotal: number }
  >();

  rows.forEach((sourceRow) => {
    const hasUserId = Boolean(sourceRow.has_user_id);
    const userId = hasUserId ? sourceRow.user_id : "";
    const utmSource = normalizedUtmSource(sourceRow.utm_source);
    const direction = sourceRow.direction?.trim() || null;
    const trafficSource = sourceRow.traffic_source.trim();
    const displayedTrafficSource = (trafficSourceLabel?.(trafficSource) ?? trafficSource).trim();
    const endUrl = sourceRow.end_url.trim();
    const visits = sourceRow.visits;
    const key = JSON.stringify([
      hasUserId,
      userId,
      displayedTrafficSource,
      utmSource,
      direction,
      endUrl,
    ]);
    const current = groups.get(key) ?? {
      row: {
        ...sourceRow,
        user_id: userId,
        has_user_id: hasUserId,
        traffic_source: trafficSource,
        utm_source: utmSource,
        direction,
        start_url: "",
        end_url: endUrl,
        visits: 0,
        avg_duration: 0,
        page_depth: 0,
      },
      durationTotal: 0,
      pageviewsTotal: 0,
    };
    current.row.visits += visits;
    current.durationTotal += sourceRow.avg_duration * visits;
    current.pageviewsTotal += sourceRow.page_depth * visits;
    groups.set(key, current);
  });

  return [...groups.values()]
    .map(({ row, durationTotal, pageviewsTotal }) => ({
      ...row,
      avg_duration: row.visits > 0
        ? durationTotal / row.visits
        : 0,
      page_depth: row.visits > 0
        ? pageviewsTotal / row.visits
        : 0,
    }))
    .sort((left, right) =>
      right.visits - left.visits
      || left.user_id.localeCompare(right.user_id)
      || left.traffic_source.localeCompare(right.traffic_source)
      || (left.utm_source ?? "").localeCompare(right.utm_source ?? "")
      || (left.direction ?? "").localeCompare(right.direction ?? "", "ru")
      || left.end_url.localeCompare(right.end_url)
    );
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
  const structurallyFilteredRows = rows.filter((row) => {
    const utmSource = normalizedUtmSource(row.utm_source);
    if (filters.user_id && row.user_id !== filters.user_id) return false;
    if (filters.user_id_traffic === "with_user_id" && !row.has_user_id) return false;
    if (filters.user_id_traffic === "without_user_id" && row.has_user_id) return false;
    if (filters.traffic_source && row.traffic_source.trim() !== filters.traffic_source) return false;
    if (filters.utm_source === ABBOTT_WITHOUT_UTM && utmSource !== null) return false;
    if (
      filters.utm_source
      && filters.utm_source !== ABBOTT_WITHOUT_UTM
      && utmSource !== filters.utm_source
    ) return false;
    if (filters.direction && (row.direction?.trim() ?? "") !== filters.direction) return false;
    return true;
  });
  const filteredRows = aggregateAbbottUserActions(
    structurallyFilteredRows,
    filters.traffic_source_label,
  ).filter((row) => {
    if (!query) return true;
    const trafficSource = filters.traffic_source_label?.(row.traffic_source) ?? row.traffic_source;
    const values = [
      row.has_user_id ? row.user_id : "Без User ID",
      trafficSource,
      normalizedUtmSource(row.utm_source) ?? "Без UTM",
      row.direction,
      row.end_url,
      row.visits,
    ];
    return values.some((value) => String(value ?? "").toLowerCase().includes(query));
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
