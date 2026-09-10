import type { DatasetMeta, Period, SiteRegistration } from "@reportingdash/site-seo-contract";
import { type CanonicalReadExecutor } from "./db.ts";
import { loadGscView } from "./gsc.ts";
import { MissingSourceScopeError, resolveSourceScope, type SiteScopeClaim } from "./scope.ts";

export type DashboardReadModel = Readonly<{
  gsc: ReturnType<typeof loadGscView>;
  indexing: DatasetMeta;
}>;

function missingMeta(): DatasetMeta {
  return {
    sourceKey: "google_search_console", period: null, state: "missing",
    collectionMode: "manual", completeness: "unknown", importId: null,
    exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none",
  };
}

export async function loadDashboardReadModel(input: Readonly<{
  registration: SiteRegistration;
  claim: SiteScopeClaim;
  period: Period;
  execute: CanonicalReadExecutor;
}>): Promise<DashboardReadModel> {
  try {
    const scope = await resolveSourceScope(input.registration, input.claim, "google_search_console");
    const rows = await input.execute({ name: "gsc", scope, period: input.period });
    return { gsc: loadGscView(rows, input.period), indexing: rows.indexing };
  } catch (error) {
    if (!(error instanceof MissingSourceScopeError)) throw error;
    const meta = missingMeta();
    return { gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta };
  }
}
