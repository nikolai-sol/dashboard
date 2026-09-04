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
  assert.match(sql, /UNIQUE KEY uniq_alice_snapshot_checksum/);
  assert.match(sql, /UNIQUE KEY uniq_alice_query/);
  assert.match(sql, /UNIQUE KEY uniq_alice_source_rank/);
  assert.match(sql, /UNIQUE KEY uniq_alice_snapshot_published_month/);
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
      return [this.mode === "same" ? [{ id: 9 }] : [], undefined] as const;
    }
    if (sql.includes("WHERE analytics_account_id = ? AND period_month = ? AND publication_status = 'published'")) {
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

test("builds the July legacy summary with deterministic provenance-only checksum", async () => {
  const options = parseCliArgs([
    "--summary-only", "--period", "2026-07", "--official-sov", "44", "--captured-at", "2026-07-13T14:30:00.000Z",
    "--legacy-source", "wm_alisa_manual_legacy", "--legacy-mentions", "89", "--legacy-citations", "155",
  ]);
  const first = createSummaryOnlySnapshot(options);
  const second = createSummaryOnlySnapshot(options);
  assert.equal(first.snapshot.sourceSha256, second.snapshot.sourceSha256);
  assert.equal(first.snapshot.exportedQueryCount, null);
  assert.equal(first.snapshot.queries.length, 0);
  assert.deepEqual(first.sourcePayloadJson.legacy_unconfirmed, { definition: "unconfirmed", legacy_mentions: 89, legacy_citations: 155 });
  const connection = new FakeConnection("new");
  assert.equal(await persistAliceVisibilitySnapshot(connection, first.snapshot, { sourceKey: first.sourceKey, sourcePayloadJson: first.sourcePayloadJson }), "inserted");
  assert.equal(connection.calls.filter(({ sql }) => /canonical_alice_visibility_(queries|sources|featured_sites)/.test(sql) && sql.startsWith("INSERT")).length, 0);
});
