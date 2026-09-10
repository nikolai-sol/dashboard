export type ManualReadScope = Readonly<{
  clientId: string;
  siteId: string;
  dashboardId: number;
  sourceKey: string;
  analyticsAccountId: string;
  resourceId: string;
  filtersHash: string;
}>;

export type ManualPeriodIdentity = Readonly<{
  kind: "iso_week" | "calendar_month" | "custom" | "snapshot";
  from: string;
  to: string;
  key: string;
}>;

export type CanonicalReadQuery = Readonly<{
  sql: string;
  params: readonly unknown[];
}>;

export type ManualImportRow = Readonly<{
  import_id: number;
  import_uid: string;
  client_id: string;
  site_id: string;
  dashboard_id: number;
  source_key: string;
  analytics_account_id: string;
  resource_id: string;
  period_kind: ManualPeriodIdentity["kind"];
  period_from: string;
  period_to: string;
  period_key: string;
  source_timezone: string;
  filters_hash: string;
  adapter_version: string;
  exported_at: string | null;
  revision: number;
}>;

export type ManualGscDailyRow = ManualImportRow &
  Readonly<{
    report_date: string;
    clicks: number;
    impressions: number;
    ctr_pct: number | null;
    average_position: number | null;
    coverage_state: "missing" | "limited" | "complete_empty" | "complete";
  }>;

export type ManualGscDimensionRow = ManualImportRow &
  Readonly<{
    dimension_name: "query" | "page" | "country" | "device" | "appearance";
    dimension_value: string;
    source_row_ordinal: number;
    clicks: number;
    impressions: number;
    ctr_pct: number | null;
    average_position: number | null;
  }>;

export type ManualGscIndexingRow = ManualImportRow &
  Readonly<{
    snapshot_date: string;
    reason: string;
    affected_url_count: number;
    validation_state: string | null;
  }>;

export type ManualGscIndexingUrlRow = Readonly<{
  import_id: number;
  snapshot_date: string;
  reason: string;
  page_url: string;
  page_url_hash: string;
  source_row_ordinal: number;
}>;

export type ManualCoverageRow = ManualImportRow &
  Readonly<{
    layer_name: string;
    coverage_state: "missing" | "limited" | "complete_empty" | "complete";
    row_count: number;
    evidence_json: string;
    publication_priority: number;
    publication_revision: number;
  }>;

const SCOPE_WHERE = `
    i.client_id = ?
    AND i.site_id = ?
    AND i.dashboard_id = ?
    AND i.source_key = ?
    AND i.analytics_account_id = ?
    AND i.resource_id = ?
    AND i.filters_hash = ?`;

function scopeParams(scope: ManualReadScope): readonly (string | number)[] {
  return [
    scope.clientId,
    scope.siteId,
    scope.dashboardId,
    scope.sourceKey,
    scope.analyticsAccountId,
    scope.resourceId,
    scope.filtersHash,
  ];
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be an ISO date`);
  }
}

export function buildManualDailyReadQuery(
  scope: ManualReadScope,
  from: string,
  to: string,
): CanonicalReadQuery {
  assertIsoDate(from, "from");
  assertIsoDate(to, "to");
  return {
    sql: `WITH candidate_daily AS (
  SELECT
    i.id AS import_id, i.import_uid, i.client_id, i.site_id, i.dashboard_id, i.source_key,
    i.analytics_account_id, i.resource_id, i.period_kind, i.period_from,
    i.period_to, i.period_key, i.source_timezone, i.filters_hash,
    i.adapter_version, i.exported_at, i.revision,
    d.report_date, d.clicks, d.impressions, d.ctr_pct, d.average_position,
    c.coverage_state, c.publication_priority
  FROM canonical_fact_gsc_manual_daily d
  JOIN canonical_seo_manual_imports i ON i.id = d.import_id
  JOIN canonical_seo_manual_coverage c
    ON c.import_id = i.id AND c.layer_name = 'daily'
  WHERE ${SCOPE_WHERE}
    AND i.status = 'published'
    AND d.report_date BETWEEN ? AND ?
), ranked_daily AS (
  SELECT c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c.report_date
      ORDER BY (c.period_from = ? AND c.period_to = ?) DESC,
        c.publication_priority DESC, c.revision DESC, c.import_id DESC
    ) AS row_choice
  FROM candidate_daily c
)
SELECT * FROM ranked_daily WHERE row_choice = 1 ORDER BY report_date`,
    params: [...scopeParams(scope), from, to, from, to],
  };
}

function exactPeriodParams(
  scope: ManualReadScope,
  period: ManualPeriodIdentity,
): readonly unknown[] {
  assertIsoDate(period.from, "period.from");
  assertIsoDate(period.to, "period.to");
  return [
    ...scopeParams(scope),
    period.kind,
    period.from,
    period.to,
    period.key,
  ];
}

const EXACT_PERIOD_WHERE = `${SCOPE_WHERE}
    AND i.period_kind = ?
    AND i.period_from = ?
    AND i.period_to = ?
    AND i.period_key = ?
    AND i.status = 'published'`;

export function buildManualDimensionsReadQuery(
  scope: ManualReadScope,
  period: ManualPeriodIdentity,
): CanonicalReadQuery {
  return {
    sql: `WITH ranked_dimensions AS (
SELECT
  i.id AS import_id, i.import_uid, i.client_id, i.site_id, i.dashboard_id, i.source_key,
  i.analytics_account_id, i.resource_id, i.period_kind, i.period_from,
  i.period_to, i.period_key, i.source_timezone, i.filters_hash,
  i.adapter_version, i.exported_at, i.revision,
  d.dimension_name, d.dimension_value, d.source_row_ordinal,
  d.clicks, d.impressions, d.ctr_pct, d.average_position,
  ROW_NUMBER() OVER (
    PARTITION BY d.dimension_name, d.dimension_value
    ORDER BY c.publication_priority DESC, i.revision DESC, i.id DESC
  ) AS row_choice
FROM canonical_fact_gsc_manual_period_dimensions d
JOIN canonical_seo_manual_imports i ON i.id = d.import_id
JOIN canonical_seo_manual_coverage c
  ON c.import_id = i.id AND c.layer_name = d.dimension_name
WHERE ${EXACT_PERIOD_WHERE}
)
SELECT * FROM ranked_dimensions WHERE row_choice = 1
ORDER BY dimension_name, source_row_ordinal`,
    params: exactPeriodParams(scope, period),
  };
}

export function buildManualIndexingReadQuery(
  scope: ManualReadScope,
  snapshotDate: string,
): Readonly<{ totals: CanonicalReadQuery; urlSamples: CanonicalReadQuery }> {
  assertIsoDate(snapshotDate, "snapshotDate");
  const chosenImport = `WITH chosen_import AS (
  SELECT i.id
  FROM canonical_seo_manual_imports i
  JOIN canonical_seo_manual_coverage c
    ON c.import_id = i.id AND c.layer_name = 'indexing'
  WHERE ${SCOPE_WHERE}
    AND i.period_kind = 'snapshot'
    AND i.period_from = ?
    AND i.period_to = ?
    AND i.status = 'published'
  ORDER BY c.publication_priority DESC, i.revision DESC, i.id DESC
  LIMIT 1
)`;
  const params = [
    ...scopeParams(scope),
    snapshotDate,
    snapshotDate,
    snapshotDate,
  ];
  return {
    totals: {
      sql: `${chosenImport}
SELECT
  i.id AS import_id, i.import_uid, i.client_id, i.site_id, i.dashboard_id, i.source_key,
  i.analytics_account_id, i.resource_id, i.period_kind, i.period_from,
  i.period_to, i.period_key, i.source_timezone, i.filters_hash,
  i.adapter_version, i.exported_at, i.revision,
  x.snapshot_date, x.reason, x.affected_url_count, x.validation_state
FROM canonical_fact_gsc_manual_indexing x
JOIN chosen_import chosen ON chosen.id = x.import_id
JOIN canonical_seo_manual_imports i ON i.id = x.import_id
WHERE x.snapshot_date = ? ORDER BY x.reason`,
      params,
    },
    urlSamples: {
      sql: `${chosenImport}
SELECT u.import_id, u.snapshot_date, u.reason, u.page_url,
  u.page_url_hash, u.source_row_ordinal
FROM canonical_fact_gsc_manual_indexing_urls u
JOIN chosen_import chosen ON chosen.id = u.import_id
WHERE u.snapshot_date = ? ORDER BY u.reason, u.source_row_ordinal`,
      params,
    },
  };
}

export function buildManualCoverageReadQuery(
  scope: ManualReadScope,
  period: ManualPeriodIdentity,
): CanonicalReadQuery {
  return {
    sql: `SELECT
  i.id AS import_id, i.import_uid, i.client_id, i.site_id, i.dashboard_id, i.source_key,
  i.analytics_account_id, i.resource_id, i.period_kind, i.period_from,
  i.period_to, i.period_key, i.source_timezone, i.filters_hash,
  i.adapter_version, i.exported_at, i.revision,
  c.layer_name, c.coverage_state, c.row_count, c.evidence_json,
  c.publication_priority, c.publication_revision
FROM canonical_seo_manual_coverage c
JOIN canonical_seo_manual_imports i ON i.id = c.import_id
WHERE ${EXACT_PERIOD_WHERE}
ORDER BY c.layer_name`,
    params: exactPeriodParams(scope, period),
  };
}
