import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAliceVisibilityQueries,
  normalizeAliceVisibilityRows,
} from "@/lib/zaruku-alice-visibility";

const snapshotRows = [{
  id: 11,
  source_key: "yandex_webmaster_alice_manual",
  analytics_account_id: "66624469",
  domain: "zaruku.ru",
  period_month: "2026-07-01",
  captured_at: "2026-08-01 12:00:00",
  official_sov_pct: "43.91",
  exported_query_count: 2,
  portal_present_query_count: 2,
  sample_presence_pct: "100",
  source_filename: "alice.xlsx",
  source_sha256: "a".repeat(64),
  publication_status: "published",
  supersedes_snapshot_id: null,
  ingestion_run_id: "alice-2026-07",
}];

const queryRows = [
  {
    id: 101,
    snapshot_id: 11,
    query_hash: "q1",
    query_text: "first query",
    portal_present: 1,
    portal_position: 1,
    portal_url: "https://zaruku.ru/first",
    alice_answer_url: "https://alice.example/one",
    source_count: 2,
    raw_present_value: "true",
  },
  {
    id: 102,
    snapshot_id: 11,
    query_hash: "q2",
    query_text: "second query",
    portal_present: 1,
    portal_position: 2,
    portal_url: "https://zaruku.ru/second",
    alice_answer_url: "https://alice.example/two",
    source_count: 2,
    raw_present_value: "true",
  },
];

const sourceRowsWithDuplicateDomain = [
  { id: 1, query_id: 101, source_rank: 1, source_url: "https://example.org/a", source_domain: "example.org", is_portal: 0 },
  { id: 2, query_id: 101, source_rank: 2, source_url: "https://example.org/b", source_domain: "example.org", is_portal: 0 },
  { id: 3, query_id: 102, source_rank: 1, source_url: "https://example.org/c", source_domain: "example.org", is_portal: 0 },
];

const featuredRows = [{
  id: 1,
  snapshot_id: 11,
  display_order: 1,
  site_url: "https://featured.example/",
  site_domain: "featured.example",
  list_kind: "yandex_random_high_mentions",
}];

test("read model scopes published snapshots and all children by account", () => {
  const queries = buildAliceVisibilityQueries(["66624469"]);

  assert.equal(queries.length, 4);
  assert.match(queries[0].sql, /canonical_alice_visibility_snapshots/);
  assert.match(queries[0].sql, /analytics_account_id IN \(\?\)/);
  assert.deepEqual(queries[0].params, ["66624469"]);
  for (const query of queries.slice(1)) {
    assert.match(query.sql, /analytics_account_id IN \(\?\)/);
    assert.deepEqual(query.params, ["66624469"]);
  }
});

test("competitor frequency counts a domain once per query", () => {
  const data = normalizeAliceVisibilityRows(snapshotRows, queryRows, sourceRowsWithDuplicateDomain, featuredRows);

  assert.deepEqual(data.snapshots[0].competitors[0], { domain: "example.org", queryCount: 2, sharePct: 100 });
});

test("read model exposes a summary-only legacy source key without assigning query meanings", () => {
  const legacyRows = [{
    ...snapshotRows[0],
    source_key: "wm_alisa_manual_legacy",
    exported_query_count: null,
    portal_present_query_count: null,
    sample_presence_pct: null,
    source_filename: null,
  }];
  const data = normalizeAliceVisibilityRows(legacyRows, [], [], []);

  assert.equal(data.snapshots[0]?.provenance.sourceKey, "wm_alisa_manual_legacy");
  assert.equal(data.snapshots[0]?.exportedQueryCount, null);
  assert.equal(data.snapshots[0]?.portalPresentQueryCount, null);
  assert.deepEqual(data.snapshots[0]?.queries, []);
});
