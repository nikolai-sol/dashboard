import type { ZarukuSeoRunRow } from "@/lib/types";

export function hasHistoricalZeroTelemetry(runs: ZarukuSeoRunRow[]): boolean {
  const latestWeek = runs.map((run) => run.week).sort((left, right) => left.localeCompare(right)).at(-1);
  if (!latestWeek) return false;
  return runs.some((run) => run.week !== latestWeek
    && (run.status === "completed" || run.status === "noop")
    && run.serp_requests === 0
    && run.llm_tokens === 0);
}
