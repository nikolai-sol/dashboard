import type { DatasetMeta, Period, SiteRegistration, SourceKey } from "@reportingdash/site-seo-contract";
import { type CanonicalReadExecutor } from "./db.ts";
import { loadGscView } from "./gsc.ts";
import { MissingSourceScopeError, resolveSourceScope, type SiteScopeClaim } from "./scope.ts";

export type DashboardReadModel = Readonly<{
  gsc: ReturnType<typeof loadGscView>;
  indexing: DatasetMeta;
  datasets: Readonly<Partial<Record<SourceKey, DatasetMeta>>>;
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

export async function loadDashboardReadModel(input: Readonly<{
  registration: SiteRegistration;
  claim: SiteScopeClaim;
  period: Period;
  execute: CanonicalReadExecutor;
}>): Promise<DashboardReadModel> {
  try {
    const scope = await resolveSourceScope(input.registration, input.claim, "google_search_console");
    const rows = await input.execute({ name: "gsc", scope, period: input.period }) as import("./gsc.ts").GscReadRows;
    const datasets: Partial<Record<SourceKey, DatasetMeta>> = {
      google_search_console: rows.meta,
    };
    for (const source of input.registration.profile.sources) {
      if (source.sourceKey === "google_search_console") continue;
      if (source.mode === "disabled") {
        datasets[source.sourceKey] = missingMetaFor(source.sourceKey, "derived");
        continue;
      }
      try {
        const datasetScope = await resolveSourceScope(input.registration, input.claim, source.sourceKey);
        datasets[source.sourceKey] = await input.execute({ name: "dataset", scope: datasetScope, period: input.period }) as DatasetMeta;
      } catch (error) {
        if (!(error instanceof MissingSourceScopeError)) throw error;
        datasets[source.sourceKey] = missingMetaFor(source.sourceKey, source.mode === "manual" ? "manual" : "automated");
      }
    }
    return { gsc: loadGscView(rows, input.period), indexing: rows.indexing, datasets };
  } catch (error) {
    if (!(error instanceof MissingSourceScopeError)) throw error;
    const meta = missingMeta();
    return { gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: { google_search_console: meta } };
  }
}
