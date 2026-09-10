import type { DatasetMeta, SiteRegistration, SourceKey } from "@reportingdash/site-seo-contract";
import { type CanonicalDatasetData, type CanonicalReadExecutor, type MetrikaCanonicalData, type WebmasterCanonicalData } from "./db.ts";
import { loadGscView } from "./gsc.ts";
import type { PeriodSelection } from "./period-selection.ts";
import { MissingSourceScopeError, resolveSourceScope, type SiteScopeClaim } from "./scope.ts";

export type DashboardReadModel = Readonly<{
  gsc: ReturnType<typeof loadGscView>;
  indexing: DatasetMeta;
  datasets: Readonly<Partial<Record<SourceKey, DatasetMeta>>>;
  metrika: MetrikaCanonicalData | null;
  webmaster: WebmasterCanonicalData | null;
  trafficComparison: Readonly<Partial<Record<SourceKey, DatasetMeta>>>;
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
  const trafficComparison: Partial<Record<SourceKey, DatasetMeta>> = {};
  let metrika: MetrikaCanonicalData | null = null;
  let webmaster: WebmasterCanonicalData | null = null;
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
      if (input.selection.traffic.comparison && (source.sourceKey === "yandex_metrika" || source.sourceKey === "yandex_webmaster")) {
        trafficComparison[source.sourceKey] = await input.execute({ name: "dataset", scope, period: input.selection.traffic.comparison, publicationId: input.publicationId, filters: input.filters }) as DatasetMeta;
      }
    } catch (error) {
      if (!(error instanceof MissingSourceScopeError)) throw error;
      datasets[source.sourceKey] = missingMetaFor(source.sourceKey, source.mode === "manual" ? "manual" : "automated");
    }
  }
  return { gsc, indexing, datasets, metrika, webmaster, trafficComparison };
}
