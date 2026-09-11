import type { DatasetMeta, Period, SiteRegistration, SourceKey } from "@reportingdash/site-seo-contract";
import { type AliceCanonicalData, type AvailableMetrikaWeeksReadExecutor, type CanonicalDatasetData, type CanonicalReadExecutor, type MetrikaCanonicalData, type SeoOsCanonicalData, type WebmasterCanonicalData, type WordstatCanonicalData } from "./db.ts";
import { loadGscView } from "./gsc.ts";
import type { PeriodSelection } from "./period-selection.ts";
import { MissingSourceScopeError, resolveSourceScope, type SiteScopeClaim } from "./scope.ts";

export type DashboardReadModel = Readonly<{
  gsc: ReturnType<typeof loadGscView>;
  indexing: DatasetMeta;
  datasets: Readonly<Partial<Record<SourceKey, DatasetMeta>>>;
  metrika: MetrikaCanonicalData | null;
  webmaster: WebmasterCanonicalData | null;
  wordstat: WordstatCanonicalData | null;
  alice: AliceCanonicalData | null;
  seoOs: SeoOsCanonicalData | null;
  trafficComparison: Readonly<Partial<Record<SourceKey, DatasetMeta | CanonicalDatasetData>>>;
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
  const missingGsc = missingMeta();
  let gsc = { meta: missingGsc, summary: null, daily: [], dimensions: [], dimensionMeta: {} } as ReturnType<typeof loadGscView>;
  let indexing = missingGsc;
  const gscSource = input.registration.profile.sources.find((source) => source.sourceKey === "google_search_console");
  if (gscSource && gscSource.mode !== "disabled") {
    try {
      const scope = await resolveSourceScope(input.registration, input.claim, "google_search_console");
      const rows = await input.execute({ name: "gsc", scope, period: input.selection.gsc, publicationId: input.publicationId, filters: input.filters }) as import("./gsc.ts").GscReadRows;
      gsc = loadGscView(rows, input.selection.gsc);
      indexing = rows.indexing;
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
  return { gsc, indexing, datasets, metrika, webmaster, wordstat, alice, seoOs, trafficComparison };
}
