import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as importerModule from "./import-zaruku-alice-visibility";
import {
  createSummaryOnlySnapshot,
  parseCliArgs,
  persistAliceVisibilitySnapshot,
  type AliceVisibilityImportConnection,
} from "./import-zaruku-alice-visibility";
import type { ParsedAliceVisibilitySnapshot } from "../src/lib/zaruku-alice-visibility-import";

test("Alice visibility migration creates normalized immutable snapshot tables", () => {
  const sql = readFileSync("src/db/migrations/046_zaruku_alice_visibility_monthly.sql", "utf8");
  for (const table of ["canonical_alice_visibility_snapshots", "canonical_alice_visibility_queries", "canonical_alice_visibility_sources", "canonical_alice_visibility_featured_sites"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /source_sha256 CHAR\(64\) NOT NULL/);
  assert.match(sql, /snapshot_fingerprint_sha256 CHAR\(64\)/);
  assert.match(sql, /UNIQUE KEY uniq_alice_snapshot_fingerprint/);
  assert.doesNotMatch(sql, /UNIQUE KEY uniq_alice_snapshot_checksum/);
  assert.match(sql, /UNIQUE KEY uniq_alice_query/);
  assert.match(sql, /UNIQUE KEY uniq_alice_source_rank/);
  assert.match(sql, /UNIQUE KEY uniq_alice_snapshot_published_month/);
});

test("Alice visibility fingerprint upgrade preserves existing snapshots and replaces checksum uniqueness idempotently", () => {
  const sql = readFileSync("src/db/migrations/063_zaruku_alice_snapshot_fingerprint.sql", "utf8");
  assert.match(sql, /information_schema\.COLUMNS/);
  assert.match(sql, /ADD COLUMN snapshot_fingerprint_sha256 CHAR\(64\) DEFAULT NULL/);
  assert.match(sql, /information_schema\.STATISTICS/);
  assert.match(sql, /NON_UNIQUE/);
  assert.match(sql, /DROP INDEX uniq_alice_snapshot_fingerprint/);
  assert.match(sql, /DROP INDEX uniq_alice_snapshot_checksum/);
  assert.match(sql, /ADD UNIQUE (?:KEY|INDEX) uniq_alice_snapshot_fingerprint \(analytics_account_id, source_key, snapshot_fingerprint_sha256\)/);
  assert.ok(
    sql.indexOf("ADD UNIQUE KEY uniq_alice_snapshot_fingerprint") < sql.indexOf("DROP INDEX uniq_alice_snapshot_checksum"),
    "replacement fingerprint uniqueness must be installed before checksum uniqueness is removed",
  );
  assert.doesNotMatch(sql, /DELETE FROM canonical_alice_visibility_snapshots/);
  assert.doesNotMatch(sql, /UPDATE canonical_alice_visibility_snapshots/);
});

test("README deprecates the historical Alice aggregate path without assigning meanings to July 89/155", () => {
  const readme = readFileSync("README.md", "utf8");
  const historical = readme.slice(
    readme.indexOf("### Historical Alice aggregate path"),
    readme.indexOf("### Zaruku Alice monthly snapshot handoff"),
  );
  assert.match(historical, /deprecated/i);
  assert.match(historical, /89\/155[\s\S]*unconfirmed|unconfirmed[\s\S]*89\/155/i);
  assert.doesNotMatch(historical, /Use `mentions = rows where Zaruku is present`/);
  assert.doesNotMatch(historical, /runSeoAiVisibilityImport/);
});

test("dry-run refuses an invalid summary-only period and timestamp", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-zaruku-alice-visibility.ts", "--summary-only", "--period", "2026-99", "--official-sov", "44", "--captured-at", "not-a-timestamp", "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155", "--dry-run"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /period должен иметь формат|captured-at должен быть ISO/);
});

test("dry-run refuses a date-only captured-at value", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-zaruku-alice-visibility.ts", "--summary-only", "--period", "2026-07", "--official-sov", "44", "--captured-at", "2026-07-13", "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155", "--dry-run"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /captured-at должен быть ISO timestamp/);
});

test("execute configuration accepts only explicitly supplied DB_* variables", () => {
  const resolveConfig = (importerModule as unknown as {
    resolveAliceVisibilityDbConfig?: (
      environment: Readonly<Record<string, string | undefined>>,
    ) => {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    };
  }).resolveAliceVisibilityDbConfig;
  assert.equal(typeof resolveConfig, "function");
  assert.deepEqual(resolveConfig!({
    DB_HOST: "db.example.test",
    DB_PORT: "3307",
    DB_USER: "alice_writer",
    DB_PASSWORD: "test-password",
    DB_NAME: "report_bd",
    MYSQL_HOST: "must-not-win.example.test",
  }), {
    host: "db.example.test",
    port: 3307,
    user: "alice_writer",
    password: "test-password",
    database: "report_bd",
  });
  assert.throws(() => resolveConfig!({
    MYSQL_HOST: "legacy.example.test",
    MYSQL_USER: "legacy",
    MYSQL_PASSWORD: "test-password",
    MYSQL_DB: "report_bd",
  }), /Missing DB connection env values/);
});

function parsedSnapshot(): ParsedAliceVisibilitySnapshot {
  const queries = Array.from({ length: 155 }, (_, index) => {
    const sourceCount = index < 73 ? 9 : 8;
    return {
      queryHash: `${String(index).padStart(64, "0")}`,
      queryText: `query ${index + 1}`,
      rawPresentValue: index < 89 ? "true" : "false",
      portalPresent: index < 89,
      portalPosition: index < 89 ? 1 : null,
      portalUrl: index < 89 ? "https://zaruku.ru/article/" : null,
      aliceAnswerUrl: `https://yandex.ru/search/?text=${index + 1}`,
      sourceCount,
    };
  });
  return {
    accountId: "66624469",
    portalDomain: "zaruku.ru",
    period: "2026-08",
    officialSovPct: 43.91,
    capturedAt: "2026-09-04T13:28:14.000Z",
    sourceFilename: "export.xlsx",
    featuredSites: [],
    sourceSha256: "a".repeat(64),
    exportedQueryCount: queries.length,
    portalPresentQueryCount: 89,
    samplePresencePct: 89 / 155 * 100,
    queries,
    sources: queries.flatMap((query, queryIndex) => Array.from({ length: query.sourceCount }, (_, sourceIndex) => ({
      queryHash: query.queryHash,
      sourceRank: sourceIndex + 1,
      sourceUrl: sourceIndex === 0 && query.portalPresent ? "https://zaruku.ru/article/" : `https://example${sourceIndex}.test/${queryIndex}`,
      sourceDomain: sourceIndex === 0 && query.portalPresent ? "zaruku.ru" : `example${sourceIndex}.test`,
      isPortal: sourceIndex === 0 && query.portalPresent,
    }))),
    featured: Array.from({ length: 10 }, (_, index) => ({
      displayOrder: index + 1,
      siteUrl: `https://featured${index + 1}.test/`,
      siteDomain: `featured${index + 1}.test`,
    })),
  };
}

class FakeConnection implements AliceVisibilityImportConnection {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  readonly lifecycle: string[] = [];
  private nextId = 1;

  constructor(private readonly mode: "new" | "same" | "other" | "bad_counts") {}

  async beginTransaction() { this.lifecycle.push("begin"); }
  async commit() { this.lifecycle.push("commit"); }
  async rollback() { this.lifecycle.push("rollback"); }
  async execute(sql: string, params: readonly unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes("WHERE analytics_account_id = ? AND source_key = ? AND source_sha256 = ?")) {
      const snapshot = parsedSnapshot();
      return [this.mode === "same" ? [{
        id: 9,
        domain: snapshot.portalDomain,
        period_month: `${snapshot.period}-01`,
        captured_at: "2026-09-04 13:28:14",
        official_sov_pct: "43.9100",
        exported_query_count: snapshot.exportedQueryCount,
        portal_present_query_count: snapshot.portalPresentQueryCount,
        sample_presence_pct: "57.4194",
        source_filename: snapshot.sourceFilename,
        source_sha256: snapshot.sourceSha256,
        ingestion_run_id: `alice-${snapshot.accountId}-yandex_webmaster_alice_manual-${snapshot.sourceSha256}`,
        source_payload_json: null,
      }] : [], undefined] as const;
    }
    if (sql.trimStart().startsWith("SELECT display_order") && sql.includes("FROM canonical_alice_visibility_featured_sites")) {
      return [this.mode === "same" ? parsedSnapshot().featured.map((site) => ({
        display_order: site.displayOrder,
        site_url: site.siteUrl,
        site_domain: site.siteDomain,
        list_kind: "yandex_random_high_mentions",
      })) : [], undefined] as const;
    }
    if (sql.includes("WHERE analytics_account_id = ? AND period_month = ? AND publication_status = 'published'")) {
      if (this.mode === "same") return [[{ id: 9, source_sha256: "a".repeat(64) }], undefined] as const;
      return [this.mode === "other" ? [{ id: 7, source_sha256: "b".repeat(64) }] : [], undefined] as const;
    }
    if (sql.includes("AS query_count")) {
      const queryCount = this.calls.filter(({ sql: calledSql }) => calledSql.startsWith("INSERT INTO canonical_alice_visibility_queries")).length;
      const sourceCount = this.calls.filter(({ sql: calledSql }) => calledSql.startsWith("INSERT INTO canonical_alice_visibility_sources")).length;
      const featuredCount = this.calls.filter(({ sql: calledSql }) => calledSql.startsWith("INSERT INTO canonical_alice_visibility_featured_sites")).length;
      const portalPresentCount = this.calls.filter(({ sql: calledSql }) => calledSql.startsWith("INSERT INTO canonical_alice_visibility_queries") && calledSql.length > 0).filter(({ params: calledParams }) => calledParams[3] === 1).length;
      return [[{ query_count: queryCount, source_count: this.mode === "bad_counts" ? sourceCount - 1 : sourceCount, portal_present_count: portalPresentCount, featured_count: featuredCount }], undefined] as const;
    }
    if (sql.startsWith("INSERT INTO canonical_alice_visibility_snapshots")) return [{ insertId: 42 }, undefined] as const;
    if (sql.startsWith("INSERT INTO canonical_alice_visibility_queries")) return [{ insertId: this.nextId++ }, undefined] as const;
    return [{ affectedRows: 1 }, undefined] as const;
  }
}

test("persists a complete Alice snapshot transactionally and reconciles its children", async () => {
  const connection = new FakeConnection("new");
  assert.equal(await persistAliceVisibilitySnapshot(connection, parsedSnapshot(), {}), "inserted");
  assert.deepEqual(connection.lifecycle, ["begin", "commit"]);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_queries")).length, 155);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_sources")).length, 1313);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_featured_sites")).length, 10);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("AS query_count")).length, 1);
});

test("returns already_exists for the same source checksum", async () => {
  assert.equal(await persistAliceVisibilitySnapshot(new FakeConnection("same"), parsedSnapshot(), {}), "already_exists");
});

test("same workbook checksum is idempotent only when authoritative metadata is identical", async () => {
  const corrections: Array<{
    label: string;
    update: (snapshot: ParsedAliceVisibilitySnapshot) => void;
    options?: Parameters<typeof persistAliceVisibilitySnapshot>[2];
  }> = [
    { label: "official SoV", update: (snapshot) => { snapshot.officialSovPct = 43.92; } },
    { label: "capture time", update: (snapshot) => { snapshot.capturedAt = "2026-09-04T13:29:14.000Z"; } },
    { label: "featured sites", update: (snapshot) => { snapshot.featured[0]!.siteUrl = "https://corrected-featured.test/"; } },
    { label: "source payload", update: () => {}, options: { sourcePayloadJson: { correction: true } } },
  ];

  for (const correction of corrections) {
    const snapshot = parsedSnapshot();
    correction.update(snapshot);
    await assert.rejects(
      () => persistAliceVisibilitySnapshot(new FakeConnection("same"), snapshot, correction.options ?? {}),
      /supersede-snapshot-id/,
      correction.label,
    );
  }
});

test("metadata-only same-workbook correction requires explicit supersession and keeps the old snapshot", async () => {
  const snapshot = parsedSnapshot();
  snapshot.officialSovPct = 43.92;
  const connection = new FakeConnection("same");

  assert.equal(
    await persistAliceVisibilitySnapshot(connection, snapshot, { supersedeSnapshotId: 9 }),
    "superseded",
  );
  assert.ok(connection.calls.some(({ sql, params }) =>
    sql.startsWith("UPDATE canonical_alice_visibility_snapshots") && params[0] === 9));
  const insert = connection.calls.find(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_snapshots"));
  assert.ok(insert);
  assert.match(insert.sql, /snapshot_fingerprint_sha256/);
});

test("requires an explicit predecessor before replacing a published month", async () => {
  await assert.rejects(() => persistAliceVisibilitySnapshot(new FakeConnection("other"), parsedSnapshot(), {}), /уже опубликован другой файл/);
  assert.equal(await persistAliceVisibilitySnapshot(new FakeConnection("other"), parsedSnapshot(), { supersedeSnapshotId: 7 }), "superseded");
});

test("marks the predecessor superseded before inserting its published replacement", async () => {
  const connection = new FakeConnection("other");
  await persistAliceVisibilitySnapshot(connection, parsedSnapshot(), { supersedeSnapshotId: 7 });
  const updateIndex = connection.calls.findIndex(({ sql }) => sql.startsWith("UPDATE canonical_alice_visibility_snapshots"));
  const insertIndex = connection.calls.findIndex(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_snapshots"));
  assert.ok(updateIndex >= 0 && updateIndex < insertIndex);
});

test("rolls back if post-write child counts do not reconcile", async () => {
  const connection = new FakeConnection("bad_counts");
  await assert.rejects(() => persistAliceVisibilitySnapshot(connection, parsedSnapshot(), {}), /reconciliation/);
  assert.deepEqual(connection.lifecycle, ["begin", "rollback"]);
});

test("persists an absent portal query with no source rows", async () => {
  const snapshot = parsedSnapshot();
  const query = snapshot.queries[0]!;
  query.sourceCount = 0;
  query.portalPresent = false;
  query.portalPosition = null;
  query.portalUrl = null;
  query.rawPresentValue = "false";
  snapshot.portalPresentQueryCount = 88;
  snapshot.samplePresencePct = 88 / 155 * 100;
  snapshot.sources = snapshot.sources.filter((source) => source.queryHash !== query.queryHash);
  assert.equal(await persistAliceVisibilitySnapshot(new FakeConnection("new"), snapshot, {}), "inserted");
});

test("rejects contradictory detailed sample coverage before opening a transaction", async () => {
  const snapshot = parsedSnapshot();
  snapshot.samplePresencePct = 50;
  await assert.rejects(() => persistAliceVisibilitySnapshot(new FakeConnection("new"), snapshot, {}), /sample presence/);
});

test("rejects out-of-range detailed sample coverage", async () => {
  const snapshot = parsedSnapshot();
  snapshot.samplePresencePct = 100.1;
  await assert.rejects(() => persistAliceVisibilitySnapshot(new FakeConnection("new"), snapshot, {}), /sample presence/);
});

test("rejects source ranks outside the ten exported positions", async () => {
  const snapshot = parsedSnapshot();
  snapshot.sources[0]!.sourceRank = 11;
  await assert.rejects(() => persistAliceVisibilitySnapshot(new FakeConnection("new"), snapshot, {}), /source rank/);
});

test("rejects duplicate source ranks within one query", async () => {
  const snapshot = parsedSnapshot();
  snapshot.sources[1]!.sourceRank = snapshot.sources[0]!.sourceRank;
  await assert.rejects(() => persistAliceVisibilitySnapshot(new FakeConnection("new"), snapshot, {}), /source rank/);
});

test("persistence rejects non-HTTP and spoofed portal URLs before opening a transaction", async () => {
  const cases: Array<{ label: string; update: (snapshot: ParsedAliceVisibilitySnapshot) => void }> = [
    {
      label: "answer",
      update: (snapshot) => { snapshot.queries[0]!.aliceAnswerUrl = "javascript://zaruku.ru/answer"; },
    },
    {
      label: "source",
      update: (snapshot) => { snapshot.sources[0]!.sourceUrl = "data://zaruku.ru/source"; },
    },
    {
      label: "portal",
      update: (snapshot) => { snapshot.queries[0]!.portalUrl = "https://example.test/path/zaruku.ru"; },
    },
    {
      label: "featured",
      update: (snapshot) => { snapshot.featured[0]!.siteUrl = "file://zaruku.ru/featured"; },
    },
  ];

  for (const item of cases) {
    const snapshot = parsedSnapshot();
    item.update(snapshot);
    const connection = new FakeConnection("new");
    await assert.rejects(
      () => persistAliceVisibilitySnapshot(connection, snapshot, {}),
      /HTTP\(S\)|домен|портал/i,
      item.label,
    );
    assert.deepEqual(connection.lifecycle, [], item.label);
  }
});

test("builds the July legacy summary with deterministic provenance-only checksum", async () => {
  const options = parseCliArgs([
    "--summary-only", "--period", "2026-07", "--official-sov", "44", "--captured-at", "2026-07-13T14:30:00.000Z",
    "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155",
  ]);
  const first = createSummaryOnlySnapshot(options);
  const second = createSummaryOnlySnapshot(options);
  assert.equal(first.snapshot.sourceSha256, second.snapshot.sourceSha256);
  assert.equal(first.sourceKey, "wm_alisa_manual_legacy");
  assert.equal(first.snapshot.exportedQueryCount, null);
  assert.equal(first.snapshot.queries.length, 0);
  assert.deepEqual(first.sourcePayloadJson.legacy_unconfirmed, { definition: "unconfirmed", legacy_mentions: 89, legacy_citations: 155 });
  const connection = new FakeConnection("new");
  assert.equal(await persistAliceVisibilitySnapshot(connection, first.snapshot, { sourceKey: first.sourceKey, sourcePayloadJson: first.sourcePayloadJson }), "inserted");
  const insertedSnapshot = connection.calls.find(({ sql }) => sql.startsWith("INSERT INTO canonical_alice_visibility_snapshots"));
  assert.equal(insertedSnapshot?.params[0], "wm_alisa_manual_legacy");
  assert.equal(connection.calls.filter(({ sql }) => /canonical_alice_visibility_(queries|sources|featured_sites)/.test(sql) && sql.startsWith("INSERT")).length, 0);
});

test("summary-only checksum includes capture time and rejects invalid legacy source keys", () => {
  const baseArgs = [
    "--summary-only", "--period", "2026-07", "--official-sov", "44",
    "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155",
  ];
  const first = createSummaryOnlySnapshot(parseCliArgs([
    ...baseArgs, "--captured-at", "2026-07-13T14:30:00.000Z",
  ]));
  const corrected = createSummaryOnlySnapshot(parseCliArgs([
    ...baseArgs, "--captured-at", "2026-07-13T15:30:00.000Z",
  ]));
  assert.notEqual(first.snapshot.sourceSha256, corrected.snapshot.sourceSha256);
  assert.throws(() => parseCliArgs([
    "--summary-only", "--period", "2026-07", "--official-sov", "44", "--captured-at", "2026-07-13T14:30:00.000Z",
    "--legacy-source", "wm alisa/../../spoof", "--legacy-mentions", "89", "--legacy-citations", "155",
  ]), /legacy-source/);
});

test("summary-only CLI dry-run reports the canonical legacy source key", () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/import-zaruku-alice-visibility.ts",
    "--summary-only", "--period", "2026-07", "--official-sov", "44",
    "--captured-at", "2026-07-13T14:30:00.000Z",
    "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155",
    "--dry-run",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source_key=wm_alisa_manual_legacy/);
});
