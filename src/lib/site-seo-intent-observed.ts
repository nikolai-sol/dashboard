import { createHash } from "node:crypto";
import { classifyTargetIntentQuery, type TargetIntentObservedSample, type TargetIntentRule } from "@reportingdash/site-seo-contract";
import type { TargetIntentScope } from "./site-seo-intent-store";

type Database = { execute(sql: string, params?: readonly unknown[]): Promise<unknown> };
type Binding = TargetIntentScope & { sourceKey: string; analyticsAccountId: string; resourceId: string };
type Row = { query_text?: unknown; impressions?: unknown; clicks?: unknown; period_from?: unknown; period_to?: unknown };
// Same all-country/all-device web-search identity as the dashboard's default GSC view.
const defaultFiltersHash = createHash("sha256").update('{"country":"all","device":"all","search_type":"web"}').digest("hex");

function rows(value: unknown): Row[] {
  return Array.isArray(value) && Array.isArray(value[0]) ? value[0] as Row[] : [];
}
function date(value: unknown): string | null {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) ? text : null;
}
function sample(source: "google" | "yandex", data: Row[], rules: readonly TargetIntentRule[], period?: { from: string; to: string }): TargetIntentObservedSample {
  const periodFrom = period?.from ?? date(data[0]?.period_from);
  const periodTo = period?.to ?? date(data[0]?.period_to);
  const candidates = data.slice(0, 100).filter(row => typeof row.query_text === "string" && row.query_text.trim()
    && Number.isFinite(Number(row.impressions)) && Number(row.impressions) > 0
    && Number.isFinite(Number(row.clicks)) && Number(row.clicks) >= 0);
  if (data.length && (!periodFrom || !periodTo || candidates.length !== Math.min(data.length, 100))) throw new Error("Invalid canonical sample");
  return { source, state: candidates.length ? "ready" : "empty", periodFrom, periodTo, sampledQueryCount: candidates.length,
    matches: candidates.map(row => ({ query: String(row.query_text), source, impressions: Number(row.impressions), clicks: Number(row.clicks), ...classifyTargetIntentQuery(String(row.query_text), rules) }))
      .filter(row => row.category === "target").slice(0, 8) };
}
const unavailable = (source: "google" | "yandex"): TargetIntentObservedSample => ({ source, state: "unavailable", periodFrom: null, periodTo: null, sampledQueryCount: 0, matches: [] });

/** Read-only examples, not weekly report totals: latest published GSC week and
 * seven canonical days ending at the latest Webmaster fact date, independently. */
export async function readTargetIntentObservedQueries(database: Database, scope: TargetIntentScope, rules: readonly TargetIntentRule[], bindings: readonly Binding[] = []): Promise<readonly TargetIntentObservedSample[]> {
  let google: TargetIntentObservedSample;
  try {
    const data = rows(await database.execute(`/* target-intent:observed-google */
      WITH chosen_import AS (
        SELECT i.id, i.period_from, i.period_to
          FROM canonical_seo_manual_imports i
          JOIN canonical_seo_manual_coverage c ON c.import_id = i.id AND c.layer_name = 'query'
         WHERE i.client_id = ? AND i.site_id = ? AND i.dashboard_id = ?
           AND i.source_key = 'google_search_console' AND i.status = 'published'
           AND i.period_kind = 'iso_week' AND i.filters_hash = ?
           AND c.coverage_state IN ('complete', 'limited', 'complete_empty')
         ORDER BY i.period_to DESC, c.publication_priority DESC, i.revision DESC, i.id DESC LIMIT 1
      )
      SELECT d.dimension_value AS query_text, d.impressions, d.clicks, i.period_from, i.period_to
        FROM chosen_import i JOIN canonical_fact_gsc_manual_period_dimensions d ON d.import_id = i.id
       WHERE d.dimension_name = 'query' AND d.impressions > 0
       ORDER BY d.impressions DESC, d.clicks DESC, d.dimension_value ASC LIMIT 100`,
    [scope.clientId, scope.siteId, scope.dashboardId, defaultFiltersHash]));
    google = sample("google", data, rules);
  } catch { google = unavailable("google"); }

  const candidates = bindings.filter(binding => binding.siteId === scope.siteId && binding.clientId === scope.clientId
    && binding.dashboardId === scope.dashboardId && binding.sourceKey === "yandex_webmaster");
  let yandex = unavailable("yandex");
  if (candidates.length === 1) {
    const binding = candidates[0];
    const params = [binding.sourceKey, binding.analyticsAccountId, binding.resourceId];
    try {
      const latest = rows(await database.execute(`/* target-intent:latest-webmaster-date */
        SELECT MAX(report_date) AS period_to FROM canonical_fact_webmaster_queries_daily
         WHERE source_key = ? AND analytics_account_id = ? AND host_id = ? AND device_type = 'ALL'`, params));
      const to = date(latest[0]?.period_to);
      if (to) {
        const from = new Date(Date.parse(to) - 6 * 86_400_000).toISOString().slice(0, 10);
        const data = rows(await database.execute(`/* target-intent:observed-yandex */
          SELECT query_text, SUM(impressions) AS impressions, SUM(clicks) AS clicks
            FROM canonical_fact_webmaster_queries_daily
           WHERE source_key = ? AND analytics_account_id = ? AND host_id = ? AND device_type = 'ALL'
             AND report_date BETWEEN ? AND ? GROUP BY query_text HAVING SUM(impressions) > 0
           ORDER BY impressions DESC, clicks DESC, query_text ASC LIMIT 100`, [...params, from, to]));
        yandex = sample("yandex", data, rules, { from, to });
      } else yandex = sample("yandex", [], rules);
    } catch { yandex = unavailable("yandex"); }
  }
  return [google, yandex];
}
