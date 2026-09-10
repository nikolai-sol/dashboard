export type SourceKey =
  | "yandex_metrika"
  | "yandex_webmaster"
  | "google_search_console"
  | "yandex_wordstat"
  | "yandex_webmaster_alice_manual"
  | "seo_os";

export type SourceScope = Readonly<{
  clientId: string;
  siteId: string;
  dashboardId: number;
  sourceKey: SourceKey;
  analyticsAccountId: string;
  resourceId: string;
}>;

export type RuntimeProfile = Readonly<{
  route: string;
  assetPrefix: string;
  buildOutputDir: string;
  processName: string;
  port: number;
  deployPath: string;
  releaseBranch: string;
  deployLockPath: string;
}>;

export type SiteProfile = Readonly<{
  schemaVersion: 1;
  profileVersion: string;
  siteId: string;
  clientId: string;
  dashboardId: number;
  slug: string;
  domain: string;
  allowedDomains: readonly string[];
  title: string;
  logoAsset: string | null;
  locale: string;
  businessTimezone: string;
  templateVersion: string;
  sources: readonly {
    sourceKey: SourceKey;
    mode: "automated" | "manual" | "disabled";
    bindingId: string | null;
    importCadence: readonly ("previous_month" | "previous_iso_week")[];
  }[];
  taxonomyVersion: string;
  seoRulesVersion: string;
  authPolicyRef: string;
  runtime: RuntimeProfile;
}>;

export type Period = Readonly<{
  kind: "iso_week" | "calendar_month" | "custom" | "snapshot";
  from: string;
  to: string;
  key: string;
  sourceTimezone: string;
}>;

export type Metrics = Readonly<{
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
}>;

export type DatasetMeta = Readonly<{
  sourceKey: SourceKey;
  period: Period | null;
  state: "ready" | "partial" | "complete_empty" | "missing" | "failed";
  collectionMode: "automated" | "manual" | "derived";
  completeness: "complete" | "limited" | "unknown";
  importId: string | null;
  exportedAt: string | null;
  loadedAt: string | null;
  freshness: "current" | "delayed" | "unknown";
  latestAttempt: "success" | "failed" | "none";
}>;

export type ManualSheet =
  "query" | "page" | "country" | "device" | "appearance";
export type GscDimensionRow = Readonly<{
  dimension: ManualSheet;
  value: string;
  metrics: Metrics;
}>;
export type GscView = Readonly<{
  meta: DatasetMeta;
  summary: Metrics | null;
  daily: readonly { date: string; metrics: Metrics }[];
  dimensions: readonly GscDimensionRow[];
  dimensionMeta: Readonly<Partial<Record<ManualSheet, DatasetMeta>>>;
}>;

export type ImportManifest = Readonly<{
  scope: SourceScope;
  period: Period;
  filters: Readonly<Record<string, string>>;
  sourceFiles: readonly { name: string; sha256: string }[];
  adapterVersion: string;
  exportedAt: string | null;
}>;

export type PublishIntent =
  | Readonly<{ kind: "initial" }>
  | Readonly<{
      kind: "correction";
      predecessorImportId: string;
      ownerDecisionId: string;
    }>;

export type SiteBinding = SourceScope & Readonly<{ bindingId: string }>;
export type SiteRegistration = Readonly<{
  profile: SiteProfile;
  bindings: readonly SiteBinding[];
}>;

const SOURCE_KEYS = new Set<SourceKey>([
  "yandex_metrika",
  "yandex_webmaster",
  "google_search_console",
  "yandex_wordstat",
  "yandex_webmaster_alice_manual",
  "seo_os",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Number.isNaN(Date.parse(`${result}T00:00:00Z`))
  ) {
    throw new TypeError(`${label} must be an ISO date`);
  }
  return result;
}

export function assertSourceScope(value: unknown): SourceScope {
  const scope = record(value, "scope");
  text(scope.clientId, "clientId");
  text(scope.siteId, "siteId");
  if (!Number.isInteger(scope.dashboardId) || Number(scope.dashboardId) <= 0) {
    throw new TypeError("dashboardId must be a positive integer");
  }
  if (!SOURCE_KEYS.has(scope.sourceKey as SourceKey))
    throw new TypeError("sourceKey is unsupported");
  text(scope.analyticsAccountId, "analyticsAccountId");
  text(scope.resourceId, "resourceId");
  return value as SourceScope;
}

function assertPeriod(value: unknown): Period {
  const period = record(value, "period");
  if (
    !["iso_week", "calendar_month", "custom", "snapshot"].includes(
      String(period.kind),
    )
  ) {
    throw new TypeError("period.kind is unsupported");
  }
  const from = date(period.from, "period.from");
  const to = date(period.to, "period.to");
  if (from > to) throw new TypeError("period.from must not be after period.to");
  const key = text(period.key, "period.key");
  if (period.kind === "iso_week" && !/^\d{4}-W\d{2}$/.test(key)) {
    throw new TypeError("period.key must be YYYY-WNN for an ISO week");
  }
  text(period.sourceTimezone, "period.sourceTimezone");
  return value as Period;
}

export function assertImportManifest(value: unknown): ImportManifest {
  const manifest = record(value, "manifest");
  assertSourceScope(manifest.scope);
  assertPeriod(manifest.period);
  const filters = record(manifest.filters, "filters");
  for (const [key, filterValue] of Object.entries(filters)) {
    text(key, "filter name");
    if (typeof filterValue !== "string")
      throw new TypeError(`filter ${key} must be a string`);
  }
  if (!Array.isArray(manifest.sourceFiles))
    throw new TypeError("sourceFiles must be an array");
  for (const [index, sourceFile] of manifest.sourceFiles.entries()) {
    const file = record(sourceFile, `sourceFiles[${index}]`);
    text(file.name, `sourceFiles[${index}].name`);
    if (
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(file.sha256)
    ) {
      throw new TypeError(
        `sourceFiles[${index}].sha256 must be a SHA-256 digest`,
      );
    }
  }
  text(manifest.adapterVersion, "adapterVersion");
  if (
    manifest.exportedAt !== null &&
    (typeof manifest.exportedAt !== "string" ||
      Number.isNaN(Date.parse(manifest.exportedAt)))
  ) {
    throw new TypeError("exportedAt must be an ISO timestamp or null");
  }
  return value as ImportManifest;
}

export { assertSiteProfile, assertSiteRegistry } from "./profile-schema.ts";
