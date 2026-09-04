import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuAliceVisibilityData,
  ZarukuAliceVisibilityFeaturedSite,
  ZarukuAliceVisibilityQuery,
  ZarukuAliceVisibilitySnapshot,
  ZarukuAliceVisibilitySource,
  ZarukuAliceVisibilityVersion,
} from "@/lib/types";

export type AliceVisibilitySqlQuery = { sql: string; params: string[] };
export type AliceVisibilityQueryRunner = (query: AliceVisibilitySqlQuery) => Promise<unknown[]>;

type SnapshotDbRow = {
  id: string | number;
  source_key: string | null;
  analytics_account_id: string | number | null;
  domain: string | null;
  period_month: string | Date | null;
  captured_at: string | Date | null;
  official_sov_pct: string | number | null;
  exported_query_count: string | number | null;
  portal_present_query_count: string | number | null;
  sample_presence_pct: string | number | null;
  source_filename: string | null;
  source_sha256: string | null;
  publication_status: string | null;
  supersedes_snapshot_id: string | number | null;
  ingestion_run_id: string | null;
};

type QueryDbRow = {
  id: string | number;
  snapshot_id: string | number;
  query_hash: string | null;
  query_text: string | null;
  portal_present: string | number | boolean | null;
  portal_position: string | number | null;
  portal_url: string | null;
  alice_answer_url: string | null;
  source_count: string | number | null;
  raw_present_value: string | null;
};

type SourceDbRow = {
  id: string | number;
  query_id: string | number;
  source_rank: string | number | null;
  source_url: string | null;
  source_domain: string | null;
  is_portal: string | number | boolean | null;
};

type FeaturedDbRow = {
  id: string | number;
  snapshot_id: string | number;
  display_order: string | number | null;
  site_url: string | null;
  site_domain: string | null;
  list_kind: string | null;
};

function asString(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function formatMonth(value: string | Date | null) {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  return asString(value).slice(0, 7) || null;
}

function formatDateTime(value: string | Date | null) {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  return asString(value) || null;
}

function normalizeAccountIds(accountIds: string[]) {
  return [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
}

function inClause(accountIds: string[]) {
  return accountIds.map(() => "?").join(", ");
}

export function buildAliceVisibilityQueries(accountIds: string[]): AliceVisibilitySqlQuery[] {
  const normalizedAccountIds = normalizeAccountIds(accountIds);
  if (normalizedAccountIds.length === 0) throw new Error("at least one account ID is required");
  const accounts = inClause(normalizedAccountIds);

  return [
    {
      sql: `
        /* alice-visibility:snapshots */
        SELECT id, source_key, analytics_account_id, domain, period_month, captured_at,
          official_sov_pct, exported_query_count, portal_present_query_count, sample_presence_pct,
          source_filename, source_sha256, publication_status, supersedes_snapshot_id, ingestion_run_id
        FROM canonical_alice_visibility_snapshots
        WHERE analytics_account_id IN (${accounts})
          AND publication_status IN ('published', 'superseded')
        ORDER BY period_month DESC, captured_at DESC, id DESC
      `,
      params: normalizedAccountIds,
    },
    {
      sql: `
        /* alice-visibility:queries */
        SELECT queries.id, queries.snapshot_id, queries.query_hash, queries.query_text,
          queries.portal_present, queries.portal_position, queries.portal_url, queries.alice_answer_url,
          queries.source_count, queries.raw_present_value
        FROM canonical_alice_visibility_queries AS queries
        JOIN canonical_alice_visibility_snapshots AS snapshots ON snapshots.id = queries.snapshot_id
        WHERE snapshots.analytics_account_id IN (${accounts})
          AND snapshots.publication_status = 'published'
        ORDER BY queries.snapshot_id, queries.id
      `,
      params: normalizedAccountIds,
    },
    {
      sql: `
        /* alice-visibility:sources */
        SELECT sources.id, sources.query_id, sources.source_rank, sources.source_url,
          sources.source_domain, sources.is_portal
        FROM canonical_alice_visibility_sources AS sources
        JOIN canonical_alice_visibility_queries AS queries ON queries.id = sources.query_id
        JOIN canonical_alice_visibility_snapshots AS snapshots ON snapshots.id = queries.snapshot_id
        WHERE snapshots.analytics_account_id IN (${accounts})
          AND snapshots.publication_status = 'published'
        ORDER BY queries.snapshot_id, sources.query_id, sources.source_rank
      `,
      params: normalizedAccountIds,
    },
    {
      sql: `
        /* alice-visibility:featured-sites */
        SELECT featured.id, featured.snapshot_id, featured.display_order, featured.site_url,
          featured.site_domain, featured.list_kind
        FROM canonical_alice_visibility_featured_sites AS featured
        JOIN canonical_alice_visibility_snapshots AS snapshots ON snapshots.id = featured.snapshot_id
        WHERE snapshots.analytics_account_id IN (${accounts})
          AND snapshots.publication_status = 'published'
        ORDER BY featured.snapshot_id, featured.list_kind, featured.display_order
      `,
      params: normalizedAccountIds,
    },
  ];
}

function snapshotVersion(row: SnapshotDbRow): ZarukuAliceVisibilityVersion {
  return {
    id: asString(row.id),
    analyticsAccountId: asString(row.analytics_account_id),
    capturedAt: formatDateTime(row.captured_at),
    publicationStatus: asString(row.publication_status),
    supersedesSnapshotId: row.supersedes_snapshot_id == null ? null : asString(row.supersedes_snapshot_id),
    officialSovPct: asNumber(row.official_sov_pct),
    provenance: {
      sourceKey: asString(row.source_key),
      sourceFilename: asString(row.source_filename) || null,
      sourceSha256: asString(row.source_sha256),
      ingestionRunId: asString(row.ingestion_run_id),
    },
  };
}

export function normalizeAliceVisibilityRows(
  snapshots: SnapshotDbRow[],
  queries: QueryDbRow[],
  sources: SourceDbRow[],
  featuredSites: FeaturedDbRow[],
): ZarukuAliceVisibilityData {
  const sourcesByQuery = new Map<string, ZarukuAliceVisibilitySource[]>();
  for (const source of sources) {
    const queryId = asString(source.query_id);
    const item: ZarukuAliceVisibilitySource = {
      id: asString(source.id),
      sourceRank: asNumber(source.source_rank),
      sourceUrl: asString(source.source_url),
      sourceDomain: asString(source.source_domain),
      isPortal: asBoolean(source.is_portal),
    };
    const current = sourcesByQuery.get(queryId) ?? [];
    current.push(item);
    sourcesByQuery.set(queryId, current);
  }
  for (const items of sourcesByQuery.values()) items.sort((left, right) => left.sourceRank - right.sourceRank);

  const queriesBySnapshot = new Map<string, ZarukuAliceVisibilityQuery[]>();
  for (const query of queries) {
    const snapshotId = asString(query.snapshot_id);
    const item: ZarukuAliceVisibilityQuery = {
      id: asString(query.id),
      queryHash: asString(query.query_hash),
      queryText: asString(query.query_text),
      portalPresent: asBoolean(query.portal_present),
      portalPosition: asNullableNumber(query.portal_position),
      portalUrl: asString(query.portal_url) || null,
      aliceAnswerUrl: asString(query.alice_answer_url),
      sourceCount: asNumber(query.source_count),
      rawPresentValue: asString(query.raw_present_value),
      sources: sourcesByQuery.get(asString(query.id)) ?? [],
    };
    const current = queriesBySnapshot.get(snapshotId) ?? [];
    current.push(item);
    queriesBySnapshot.set(snapshotId, current);
  }

  const featuredBySnapshot = new Map<string, ZarukuAliceVisibilityFeaturedSite[]>();
  for (const featured of featuredSites) {
    const snapshotId = asString(featured.snapshot_id);
    const item: ZarukuAliceVisibilityFeaturedSite = {
      id: asString(featured.id),
      displayOrder: asNumber(featured.display_order),
      siteUrl: asString(featured.site_url),
      siteDomain: asString(featured.site_domain),
      listKind: asString(featured.list_kind),
    };
    const current = featuredBySnapshot.get(snapshotId) ?? [];
    current.push(item);
    featuredBySnapshot.set(snapshotId, current);
  }
  for (const items of featuredBySnapshot.values()) items.sort((left, right) => left.displayOrder - right.displayOrder);

  const snapshotsByMonth = new Map<string, SnapshotDbRow[]>();
  for (const snapshot of snapshots) {
    const month = formatMonth(snapshot.period_month);
    if (!month) continue;
    const key = `${asString(snapshot.analytics_account_id)}|${month}`;
    const current = snapshotsByMonth.get(key) ?? [];
    current.push(snapshot);
    snapshotsByMonth.set(key, current);
  }

  const normalizedSnapshots: ZarukuAliceVisibilitySnapshot[] = [];
  for (const versions of snapshotsByMonth.values()) {
    const sortedVersions = [...versions].sort((left, right) =>
      (formatDateTime(right.captured_at) ?? "").localeCompare(formatDateTime(left.captured_at) ?? "")
      || asNumber(right.id) - asNumber(left.id));
    const published = sortedVersions.find((version) => asString(version.publication_status) === "published");
    if (!published) continue;
    const month = formatMonth(published.period_month)!;
    const snapshotQueries = queriesBySnapshot.get(asString(published.id)) ?? [];
    const competitorQueries = new Map<string, Set<string>>();
    for (const query of snapshotQueries) {
      for (const source of query.sources) {
        if (source.isPortal || !source.sourceDomain) continue;
        const queryIds = competitorQueries.get(source.sourceDomain) ?? new Set<string>();
        queryIds.add(query.id);
        competitorQueries.set(source.sourceDomain, queryIds);
      }
    }
    const competitors = [...competitorQueries.entries()]
      .map(([domain, queryIds]) => ({
        domain,
        queryCount: queryIds.size,
        sharePct: snapshotQueries.length > 0 ? queryIds.size / snapshotQueries.length * 100 : 0,
      }))
      .sort((left, right) => right.queryCount - left.queryCount || left.domain.localeCompare(right.domain));
    normalizedSnapshots.push({
      id: asString(published.id),
      analyticsAccountId: asString(published.analytics_account_id),
      month,
      domain: asString(published.domain),
      officialSovPct: asNumber(published.official_sov_pct),
      exportedQueryCount: asNullableNumber(published.exported_query_count),
      portalPresentQueryCount: asNullableNumber(published.portal_present_query_count),
      samplePresencePct: asNullableNumber(published.sample_presence_pct),
      provenance: snapshotVersion(published).provenance,
      queries: snapshotQueries,
      competitors,
      featuredSites: featuredBySnapshot.get(asString(published.id)) ?? [],
      versions: sortedVersions.map(snapshotVersion),
    });
  }
  normalizedSnapshots.sort((left, right) => right.month.localeCompare(left.month));

  return {
    status: "available",
    error: null,
    months: [...new Set(normalizedSnapshots.map((snapshot) => snapshot.month))],
    latestMonth: normalizedSnapshots[0]?.month ?? null,
    snapshots: normalizedSnapshots,
  };
}

async function executeAliceVisibilityQuery(query: AliceVisibilitySqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadZarukuAliceVisibility(
  accountIds: string[],
  queryRunner: AliceVisibilityQueryRunner = executeAliceVisibilityQuery,
): Promise<ZarukuAliceVisibilityData> {
  const queries = buildAliceVisibilityQueries(accountIds);
  const settled = await Promise.allSettled(queries.map((query) => queryRunner(query)));
  const snapshotResult = settled[0];
  if (snapshotResult.status === "rejected") {
    return { status: "unavailable", error: "Опубликованные ежемесячные снимки AI-видимости недоступны.", months: [], latestMonth: null, snapshots: [] };
  }

  const readRows = <T>(result: PromiseSettledResult<unknown[]>) =>
    result.status === "fulfilled" ? result.value as T[] : [] as T[];
  const data = normalizeAliceVisibilityRows(
    readRows<SnapshotDbRow>(snapshotResult),
    readRows<QueryDbRow>(settled[1]),
    readRows<SourceDbRow>(settled[2]),
    readRows<FeaturedDbRow>(settled[3]),
  );
  if (settled.slice(1).some((result) => result.status === "rejected") && data.status === "available") {
    return { ...data, status: "partial", error: "Часть деталей опубликованных ежемесячных снимков AI-видимости недоступна." };
  }
  return data;
}
