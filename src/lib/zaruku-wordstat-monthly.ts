import type { ZarukuWordstatMonthlyRow } from "@/lib/types";

export function wordstatCalendarMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid calendar month");
  const from = `${month}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** Native monthly identity; no overlap totals, daily interpolation or missing-as-zero. */
export function calculateWordstatMonthlyGrowth(rows: ZarukuWordstatMonthlyRow[], month: string, expectedSeeds?: Array<Pick<ZarukuWordstatMonthlyRow, "seed_hash" | "registry_version" | "query" | "region_scope" | "device_type">> | null) {
  const current_period = wordstatCalendarMonth(month);
  const previousDate = new Date(`${current_period.from}T00:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous_period = wordstatCalendarMonth(previousDate.toISOString().slice(0, 7));
  const grouped = new Map<string, { row: Omit<ZarukuWordstatMonthlyRow, "count"> & { count?: number }; buckets: Map<string, number | null> }>();
  const identity = (row: Pick<ZarukuWordstatMonthlyRow, "seed_hash" | "registry_version" | "region_scope" | "device_type">) => JSON.stringify([row.registry_version, row.seed_hash, row.region_scope, row.device_type]);
  if (expectedSeeds) for (const seed of expectedSeeds) grouped.set(identity(seed), { row: { ...seed, topic: null, cluster: null, month_from: current_period.from, month_to: current_period.to }, buckets: new Map() });
  for (const row of rows) {
    if (!Number.isSafeInteger(row.count) || row.count < 0 || !row.seed_hash || !row.registry_version) continue;
    let bounds;
    try { bounds = wordstatCalendarMonth(row.month_from.slice(0, 7)); } catch { continue; }
    if (bounds.from !== row.month_from || bounds.to !== row.month_to) continue;
    if (row.month_from !== current_period.from && row.month_from !== previous_period.from) continue;
    const key = identity(row);
    if (expectedSeeds && !grouped.has(key)) continue;
    let group = grouped.get(key);
    if (!group) { group = { row, buckets: new Map() }; grouped.set(key, group); }
    if (row.month_from === current_period.from || group.row.count == null) group.row = row;
    group.buckets.set(row.month_from, group.buckets.has(row.month_from) ? null : row.count);
  }
  const comparisonRows = [...grouped.values()].map(({ row, buckets }) => {
    const current_count = buckets.get(current_period.from) ?? null;
    const previous_count = buckets.get(previous_period.from) ?? null;
    const absolute_change = current_count != null && previous_count != null ? current_count - previous_count : null;
    return { ...row, current_count, previous_count, absolute_change,
      percent_change: previous_count != null && previous_count > 0 && absolute_change != null ? absolute_change / previous_count * 100 : null,
      new_from_zero: previous_count === 0 && current_count != null && current_count > 0 };
  }).sort((a, b) => a.query.localeCompare(b.query) || a.seed_hash.localeCompare(b.seed_hash));
  return { current_period, previous_period, rows: comparisonRows,
    received_count: comparisonRows.filter(row => row.current_count != null).length,
    comparable_count: comparisonRows.filter(row => row.absolute_change != null).length,
    growing_count: comparisonRows.filter(row => row.absolute_change != null && row.absolute_change > 0).length };
}
