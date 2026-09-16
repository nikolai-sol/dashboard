import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseTargetIntentWorkbook } from "./site-seo-intent-import";
import { normalizeIntentKey, buildTargetIntentView } from "../../apps/site-seo/src/lib/target-intent";
import { readTargetIntentData } from "../../apps/site-seo/src/lib/db";
import { previewTargetIntent, restoreTargetIntent, type TargetIntentSqlConnection } from "./site-seo-intent-store";

const scope = { siteId: "site-test", dashboardId: 41, clientId: "client-test" };
const parse = (key: string, group = "") => parseTargetIntentWorkbook(Buffer.from(`Ключ,Группа,Тип совпадения\n${key},${group},точное\n`), "intent.csv");
function snapshot(rows: ReturnType<typeof parse>["rows"]) {
  return { site_id: scope.siteId, dashboard_id: scope.dashboardId, version_id: 12, version_uid: "v12", label: "Интент", expected_rule_count: rows.length, import_rule_count: rows.length, import_id: 14, publication_id: 13, source_transport: "upload", source_identity: "intent.csv", content_sha256: "a".repeat(64), validation_state: "valid", validation_result_json: JSON.stringify({ state: "valid", rows }), sealed_at: "2026-09-15T10:00:00Z", published_at: "2026-09-15T10:00:00Z", published_by: "admin@example.test", publication_comment: null };
}
function ruleRows(rows: ReturnType<typeof parse>["rows"]) {
  return rows.map(r => ({ site_id: scope.siteId, dashboard_id: scope.dashboardId, version_id: 12, source_row_ordinal: r.sourceRowOrdinal, rule_key: r.key, normalized_key: r.normalizedKey, group_label: r.group, match_type: r.matchType }));
}

test("10k rules read validation evidence once and retain exact immutable identity on one connection", async () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => ({ sourceRowOrdinal: i + 2, key: `рак ${i}`, normalizedKey: `рак ${i}`, group: null, matchType: "exact" as const }));
  const metadata = snapshot(rows);
  const calls: { sql: string; params: unknown[] }[] = [];
  let releases = 0;
  const connection = { async execute(sql: string, params: unknown[]) {
    calls.push({ sql, params });
    assert.ok(!(/validation_result_json/.test(sql) && /site_seo_intent_rules/.test(sql)), "validation JSON must not join the rules");
    return [/validation_result_json/.test(sql) ? [metadata] : ruleRows(rows), []] as [unknown, unknown];
  }, release() { releases++; } };
  const result = await readTargetIntentData({ execute: async () => { throw new Error("must acquire connection"); }, getConnection: async () => connection } as Parameters<typeof readTargetIntentData>[0], { name: "target_intent", scope });
  assert.equal(result.state, "ready");
  assert.equal(result.rules.length, 10_000);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(c => /validation_result_json/.test(c.sql)).length, 1);
  assert.deepEqual(calls[1].params, [scope.siteId, scope.dashboardId, 12]);
  assert.match(calls[0].sql, /version\.import_id\s*=\s*publication\.import_id/);
  assert.equal(releases, 1);
  assert.ok(Buffer.byteLength(JSON.stringify([metadata, ruleRows(rows)])) < 5_000_000);
});

test("parser Unicode keys survive runtime integrity and validation hash comparison", async () => {
  for (const key of ["рак\u200b", "ра\u200bк", "рак\u0338", "ра\u0338к"]) {
    const parsed = parse(key);
    assert.equal(parsed.state, "valid");
    assert.equal(parsed.rows[0].normalizedKey, normalizeIntentKey(parsed.rows[0].key));
    const metadata = snapshot(parsed.rows);
    const ruleSet = await readTargetIntentData({ async execute(sql) {
      return [/validation_result_json/.test(sql) ? [metadata] : ruleRows(parsed.rows), []];
    } }, { name: "target_intent", scope });
    assert.equal(ruleSet.state, "ready", "publisher validation and runtime hashes agree");
    const result = buildTargetIntentView({ ...scope, label: "Интент", ruleSet, queries: [{ query: key, source: "google", impressions: 3, clicks: 1 }] });
    assert.equal(result.state, "ready");
    assert.equal(result.target.impressions, 3);
  }
});

test("preview enforces MySQL character limits with exact boundary acceptance and row/column errors", () => {
  assert.equal(parse("а".repeat(512), "я".repeat(255)).state, "valid");
  for (const [key, group, column] of [["а".repeat(513), "", "Ключ"], ["a", "я".repeat(256), "Группа"], ["𐐀".repeat(513), "", "Ключ"], ["İ".repeat(512), "", "Ключ"]]) {
    const parsed = parse(key, group);
    assert.equal(parsed.state, "invalid");
    assert.ok(parsed.errors.some(e => e.row === 2 && e.column === column && e.code === "field_too_long"));
  }
  assert.equal(parse("𐐀".repeat(512)).state, "valid", "MySQL counts Unicode characters, not UTF-16 units");
});

test("split rule reads fail closed on identity changes and release their connection on failure", async () => {
  const parsed = parse("рак");
  for (const changed of [{ site_id: "foreign" }, { dashboard_id: 999 }, { version_id: 999 }]) {
    const result = await readTargetIntentData({ async execute(sql) {
      return [/validation_result_json/.test(sql) ? [snapshot(parsed.rows)] : ruleRows(parsed.rows).map(row => ({ ...row, ...changed })), []];
    } }, { name: "target_intent", scope });
    assert.equal(result.state, "unavailable");
    assert.equal(result.provenance, null);
  }
  let released = false;
  await assert.rejects(readTargetIntentData({ async execute() { throw new Error("pool should not execute"); }, async getConnection() {
    return { async execute() { throw new Error("connection lost"); }, release() { released = true; } };
  } }, { name: "target_intent", scope }), /connection lost/);
  assert.equal(released, true);
});

test("CSV preview exposes the encoding and delimiter actually used", () => {
  for (const delimiter of [",", ";", "\t"]) {
    const result = parseTargetIntentWorkbook(Buffer.from(`\ufeffКлюч${delimiter}Тип совпадения\nрак${delimiter}точное\n`), "rules.csv");
    assert.equal(result.state, "valid");
    assert.equal(result.encoding, "UTF-8");
    assert.equal(result.delimiter, delimiter);
  }
});

test("ragged CSV rejects every populated unnamed cell while quoted delimiters remain within one cell", () => {
  for (const [csv, row, column] of [
    ["Ключ,Тип совпадения\nрак,фраза,EXTRA\n", 2, "3"],
    ['Ключ,Тип совпадения\n"рак, лёгкого",фраза,,"EXTRA,more"\n', 2, "4"],
    ["Ключ,Тип совпадения\nрак,фраза\nлёгкое,точное,,,EXTRA\n", 3, "5"],
  ] as const) {
    const result = parseTargetIntentWorkbook(Buffer.from(csv), "intent.csv");
    assert.equal(result.state, "invalid");
    assert.ok(result.errors.some(e => e.row === row && e.column === column && e.code === "unnamed_column"));
  }
  const quoted = parseTargetIntentWorkbook(Buffer.from('Ключ,Тип совпадения\n"рак, лёгкого",фраза,,\n'), "intent.csv");
  assert.equal(quoted.state, "valid");
  assert.equal(quoted.rows[0].key, "рак, лёгкого");
});

test("v2 preview recovers an immutable v1 snapshot receipt by full scoped source identity", async () => {
  const bytes = Buffer.from("Ключ,Тип совпадения\nрак,точное\n");
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const existing = { site_id: scope.siteId, dashboard_id: scope.dashboardId, id: 77, import_uid: "v1-uid", source_transport: "upload", source_identity: "intent.csv", source_identity_hash: hash("intent.csv"), original_filename: "intent.csv", accepted_worksheet: null, protected_artifact_ref: "/protected/old-v1", content_sha256: hash(bytes), validation_state: "valid", validation_result_json: JSON.stringify(parseTargetIntentWorkbook(bytes, "intent.csv")), rule_count: 1, duplicate_count: 0, conflict_count: 0, imported_by: "old@example.test", created_at: "2026-09-01T10:00:00Z" };
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let discarded = false;
  const connection: TargetIntentSqlConnection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async execute(sql, params = []) {
    calls.push({ sql, params });
    if (/INSERT/.test(sql)) throw Object.assign(new Error("uq_intent_import_snapshot duplicate"), { code: "ER_DUP_ENTRY" });
    if (/AND import_uid =/.test(sql)) return [[]];
    return [[existing]];
  } };
  const run = () => previewTargetIntent({ transport: "upload", filename: "intent.csv", bytes, actor: "admin@example.test" }, { scope, database: { getConnection: async () => connection }, snapshots: { async save() { return { protectedRef: "/protected/new-v2", release: async () => {}, discard: async () => { discarded = true; } }; } } });
  const result = await run();
  assert.equal(result.previewId, "77");
  assert.equal(result.importedBy, "old@example.test");
  assert.equal(discarded, true);
  const lookup = calls.find(c => /AND source_transport =/.test(c.sql))!;
  assert.deepEqual(lookup.params, [scope.siteId, scope.dashboardId, "upload", hash("intent.csv"), hash(bytes)]);
  assert.match(lookup.sql, /site_id = \? AND dashboard_id = \?/);
  const original = { ...existing };
  for (const mismatch of [{ site_id: "foreign" }, { dashboard_id: 999 }, { source_identity: "other.csv" }, { content_sha256: "different" }]) {
    Object.assign(existing, original, mismatch);
    await assert.rejects(run(), /snapshot identity does not match/);
  }
});

test("a valid 512-character supplementary Unicode key remains restorable", async () => {
  const key = "𐐀".repeat(512);
  const connection: TargetIntentSqlConnection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (/FROM dashboards/.test(sql)) return [[{ id: scope.dashboardId, client_id: scope.clientId }]];
      if (/JOIN site_seo_intent_rules/.test(sql)) return [[{ source_row_ordinal: 2, rule_key: key, normalized_key: normalizeIntentKey(key), group_label: null, match_type: "exact" }]];
      if (/FROM site_seo_intent_versions/.test(sql)) return [[{ id: 12, import_id: 14, label: "Интент", rule_count: 1 }]];
      if (/INSERT/.test(sql)) return [{ insertId: 15 }];
      return [[]];
    },
  };
  const result = await restoreTargetIntent(12, "admin@example.test", { scope, database: { getConnection: async () => connection }, snapshots: { async save() { throw new Error("restore must not write source artifacts"); } } }, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.kind, "restore");
});

test("lost COMMIT acknowledgement preserves committed evidence and retry returns the same receipt", async () => {
  let persisted: Record<string, unknown> | null = null;
  let committed = false;
  let commits = 0;
  let saves = 0;
  let observedCalls = 0;
  const artifacts = new Set<string>();
  const connection: TargetIntentSqlConnection = {
    async beginTransaction() {}, async commit() { committed = true; if (++commits === 1) throw new Error("lost commit acknowledgement"); },
    async rollback() {}, release() {},
    async execute(sql, p = []) {
      if (/INSERT INTO site_seo_intent_imports/.test(sql)) {
        if (persisted) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        persisted = { id: 7, source_transport: p[3], source_identity: p[4], source_identity_hash: p[5], original_filename: p[6], accepted_worksheet: p[7], protected_artifact_ref: p[8], content_sha256: p[9], validation_state: p[10], validation_result_json: p[11], rule_count: p[12], duplicate_count: p[13], conflict_count: p[14], imported_by: p[15], created_at: "2026-09-15T10:00:00Z" };
        return [{ insertId: 7 }];
      }
      return [[persisted]];
    },
  };
  const deps = { scope, database: { getConnection: async () => connection }, observedQueries: async () => {
    observedCalls++;
    return [{ source: "google" as const, state: "ready" as const, periodFrom: "2026-09-07", periodTo: "2026-09-13", sampledQueryCount: observedCalls, matches: [] }];
  }, snapshots: { async save() {
    const protectedRef = `/protected/evidence-${++saves}`; artifacts.add(protectedRef);
    return { protectedRef, release: async () => {}, discard: async () => { artifacts.delete(protectedRef); } };
  } } };
  const input = { transport: "upload" as const, filename: "intent.csv", bytes: Buffer.from("Ключ,Тип совпадения\nрак,точное\n"), actor: "admin@example.test" };
  await assert.rejects(previewTargetIntent(input, deps), /lost commit/);
  assert.equal(committed, true);
  assert.ok(artifacts.has("/protected/evidence-1"), "COMMIT may already have persisted the artifact reference");
  const retry = await previewTargetIntent(input, deps);
  assert.equal(retry.previewId, "7");
  assert.equal(retry.encoding, "UTF-8");
  assert.equal(retry.delimiter, ",");
  assert.equal(retry.observedQueries?.[0].sampledQueryCount, 1, "retry returns immutable observed evidence from the first preview");
  assert.deepEqual([...artifacts], ["/protected/evidence-1"]);
});
