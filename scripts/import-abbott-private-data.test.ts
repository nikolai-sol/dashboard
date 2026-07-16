import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  assertPrivateImportPath,
  canonicalRowFingerprint,
  normalizeAbbottUrl,
  parseBitrixJourneyPayload,
  parseBitrixPagePayload,
  parseWorkbookJson,
  parseWorkbookXlsx,
  prepareAbbottSources,
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

test("assertPrivateImportPath rejects a symlink whose real path is under public", () => {
  const root = mkdtempSync(path.join(tmpdir(), "abbott-import-path-"));
  try {
    const publicDir = path.join(root, "public");
    mkdirSync(publicDir);
    writeFileSync(path.join(publicDir, "workbook.json"), "{}");
    const alias = path.join(root, "private-alias");
    symlinkSync(publicDir, alias, "dir");
    assert.throws(
      () => assertPrivateImportPath(path.join(alias, "workbook.json"), "workbook JSON"),
      /public/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

function workbookBuffer(sheets: Record<string, Array<Record<string, unknown>>>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("Workbook XLSX preserves access and active state and rejects ambiguous lookup keys", () => {
  const parsed = parseWorkbookXlsx(workbookBuffer({
    "Статьи": [
      { "Название": "Active guide", "Символьный код": "active-guide", "Доступ": "Врачи", "Активность": "Да" },
      { "Название": "Archived guide", "Символьный код": "archived-guide", "Доступ": "Все", "Активность": "Нет" },
    ],
  }));
  assert.deepEqual(
    parsed.rows.map((row) => ({ access: row.access, isActive: row.isActive })),
    [{ access: "Врачи", isActive: true }, { access: "Все", isActive: false }],
  );

  assert.throws(
    () => parseWorkbookXlsx(workbookBuffer({
      "Статьи": [{ "Название": "Shared title", "Символьный код": "article" }],
      "Видео": [{ "Название": "Shared title", "Символьный код": "video" }],
    })),
    /duplicate.*title/i,
  );
  assert.throws(
    () => parseWorkbookXlsx(workbookBuffer({
      "Статьи": [
        { "Название": "One", "Символьный код": "shared-slug" },
        { "Название": "Two", "Символьный код": "shared-slug" },
      ],
    })),
    /duplicate.*slug/i,
  );
});

test("prepared sources use store source kinds and persist XLSX metadata plus both Bitrix page projections", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "abbott-import-prepare-"));
  try {
    const workbookJsonPath = path.join(root, "workbook.json");
    const workbookXlsxPath = path.join(root, "workbook.xlsx");
    const bitrixPagesPath = path.join(root, "pages.json");
    const bitrixJourneysPath = path.join(root, "journeys.json");
    writeFileSync(workbookJsonPath, JSON.stringify({
      id: [{ id: "0001", direction: "cardiology" }],
      general_materials: [{ name: "General", url: "/general", material_type: "guide", direction: "cardiology" }],
      events: [{ title: "Event", registration_url: "/event", direction: "cardiology", access: "Врачи" }],
    }));
    writeFileSync(workbookXlsxPath, workbookBuffer({
      "Статьи": [{ "Название": "Guide", "Символьный код": "guide", "Доступ": "Врачи", "Активность": "Нет" }],
    }));
    writeFileSync(bitrixPagesPath, JSON.stringify({
      grain: "normalized_path x report_date",
      manifest: { complete: true, truncated: false, source_hit_rows: 1, accepted_hit_rows: 1, rejected_hit_rows: 0, output_rows: 1 },
      rows: [{ report_date: "2026-05-20", normalized_path: "/guide", pageviews: 1 }],
    }));
    writeFileSync(bitrixJourneysPath, JSON.stringify({
      schema: { grain: "protected_visit_id x event_sequence", ordered_events: true },
      manifest: { complete: true, truncated: false, source_hit_rows: 2, emitted_event_rows: 2, rejected_hit_rows: 0 },
      rows: [
        { report_date: "2026-05-20", protected_visit_id: "visit-1", raw_user_id: "user-1", source_event_id: "event-1", event_sequence: 0, event_at: "2026-05-20 10:00:00", normalized_path: "/guide", event_kind: "pageview" },
        { report_date: "2026-05-20", protected_visit_id: "visit-1", raw_user_id: "user-1", source_event_id: "event-2", event_sequence: 1, event_at: "2026-05-20 10:01:00", normalized_path: "/event", event_kind: "pageview" },
      ],
    }));

    const sources = await prepareAbbottSources({
      canonicalReleaseId: 77,
      workbookJsonPath,
      workbookXlsxPath,
      bitrixPagesPath,
      bitrixJourneysPath,
      parserVersion: "task7-test",
      codeRevision: "deadbeef",
      archiveDir: path.join(root, "archive"),
    });
    assert.deepEqual(sources.map((source) => source.sourceKind), [
      "abbott_workbook_json",
      "abbott_workbook_catalog",
      "abbott_bitrix_pages",
      "abbott_bitrix_journeys",
    ]);
    const catalogBatch = sources[1]?.batches[0];
    assert.ok(catalogBatch);
    assert.ok(catalogBatch.columns.includes("access_label"));
    assert.ok(catalogBatch.columns.includes("is_active"));
    assert.equal(catalogBatch.rows[0]?.[catalogBatch.columns.indexOf("access_label")], "Врачи");
    assert.equal(catalogBatch.rows[0]?.[catalogBatch.columns.indexOf("is_active")], false);
    assert.deepEqual(
      sources[2]?.batches.map((batch) => batch.table).sort(),
      ["report_bd.portal_bitrix_page_facts", "report_bd_private.portal_bitrix_page_facts"],
    );
    for (const source of sources) {
      for (const batch of source.batches) {
        batch.rows.forEach((row, index) => {
          const fingerprint = batch.fingerprints[index];
          if (batch.fingerprintColumn) {
            const fingerprintIndex = batch.columns.indexOf(batch.fingerprintColumn);
            assert.notEqual(fingerprintIndex, -1);
            assert.equal(row[fingerprintIndex], fingerprint);
            assert.equal(
              fingerprint,
              canonicalRowFingerprint(row.filter((_value, columnIndex) => columnIndex !== fingerprintIndex)),
            );
          } else {
            assert.deepEqual(batch.verificationColumns, batch.columns);
            assert.equal(fingerprint, canonicalRowFingerprint(row));
          }
        });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Bitrix page parser requires complete daily rows and rejects duplicate fingerprints", () => {
  const payload = {
    generated_at: "2026-05-29T11:00:00Z",
    grain: "normalized_path x report_date",
    manifest: { complete: true, truncated: false, source_hit_rows: 2, accepted_hit_rows: 2, rejected_hit_rows: 0, output_rows: 1 },
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
  assert.equal(parsed.manifest.source_hit_rows, 2);
  const changedMetrics = parseBitrixPagePayload({
    ...payload,
    manifest: { ...payload.manifest, source_hit_rows: 3, accepted_hit_rows: 3 },
    rows: [{ ...payload.rows[0], pageviews: 3 }],
  });
  assert.equal(parsed.rows[0]?.targetKeyFingerprint, changedMetrics.rows[0]?.targetKeyFingerprint);
  assert.notEqual(parsed.rows[0]?.sourceFingerprint, changedMetrics.rows[0]?.sourceFingerprint);
  assert.throws(
    () => parseBitrixPagePayload({ ...payload, manifest: { complete: false, truncated: true } }),
    /truncat|complete/i,
  );
  assert.throws(
    () => parseBitrixPagePayload({ ...payload, manifest: { complete: true, truncated: false } }),
    /count|manifest/i,
  );
  assert.throws(
    () => parseBitrixPagePayload({ ...payload, manifest: { ...payload.manifest, accepted_hit_rows: 1, source_hit_rows: 1 } }),
    /pageview|reconcile/i,
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
    manifest: { complete: true, truncated: false, source_hit_rows: 2, emitted_event_rows: 2, rejected_hit_rows: 0 },
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
  assert.equal(parsed.manifest.source_hit_rows, 2);
  const changedIdentity = parseBitrixJourneyPayload({
    generated_at: "2026-05-29T11:00:00Z",
    schema: { grain: "protected_visit_id x event_sequence", ordered_events: true },
    manifest: { complete: true, truncated: false, source_hit_rows: 2, emitted_event_rows: 2, rejected_hit_rows: 0 },
    rows: [
      {
        report_date: "2026-05-20",
        protected_visit_id: "0000000000009007199254740993",
        raw_user_id: "different-user",
        source_event_id: "different-event",
        event_sequence: 0,
        event_at: "2026-05-20 10:00:00",
        normalized_path: "/one",
        event_kind: "pageview",
      },
      {
        report_date: "2026-05-20",
        protected_visit_id: "0000000000009007199254740993",
        raw_user_id: "000123",
        event_sequence: 1,
        event_at: "2026-05-20 10:01:00",
        normalized_path: "/two",
        event_kind: "pageview",
      },
    ],
  });
  assert.equal(parsed.rows[0]?.targetKeyFingerprint, changedIdentity.rows[0]?.targetKeyFingerprint);
  assert.notEqual(parsed.rows[0]?.sourceFingerprint, changedIdentity.rows[0]?.sourceFingerprint);

  assert.throws(
    () => parseBitrixJourneyPayload({
      generated_at: "2026-05-29T11:00:00Z",
      schema: { grain: "protected_visit_id x event_sequence", ordered_events: true },
      manifest: { complete: true, truncated: false, source_hit_rows: 3, emitted_event_rows: 3, rejected_hit_rows: 0 },
      rows: [
        ...parsed.rows.map((row) => ({
          report_date: row.reportDate,
          protected_visit_id: row.protectedVisitId,
          raw_user_id: row.rawUserId,
          event_sequence: row.eventSequence,
          event_at: row.eventAt,
          normalized_path: row.normalizedPath,
          event_kind: row.eventKind,
        })),
        {
          report_date: "2026-05-20",
          protected_visit_id: "0000000000009007199254740993",
          event_sequence: 1,
          event_at: "2026-05-20 10:02:00",
          normalized_path: "/different",
          event_kind: "pageview",
        },
      ],
    }),
    /duplicate.*journey.*key/i,
  );

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
    sourceKind: "abbott_workbook_json" as PreparedAbbottSource["sourceKind"],
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
    manifest: { source_kind: "abbott_workbook_json", row_count: 1 },
    batches: [
      {
        table: "report_bd_private.portal_user_directions_private",
        columns: ["raw_user_id"],
        rows: [["000123"]],
        fingerprints: [canonicalRowFingerprint(["000123"])],
        verificationColumns: ["raw_user_id"],
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
      if (compact.startsWith("SELECT raw_user_id FROM")) return [[{ raw_user_id: "000123" }], []];
      return [[], []];
    },
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
  };

  const result = await runAbbottImportTransaction(connection, 77, [source()]);

  assert.equal(snapshotLookupCount, 1);
  assert.deepEqual(result, { canonicalReleaseId: 77, snapshotIds: { abbott_workbook_json: 101 }, idempotentKinds: [] });
  assert.equal(calls.filter((call) => call === "begin").length, 1);
  assert.equal(calls.filter((call) => call === "commit").length, 1);
  assert.equal(calls.filter((call) => call === "rollback").length, 0);
  assert.ok(calls.findIndex((call) => call.includes("FOR UPDATE")) < calls.findIndex((call) => call.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")));
  assert.ok(calls.some((call) => call.startsWith("UPDATE report_bd.portal_data_releases SET source_snapshot_ids")));
  assert.ok(!calls.some((call) => /portal_active_data_releases|SET\s+release_status\s*=/i.test(call)));
});

test("transaction is checksum-idempotent only when the current release rows verify", async () => {
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
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 1 }], []];
      if (compact.startsWith("SELECT raw_user_id FROM")) return [[{ raw_user_id: "000123" }], []];
      return [[], []];
    },
    commit: async () => idempotentCalls.push("commit"),
    rollback: async () => idempotentCalls.push("rollback"),
  };
  const result = await runAbbottImportTransaction(idempotentConnection, 77, [source()]);
  assert.deepEqual(result.idempotentKinds, ["abbott_workbook_json"]);
  assert.ok(!idempotentCalls.some((call) => call.includes("portal_user_directions_private") && call.startsWith("INSERT")));

  const crossReleaseConnection: AbbottImportConnection = {
    beginTransaction: async () => undefined,
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) {
        return [[{ id: 44, import_status: "imported", imported_row_count: 1 }], []];
      }
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 0 }], []];
      return [[], []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  await assert.rejects(() => runAbbottImportTransaction(crossReleaseConnection, 77, [source()]), /import failed/i);

  const changedMetricConnection: AbbottImportConnection = {
    beginTransaction: async () => undefined,
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) {
        return [[{ id: 44, import_status: "imported", imported_row_count: 1 }], []];
      }
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 1 }], []];
      if (compact.startsWith("SELECT raw_user_id FROM")) return [[{ raw_user_id: "000123" }], []];
      if (compact.startsWith("SELECT source_row_fingerprint")) {
        return [[{ fingerprint: canonicalRowFingerprint([3]) }], []];
      }
      return [[], []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  await assert.rejects(
    () => runAbbottImportTransaction(changedMetricConnection, 77, [source({
      batches: [{
        table: "report_bd.portal_bitrix_page_facts",
        columns: ["pageviews", "source_row_fingerprint"],
        rows: [[2, canonicalRowFingerprint([2])]],
        fingerprints: [canonicalRowFingerprint([2])],
        fingerprintColumn: "source_row_fingerprint",
      }],
    })]),
    /import failed/i,
  );

  const unexpectedRowsConnection: AbbottImportConnection = {
    beginTransaction: async () => undefined,
    execute: async (sql) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[]" }], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) {
        return [[{ id: 44, import_status: "imported", imported_row_count: 0 }], []];
      }
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 1 }], []];
      return [[], []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  await assert.rejects(
    () => runAbbottImportTransaction(unexpectedRowsConnection, 77, [source({
      sourceRowCount: 0,
      importedRowCount: 0,
      batches: [{
        table: "report_bd.portal_bitrix_page_facts",
        columns: ["source_row_fingerprint"],
        rows: [],
        fingerprints: [],
        fingerprintColumn: "source_row_fingerprint",
      }],
    })]),
    /import failed/i,
  );
});

test("transaction rejects any batch without deterministic fingerprint verification", async () => {
  const connection: AbbottImportConnection = {
    beginTransaction: async () => { throw new Error("must fail before transaction"); },
    execute: async () => [[], []],
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  await assert.rejects(
    () => runAbbottImportTransaction(connection, 77, [source({
      batches: [{
        table: "report_bd_private.portal_user_directions_private",
        columns: ["raw_user_id"],
        rows: [["000123"]],
        fingerprints: [canonicalRowFingerprint(["000123"])],
      }],
    })]),
    /fingerprint verification/i,
  );
});

test("transaction preserves verified existing Metrika and optional snapshot IDs while replacing imported kinds", async () => {
  let attached: unknown;
  const connection: AbbottImportConnection = {
    beginTransaction: async () => undefined,
    execute: async (sql, params) => {
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.includes("FROM report_bd.portal_data_releases")) {
        return [[{ id: 77, dataset_key: "abbott", release_status: "staging", source_snapshot_ids: "[5,6,6,7]" }], []];
      }
      if (compact.includes("WHERE id IN")) {
        return [[
          { id: 7, dataset_key: "abbott", source_kind: "abbott_workbook_json", import_status: "imported" },
          { id: 6, dataset_key: "abbott", source_kind: "abbott_bitrix_pages", import_status: "imported" },
          { id: 5, dataset_key: "abbott", source_kind: "metrika_site", import_status: "imported" },
        ], []];
      }
      if (compact.includes("FROM report_bd.portal_dataset_snapshots")) return [[], []];
      if (compact.startsWith("INSERT INTO report_bd.portal_dataset_snapshots")) return [{ insertId: 101 }, []];
      if (compact.startsWith("SELECT COUNT(*)")) return [[{ row_count: 1 }], []];
      if (compact.startsWith("SELECT raw_user_id FROM")) return [[{ raw_user_id: "000123" }], []];
      if (compact.startsWith("UPDATE report_bd.portal_data_releases")) attached = params?.[0];
      return [{ affectedRows: 1 }, []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };

  await runAbbottImportTransaction(connection, 77, [source()]);
  assert.deepEqual(JSON.parse(String(attached)), [5, 6, 101]);
});

test("transaction rejects unreconciled counts and row-level manifest values before mutation", async () => {
  let began = false;
  const connection: AbbottImportConnection = {
    beginTransaction: async () => { began = true; },
    execute: async () => [[], []],
    commit: async () => undefined,
    rollback: async () => undefined,
  };
  await assert.rejects(
    () => runAbbottImportTransaction(connection, 77, [source({ sourceRowCount: 2 })]),
    /reconcile/i,
  );
  await assert.rejects(
    () => runAbbottImportTransaction(connection, 77, [source({ manifest: { note: "/private/user/000123?token=secret" } })]),
    /manifest/i,
  );
  assert.equal(began, false);
});

test("transaction rolls back failures with a sanitized error", async () => {

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
      if (compact.startsWith("SELECT raw_user_id FROM")) {
        return [rows.map((row) => ({ raw_user_id: row[0] })), []];
      }
      return [[], []];
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  };

  await runAbbottImportTransaction(connection, 77, [
    source({
      sourceRowCount: rows.length,
      importedRowCount: rows.length,
      manifest: { source_kind: "abbott_workbook_json", row_count: rows.length },
      batches: [
        {
          table: "report_bd_private.portal_user_directions_private",
          columns: ["raw_user_id"],
          rows,
          fingerprints: rows.map((row) => canonicalRowFingerprint(row)),
          verificationColumns: ["raw_user_id"],
        },
      ],
    }),
  ]);

  assert.equal(factInsertCount, 2);
});
