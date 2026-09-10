import type { Period, SourceScope } from "@reportingdash/site-seo-contract";
import type { GscReadRows } from "./gsc.ts";

export type CanonicalReadQuery = Readonly<{
  name: "gsc";
  scope: SourceScope;
  period: Period;
}>;

/**
 * The runtime implementation is supplied by the site's MySQL-only adapter.
 * Keeping this boundary injected lets fixtures verify scope without accepting
 * request-provided source identifiers or reading import artifacts.
 */
export type CanonicalReadExecutor = (
  query: CanonicalReadQuery,
) => Promise<GscReadRows>;
