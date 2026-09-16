import type { DatasetMeta, Period, SiteRegistration, SourceKey, TargetIntentObservedQuery, TargetIntentRuleSet, TargetIntentView } from "@reportingdash/site-seo-contract";
import { type AliceCanonicalData, type AvailableMetrikaWeeksReadExecutor, type CanonicalDatasetData, type CanonicalReadExecutor, type MetrikaCanonicalData, type SeoOsCanonicalData, type WebmasterCanonicalData, type WordstatCanonicalData } from "./db.ts";
import { loadGscView, type GscIndexingReasonRow } from "./gsc.ts";
import { buildTargetIntentView } from "./target-intent.ts";
import type { PeriodSelection } from "./period-selection.ts";
import { MissingSourceScopeError, resolveSourceScope, type SiteScopeClaim } from "./scope.ts";

export type DashboardReadModel = Readonly<{
  targetIntent: DashboardTargetIntentView;
  gsc: ReturnType<typeof loadGscView>;
  indexing: DatasetMeta;
  indexingRows?: readonly GscIndexingReasonRow[];
  datasets: Readonly<Partial<Record<SourceKey, DatasetMeta>>>;
  metrika: MetrikaCanonicalData | null;
  webmaster: WebmasterCanonicalData | null;
  wordstat: WordstatCanonicalData | null;
  alice: AliceCanonicalData | null;
  seoOs: SeoOsCanonicalData | null;
  trafficComparison: Readonly<Partial<Record<SourceKey, DatasetMeta | CanonicalDatasetData>>>;
}>;

export type TargetIntentSourceStatus = Readonly<{
  source: "google" | "yandex";
  included: boolean;
  meta: DatasetMeta | null;
  reason: "available" | "complete_empty" | "missing" | "failed" | "different_period" | "no_queries" | "invalid_metrics";
}>;

export type DashboardTargetIntentView = TargetIntentView & Readonly<{
  period: Period;
  sources: readonly TargetIntentSourceStatus[];
}>;

function missingMeta(): DatasetMeta {
  return {
    sourceKey: "google_search_console", period: null, state: "missing",
    collectionMode: "manual", completeness: "unknown", importId: null,
    exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none",
  };
}

function missingMetaFor(sourceKey: SourceKey, collectionMode: DatasetMeta["collectionMode"]): DatasetMeta {
  return { ...missingMeta(), sourceKey, collectionMode };
}

function isMetrikaData(value: DatasetMeta | CanonicalDatasetData): value is MetrikaCanonicalData {
  return "kind" in value && value.kind === "metrika";
}

function isWebmasterData(value: DatasetMeta | CanonicalDatasetData): value is WebmasterCanonicalData {
  return "kind" in value && value.kind === "webmaster";
}
function isWordstatData(value: DatasetMeta | CanonicalDatasetData): value is WordstatCanonicalData { return "kind" in value && value.kind === "wordstat"; }
function isAliceData(value: DatasetMeta | CanonicalDatasetData): value is AliceCanonicalData { return "kind" in value && value.kind === "alice"; }
function isSeoOsData(value: DatasetMeta | CanonicalDatasetData): value is SeoOsCanonicalData { return "kind" in value && value.kind === "seo_os"; }

function sameIntentPeriod(left: Period | null | undefined, right: Period): boolean {
  return left?.kind === right.kind && left.key === right.key && left.from === right.from && left.to === right.to
    && left.sourceTimezone === right.sourceTimezone;
}

function targetIntentSourceMeta(meta: DatasetMeta | null): DatasetMeta | null {
  if (!meta) return null;
  const {
    sourceKey, period, state, collectionMode, completeness, importId,
    exportedAt, loadedAt, freshness, latestAttempt,
  } = meta;
  return {
    sourceKey, period, state, collectionMode, completeness, importId,
    exportedAt, loadedAt, freshness, latestAttempt,
  };
}

function intentSource(input: Readonly<{
  source: "google" | "yandex";
  period: Period;
  meta: DatasetMeta | null;
  rows: readonly Readonly<{ query: string; metrics: Readonly<{ impressions: number; clicks: number }> }>[] | undefined;
}>): Readonly<{ status: TargetIntentSourceStatus; queries: readonly TargetIntentObservedQuery[] }> {
  let reason: TargetIntentSourceStatus["reason"] = "available";
  if (!input.meta || input.meta.state === "missing") reason = "missing";
  else if (input.meta.state === "failed") reason = "failed";
  else if (!sameIntentPeriod(input.meta.period, input.period)) reason = "different_period";
  else if (!input.rows?.length) reason = input.rows && input.meta.state === "complete_empty" ? "complete_empty" : "no_queries";
  else if (input.rows.some((row) => !row.query.trim() || !Number.isFinite(row.metrics.impressions) || row.metrics.impressions < 0 || !Number.isFinite(row.metrics.clicks) || row.metrics.clicks < 0)) reason = "invalid_metrics";
  const included = reason === "available" || reason === "complete_empty";
  return {
    status: { source: input.source, included, meta: targetIntentSourceMeta(input.meta), reason },
    queries: included ? (input.rows ?? []).map((row) => ({ query: row.query, source: input.source, impressions: row.metrics.impressions, clicks: row.metrics.clicks })) : [],
  };
}

export async function loadAvailableMetrikaWeeks(input: Readonly<{
  registration: SiteRegistration;
  claim: SiteScopeClaim;
  execute: AvailableMetrikaWeeksReadExecutor;
}>): Promise<readonly Period[]> {
  const source = input.registration.profile.sources.find((candidate) => candidate.sourceKey === "yandex_metrika" && candidate.mode !== "disabled");
  if (!source) return [];
  const scope = await resolveSourceScope(input.registration, input.claim, "yandex_metrika");
  const result = await input.execute({ name: "available_metrika_weeks", scope, timezone: input.registration.profile.businessTimezone });
  if (result.kind !== "available_metrika_weeks") throw new Error("Canonical Metrika period read returned an invalid result");
  return result.weeks;
}

export async function loadDashboardReadModel(input: Readonly<{
  registration: SiteRegistration;
  claim: SiteScopeClaim;
  selection: PeriodSelection;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
  execute: CanonicalReadExecutor;
}>): Promise<DashboardReadModel> {
  if (
    input.claim.dashboardId !== input.registration.profile.dashboardId ||
    input.claim.siteId !== input.registration.profile.siteId
  ) {
    throw new Error("Authenticated site scope does not match this profile");
  }
  const targetRuleSet = await input.execute({
    name: "target_intent",
    scope: {
      clientId: input.registration.profile.clientId,
      siteId: input.registration.profile.siteId,
      dashboardId: input.registration.profile.dashboardId,
    },
  }) as TargetIntentRuleSet;
  const useTargetIntent = targetRuleSet.state === "ready";
  const missingGsc = missingMeta();
  let gsc = { meta: missingGsc, summary: null, daily: [], dimensions: [], dimensionMeta: {} } as ReturnType<typeof loadGscView>;
  let indexing = missingGsc;
  let indexingRows: readonly GscIndexingReasonRow[] = [];
  let weeklyGsc = gsc;
  const gscSource = input.registration.profile.sources.find((source) => source.sourceKey === "google_search_console");
  if (gscSource && gscSource.mode !== "disabled") {
    try {
      const scope = await resolveSourceScope(input.registration, input.claim, "google_search_console");
      const rows = await input.execute({ name: "gsc", scope, period: input.selection.gsc, publicationId: input.publicationId, filters: input.filters }) as import("./gsc.ts").GscReadRows;
      gsc = loadGscView(rows, input.selection.gsc);
      indexing = rows.indexing;
      indexingRows = rows.indexingRows ?? [];
      if (useTargetIntent) {
        weeklyGsc = sameIntentPeriod(input.selection.gsc, input.selection.traffic.primary)
          ? gsc
          : loadGscView(await input.execute({ name: "gsc", scope, period: input.selection.traffic.primary, publicationId: null, filters: input.filters }) as import("./gsc.ts").GscReadRows, input.selection.traffic.primary);
      }
    } catch (error) {
      if (!(error instanceof MissingSourceScopeError)) throw error;
    }
  }

  const datasets: Partial<Record<SourceKey, DatasetMeta>> = { google_search_console: gsc.meta };
  const trafficComparison: Partial<Record<SourceKey, DatasetMeta | CanonicalDatasetData>> = {};
  let metrika: MetrikaCanonicalData | null = null;
  let webmaster: WebmasterCanonicalData | null = null;
  let wordstat: WordstatCanonicalData | null = null;
  let alice: AliceCanonicalData | null = null;
  let seoOs: SeoOsCanonicalData | null = null;
  for (const source of input.registration.profile.sources) {
    if (source.sourceKey === "google_search_console") continue;
    if (source.mode === "disabled") {
      datasets[source.sourceKey] = missingMetaFor(source.sourceKey, "derived");
      continue;
    }
    try {
      const scope = await resolveSourceScope(input.registration, input.claim, source.sourceKey);
      const period = source.sourceKey === "yandex_webmaster_alice_manual" ? input.selection.alice : input.selection.traffic.primary;
      const data = await input.execute({ name: "dataset", scope, period, publicationId: input.publicationId, filters: input.filters }) as DatasetMeta | CanonicalDatasetData;
      datasets[source.sourceKey] = data;
      if (isMetrikaData(data)) metrika = data;
      if (isWebmasterData(data)) webmaster = data;
      if (isWordstatData(data)) wordstat = data;
      if (isAliceData(data)) alice = data;
      if (isSeoOsData(data)) seoOs = data;
      if (input.selection.traffic.comparison && (source.sourceKey === "yandex_metrika" || source.sourceKey === "yandex_webmaster")) {
        trafficComparison[source.sourceKey] = await input.execute({ name: "dataset", scope, period: input.selection.traffic.comparison, publicationId: input.publicationId, filters: input.filters }) as DatasetMeta | CanonicalDatasetData;
      }
    } catch (error) {
      if (!(error instanceof MissingSourceScopeError)) throw error;
      datasets[source.sourceKey] = missingMetaFor(source.sourceKey, source.mode === "manual" ? "manual" : "automated");
    }
  }
  const targetPeriod = input.selection.traffic.primary;
  const googleIntent = intentSource({
    source: "google",
    period: targetPeriod,
    meta: weeklyGsc.meta.state === "failed" ? weeklyGsc.meta : weeklyGsc.dimensionMeta.query ?? null,
    rows: weeklyGsc.dimensions.filter((row) => row.dimension === "query").map((row) => ({ query: row.value, metrics: row.metrics })),
  });
  const yandexIntent = intentSource({
    source: "yandex",
    period: targetPeriod,
    meta: webmaster ?? datasets.yandex_webmaster ?? null,
    rows: webmaster?.queryFacts,
  });
  const intentSources = [googleIntent, yandexIntent] as const;
  const hasIncludedSource = intentSources.some(({ status }) => status.included);
  const effectiveRuleSet = targetRuleSet.state === "ready" && !hasIncludedSource
    ? { ...targetRuleSet, state: "unavailable" as const }
    : targetRuleSet;
  const targetIntent: DashboardTargetIntentView = {
    ...buildTargetIntentView({
      siteId: input.registration.profile.siteId,
      dashboardId: input.registration.profile.dashboardId,
      label: targetRuleSet.label || "Целевой интент",
      ruleSet: effectiveRuleSet,
      queries: intentSources.flatMap(({ queries }) => queries),
    }),
    period: targetPeriod,
    sources: intentSources.map(({ status }) => status),
  };
  return {
    targetIntent, gsc, indexing, indexingRows, datasets, metrika, webmaster, wordstat, alice, seoOs, trafficComparison,
  };
}
