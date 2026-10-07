import type { IntentDailyRow, IntentPeriod, IntentRange, IntentView } from "./types";

export const ZARUKU_INTENT_VERSION = "zaruku_intent_v1_20261007";
const BUCKETS = ["medical", "noise", "brand", "uncertain", "other"] as const;
const DAY = 86400000;
function shift(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
function dates(range: IntentRange) {
  if (!Number.isFinite(Date.parse(range.from)) || !Number.isFinite(Date.parse(range.to)) || range.from > range.to) throw new Error("Invalid intent period");
  const result: string[] = [];
  for (let date = range.from; date <= range.to; date = shift(date, 1)) result.push(date);
  return result;
}
export function previousIntentRange(current: IntentRange): IntentRange {
  const start = new Date(`${current.from}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (current.from.endsWith("-01") && current.to === monthEnd) return {
    from: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
    to: shift(current.from, -1),
  };
  return { from: shift(current.from, -dates(current).length), to: shift(current.from, -1) };
}
export function normalizeIntentDailyRow(row: Record<string, unknown>): IntentDailyRow {
  const count = (value: unknown) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || value == null) throw new Error("Invalid intent count");
    return number;
  };
  if (!BUCKETS.includes(row.bucket as IntentDailyRow["bucket"]) || !["complete", "observed_unknown"].includes(String(row.source_coverage))) throw new Error("Invalid intent evidence");
  return { date: row.report_date instanceof Date ? row.report_date.toISOString().slice(0, 10) : String(row.report_date).slice(0, 10), bucket: row.bucket as IntentDailyRow["bucket"], queryRows: count(row.query_rows), impressions: count(row.impressions), clicks: count(row.clicks), sourceCoverage: row.source_coverage as IntentDailyRow["sourceCoverage"], ingestionRunId: String(row.ingestion_run_id) };
}
function period(rows: IntentDailyRow[], requested: IntentRange): IntentPeriod {
  const requestedDates = dates(requested);
  const grouped = new Map<string, IntentDailyRow[]>();
  for (const row of rows) {
    if (row.date < requested.from || row.date > requested.to) continue;
    grouped.set(row.date, [...(grouped.get(row.date) ?? []), row]);
  }
  const usableDates = requestedDates.filter(date => {
    const day = grouped.get(date) ?? [];
    return day.length === 5 && BUCKETS.every(bucket => day.filter(row => row.bucket === bucket).length === 1)
      && day.every(row => [row.impressions, row.clicks, row.queryRows].every(value => Number.isSafeInteger(value) && value >= 0));
  });
  const used = usableDates.flatMap(date => grouped.get(date)!);
  const missingDates = requestedDates.filter(date => !usableDates.includes(date));
  const availableRanges: IntentRange[] = [];
  for (const date of usableDates) {
    const last = availableRanges.at(-1);
    if (last && shift(last.to, 1) === date) last.to = date;
    else availableRanges.push({ from: date, to: date });
  }
  const sum = (key: "impressions" | "clicks", bucket?: string) => used.length ? used.filter(row => !bucket || row.bucket === bucket).reduce((total, row) => total + row[key], 0) : null;
  const impressions = sum("impressions"), clicks = sum("clicks");
  const medicalImpressions = sum("impressions", "medical"), medicalClicks = sum("clicks", "medical");
  const noiseImpressions = sum("impressions", "noise"), noiseClicks = sum("clicks", "noise");
  const share = (count: number | null, total: number | null) => count != null && total != null && total > 0 ? count / total * 100 : null;
  return { requested, availableRanges, missingDates, completeness: !used.length ? "unavailable" : missingDates.length ? "partial" : used.every(row => row.sourceCoverage === "complete") ? "complete" : "unverified", impressions, clicks, medicalImpressions, medicalClicks, noiseImpressions, noiseClicks,
    medicalImpressionShare: share(medicalImpressions, impressions), medicalClickShare: share(medicalClicks, clicks), noiseImpressionShare: share(noiseImpressions, impressions), noiseClickShare: share(noiseClicks, clicks) };
}
export function buildIntentView(rows: IntentDailyRow[], currentRange: IntentRange, previousRange: IntentRange): IntentView {
  const current = period(rows, currentRange), previous = period(rows, previousRange);
  const weekly: IntentPeriod[] = [];
  for (let from = currentRange.from; from <= currentRange.to;) {
    const weekday = new Date(`${from}T00:00:00Z`).getUTCDay() || 7;
    const to = [shift(from, 7 - weekday), currentRange.to].sort()[0];
    weekly.push(period(rows, { from, to }));
    from = shift(to, 1);
  }
  const delta = (key: "medicalImpressionShare" | "medicalClickShare" | "noiseImpressionShare" | "noiseClickShare") => current.completeness === "complete" && previous.completeness === "complete" && current[key] != null && previous[key] != null ? current[key]! - previous[key]! : null;
  return { classifierVersion: ZARUKU_INTENT_VERSION, current, previous, weekly, deltas: { medicalImpressionPp: delta("medicalImpressionShare"), medicalClickPp: delta("medicalClickShare"), noiseImpressionPp: delta("noiseImpressionShare"), noiseClickPp: delta("noiseClickShare") } };
}
