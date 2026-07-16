import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateImportPath,
  canonicalRowFingerprint,
  normalizeAbbottUrl,
  parseBitrixJourneyPayload,
  parseBitrixPagePayload,
  parseWorkbookJson,
  runAbbottImportTransaction,
  type AbbottImportConnection,
  type PreparedAbbottSource,
} from "./import-abbott-private-data";

test("normalizeAbbottUrl removes query and fragment and normalizes case and slashes", () => {
  assert.equal(
    normalizeAbbottUrl("HTTPS://AbbottPro.RU//articles///heart/?token=private#section"),
    "https://abbottpro.ru/articles/heart",
  );
  assert.equal(normalizeAbbottUrl("/articles///heart/?secret=yes"), "/articles/heart");
  assert.equal(normalizeAbbottUrl("https://abbottpro.ru"), "https://abbottpro.ru/");
});

test("assertPrivateImportPath rejects public paths and requires explicit paths", () => {
  assert.throws(() => assertPrivateImportPath("", "workbook JSON"), /explicit/i);
  assert.throws(
    () => assertPrivateImportPath("/srv/dashboard/public/abbott/workbook.json", "workbook JSON"),
    /public/i,
  );
  assert.doesNotThrow(() => assertPrivateImportPath("/srv/private/abbott/workbook.json", "workbook JSON"));
});

test("parseWorkbookJson preserves lossless raw IDs only in private rows and rejects duplicates", () => {
  const parsed = parseWorkbookJson({
    id: [
      { id: "000123", direction: "cardiology" },
      { id: "90071992547409931234", direction: "neurology" },
      { id: "doctor-A7", direction: "gastro" },
      { id: "unmapped", direction: "" },
    ],
    general_materials: [{ name: "Guide", url: "https://ABBOTTPRO.ru//guide/?code=private" }],
    events: [
      {
        title: "Conference",
        direction: "cardiology",
        registration_url: "https://abbottpro.ru//event/?invite=private#form",
        access: "registered",
      },
    ],
  });

  assert.deepEqual(
    parsed.privateUserDirections.map((row) => row.rawUserId),
    ["000123", "90071992547409931234", "doctor-A7"],
  );
  assert.equal(parsed.generalMaterials[0]?.normalizedUrl, "https://abbottpro.ru/guide");
  assert.equal(parsed.eventCatalog[0]?.registrationUrl, "https://abbottpro.ru/event");
  assert.equal(parsed.rejectedCount, 1);
  const publicEvidence = JSON.stringify({
    manifest: parsed.manifest,
    generalMaterials: parsed.generalMaterials,
    eventCatalog: parsed.eventCatalog,
  });
  assert.doesNotMatch(publicEvidence, /000123|90071992547409931234|doctor-A7|invite=|code=/);

  assert.throws(
    () =>
      parseWorkbookJson({
        id: [
          { id: "000123", direction: "one" },
          { id: "000123", direction: "two" },
        ],
      }),
    /duplicate.*user/i,
  );
});

test("canonicalRowFingerprint is stable, length-delimited, and contains no input text", () => {
  const first = canonicalRowFingerprint(["ab", "c"]);
  const second = canonicalRowFingerprint(["a", "bc"]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /ab|private/i);
});

test("Bitrix page parser requires complete daily rows and rejects duplicate fingerprints", () => {
  const payload = {
    generated_at: "2026-05-29T11:00:00Z",
    grain: "normalized_path x report_date",
    manifest: { complete: true, truncated: false },
    rows: [
      {
        report_date: "2026-05-20",
        normalized_path: "/articles/a?private=1",
        pageviews: 2,
        sessions: 1,
        users: 1,
      },
    ],
  };
  const parsed = parseBitrixPagePayload(payload);
  assert.equal(parsed.rows[0]?.normalizedPath, "/articles/a");
  assert.throws(
    () => parseBitrixPagePayload({ ...payload, manifest: { complete: false, truncated: true } }),
    /truncat|complete/i,
  );
  assert.throws(
    () => parseBitrixPagePayload({ ...payload, rows: [payload.rows[0], payload.rows[0]] }),
    /duplicate/i,
  );
});

test("Bitrix journey parser requires ordered lossless event rows", () => {
  const parsed = parseBitrixJourneyPayload({
    generated_at: "2026-05-29T11:00:00Z",
    schema: { grain: "protected_visit_id x event_sequence", ordered_events: true },
    manifest: { complete: true, truncated: false },
    rows: [
      {
        report_date: "2026-05-20",
        protected_visit_id: "0000000000009007199254740993",
        raw_user_id: "000123",
        event_sequence: 0,
        event_at: "2026-05-20 10:00:00",
        normalized_path: "/one?token=private",
        event_kind: "pageview",
      },
      {
        report_date: "2026-05-20",
        protected_visit_id: "0000000000009007199254740993",
        raw_user_id: "000123",
        event_sequence: 1,
        event_at: "2026-05-20 10:01:00",
        normalized_path: "/two#private",
        event_kind: "pageview",
      },
    ],
  });
  assert.equal(parsed.rows[0]?.protectedVisitId, "0000000000009007199254740993");
  assert.equal(parsed.rows[0]?.rawUserId, "000123");
  assert.equal(parsed.rows[1]?.normalizedPath, "/two");
  assert.equal(parsed.transitions[0]?.transitionCount, 1);

  assert.throws(
    () =>
      parseBitrixJourneyPayload({
        schema: { grain: "session_id x report_date" },
        rows: [{ session_id: 1, content_path: ["/one", "/two"] }],
      }),
    /ordered.*event|event.*grain/i,
  );
});

function source(overrides: Partial<PreparedAbbottSource> = {}): PreparedAbbottSource {
  return {
    sourceKind: "workbook_json",
    basename: "workbook.json",
    contentSha256: "a".repeat(64),
    contentBytes: 10,
    sourceRowCount: 1,
    importedRowCount: 1,
    rejectedRowCount: 0,
    parserVersion: "task7-test",
    codeRevision: "deadbeef",
    archiveLocator: "/srv/private/archive/workbook.json",
    periodMinDate: null,
    periodMaxDate: null,
    generatedAt: null,
    manifest: { source_kind: "workbook_json", row_count: 1 },
    batches: [
      {
        table: "report_bd_private.portal_user_directions_private",
        columns: ["raw_user_id"],
        rows: [["000123"]],
        fingerprints: [canonicalRowFingerprint(["000123"])],
      },
    ],
    ...overrides,
  };
}

test("transaction locks one staging Abbott release, writes and verifies, attaches snapshots, and commits once", async () => {
  const calls: string[] = [];
  let snapshotLookupCount = 0;
  const connection: AbbottImportConnection = {
    beginTransaction: async () => calls.push("begin"),
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      calls.push(compact);
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) {
        snapshotLookupCount += 1;
        return [[], []];
      }
      if (compact.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")) {
        return [{ insertId: 101 }, []];
      }
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 1 }], []];
      return [[], []];
    },
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
  };

  const result = await runAbbottImportTransaction(connection, 77, [source()]);

  assert.equal(snapshotLookupCount, 1);
  assert.deepEqual(result, { canonicalReleaseId: 77, snapshotIds: { workbook_json: 101 }, idempotentKinds: [] });
  assert.equal(calls.filter((call) => call === "begin").length, 1);
  assert.equal(calls.filter((call) => call === "commit").length, 1);
  assert.equal(calls.filter((call) => call === "rollback").length, 0);
  assert.ok(calls.findIndex((call) => call.includes("FOR UPDATE")) < calls.findIndex((call) => call.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")));
  assert.ok(calls.some((call) => call.startsWith("UPDATE report_bd.portal_data_releases SET source_snapshot_ids")));
  assert.ok(!calls.some((call) => /portal_active_data_releases|SET\s+release_status\s*=/i.test(call)));
});

test("transaction is checksum-idempotent by dataset and kind and rolls back failures", async () => {
  const idempotentCalls: string[] = [];
  const idempotentConnection: AbbottImportConnection = {
    beginTransaction: async () => idempotentCalls.push("begin"),
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      idempotentCalls.push(compact);
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) {
        return [[{ id: 44, import_status: "imported", imported_row_count: 1 }], []];
      }
      return [[], []];
    },
    commit: async () => idempotentCalls.push("commit"),
    rollback: async () => idempotentCalls.push("rollback"),
  };
  const result = await runAbbottImportTransaction(idempotentConnection, 77, [source()]);
  assert.deepEqual(result.idempotentKinds, ["workbook_json"]);
  assert.ok(!idempotentCalls.some((call) => call.includes("portal_user_directions_private") && call.startsWith("INSERT")));

  const failureCalls: string[] = [];
  const failingConnection: AbbottImportConnection = {
    beginTransaction: async () => failureCalls.push("begin"),
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      failureCalls.push(compact);
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) return [[], []];
      if (compact.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")) return [{ insertId: 101 }, []];
      throw new Error("sensitive raw 000123 at /private/workbook.json");
    },
    commit: async () => failureCalls.push("commit"),
    rollback: async () => failureCalls.push("rollback"),
  };
  await assert.rejects(
    () => runAbbottImportTransaction(failingConnection, 77, [source()]),
    (error: unknown) => error instanceof Error && error.message === "Abbott private import failed",
  );
  assert.equal(failureCalls.filter((call) => call === "rollback").length, 1);
  assert.equal(failureCalls.filter((call) => call === "commit").length, 0);
});

test("transaction chunks large fact batches on the same connection", async () => {
  let factInsertCount = 0;
  const rows = Array.from({ length: 501 }, (_, index) => [`user-${index}`]);
  const connection: AbbottImportConnection = {
    beginTransaction: async () => undefined,
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) return [[], []];
      if (compact.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")) return [{ insertId: 101 }, []];
      if (compact.startsWith("INSERT INTO report_bd_private.portal_user_directions_private")) factInsertCount += 1;
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 501 }], []];
      return [[], []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };

  await runAbbottImportTransaction(connection, 77, [
    source({
      sourceRowCount: rows.length,
      importedRowCount: rows.length,
      manifest: { source_kind: "workbook_json", row_count: rows.length },
      batches: [
        {
          table: "report_bd_private.portal_user_directions_private",
          columns: ["raw_user_id"],
          rows,
          fingerprints: rows.map((row) => canonicalRowFingerprint(row)),
        },
      ],
    }),
  ]);

  assert.equal(factInsertCount, 2);
});
