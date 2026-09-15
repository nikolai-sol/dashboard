import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFilesystemTargetIntentSnapshotStore,
  createGoogleSheetsSnapshotTransport,
  previewTargetIntent,
  publishTargetIntent,
  readTargetIntentState,
  restorePublishedTargetIntent,
  restoreTargetIntent,
  type TargetIntentSqlConnection,
  type TargetIntentStoreDependencies,
} from "./site-seo-intent-store";

type SqlCall = { sql: string; params: readonly unknown[] };

class ScriptedConnection implements TargetIntentSqlConnection {
  readonly calls: SqlCall[] = [];
  readonly events: string[] = [];

  constructor(readonly respond: (sql: string, params: readonly unknown[]) => unknown) {}

  async execute(sql: string, params: readonly unknown[] = []) {
    this.calls.push({ sql, params });
    return this.respond(sql, params);
  }

  async beginTransaction() { this.events.push("begin"); }
  async commit() { this.events.push("commit"); }
  async rollback() { this.events.push("rollback"); }
  release() { this.events.push("release"); }
}

function validationJson(key = "HER2") {
  return JSON.stringify({
    state: "valid",
    format: "csv",
    worksheet: null,
    rows: [{
      sourceRowOrdinal: 2,
      key,
      normalizedKey: key.toLowerCase(),
      group: "Маркеры",
      matchType: "exact",
    }],
    errors: [],
    duplicateCount: 0,
    conflictCount: 0,
  });
}

function dependencies(connection: ScriptedConnection, overrides: Partial<TargetIntentStoreDependencies> = {}): TargetIntentStoreDependencies {
  return {
    scope: { siteId: "site-med", dashboardId: 41 },
    database: { getConnection: async () => connection },
    snapshots: {
      save: async (_bytes, evidence) => ({
        protectedRef: `/protected/${evidence.contentSha256}`,
        release: async () => {},
        discard: async () => {},
      }),
    },
    now: () => new Date("2026-09-15T10:00:00.000Z"),
    ...overrides,
  };
}

test("upload preview persists protected source evidence and is idempotent", async () => {
  const persisted = {
    id: 7,
    import_uid: "a".repeat(64),
    source_transport: "upload",
    source_identity: "intent.csv",
    source_identity_hash: "b".repeat(64),
    original_filename: "intent.csv",
    accepted_worksheet: null,
    protected_artifact_ref: "/protected/first",
    content_sha256: "c".repeat(64),
    validation_state: "valid",
    validation_result_json: validationJson(),
    rule_count: 1,
    duplicate_count: 0,
    conflict_count: 0,
    imported_by: "admin@example.test",
    created_at: "2026-09-15T10:00:00.000Z",
  };
  const connection = new ScriptedConnection((sql) => {
    if (/SELECT[\s\S]+FROM site_seo_intent_imports/i.test(sql)) return [[persisted]];
    return [{ insertId: 7 }];
  });
  const lifecycle: string[] = [];
  let saved = 0;
  const deps = dependencies(connection, {
    snapshots: {
      save: async () => {
        saved += 1;
        return {
          protectedRef: saved === 1 ? "/protected/first" : "/protected/repeated",
          release: async () => { lifecycle.push(`release-${saved}`); },
          discard: async () => { lifecycle.push(`discard-${saved}`); },
        };
      },
    },
  });
  const input = {
    transport: "upload" as const,
    filename: "intent.csv",
    bytes: Buffer.from("Ключ,Тип совпадения\nHER2,точное\n"),
    actor: "ADMIN@example.test",
  };

  const first = await previewTargetIntent(input, deps);
  const repeated = await previewTargetIntent(input, deps);

  assert.equal(first.previewId, "7");
  assert.deepEqual(repeated, first);
  assert.deepEqual(lifecycle, ["release-1", "discard-2"]);
  const insert = connection.calls.find(({ sql }) => /INSERT INTO site_seo_intent_imports/i.test(sql));
  assert.ok(insert);
  assert.match(String(insert.params[8]), /^\/protected\//);
  assert.match(String(insert.params[9]), /^[a-f0-9]{64}$/);
  assert.equal(insert.params[15], "admin@example.test");
  assert.ok(connection.calls.every(({ sql }) => !/canonical_ad_|advertising/i.test(sql)));
});

test("Google Sheets previews normalize the URL and take a fresh manual snapshot each time", async () => {
  let fetchCount = 0;
  const storedRows: Record<string, unknown>[] = [];
  const connection = new ScriptedConnection((sql, params) => {
    if (/INSERT INTO site_seo_intent_imports/i.test(sql)) {
      storedRows.push({
        id: storedRows.length + 1,
        import_uid: params[2], source_transport: params[3], source_identity: params[4],
        source_identity_hash: params[5], original_filename: params[6], accepted_worksheet: params[7],
        protected_artifact_ref: params[8], content_sha256: params[9], validation_state: params[10],
        validation_result_json: params[11], rule_count: params[12], duplicate_count: params[13],
        conflict_count: params[14], imported_by: params[15], created_at: "2026-09-15T10:00:00.000Z",
      });
      return [{ insertId: storedRows.length }];
    }
    if (/FROM site_seo_intent_imports/i.test(sql)) {
      return [[storedRows.find((row) => row.import_uid === params[2])]];
    }
    return [[]];
  });
  const seenUrls: string[] = [];
  const deps = dependencies(connection, {
    googleSheets: {
      fetchSnapshot: async (url) => {
        fetchCount += 1;
        seenUrls.push(url);
        return {
          filename: "intent.csv",
          bytes: Buffer.from(`Ключ,Тип совпадения\nHER${fetchCount},точное\n`),
        };
      },
    },
  });

  const input = {
    transport: "google_sheet" as const,
    sourceUrl: "https://docs.google.com/spreadsheets/d/sheet_ABC/edit?usp=sharing#gid=00012",
    actor: "admin@example.test",
  };
  const first = await previewTargetIntent(input, deps);
  const second = await previewTargetIntent(input, deps);

  assert.equal(fetchCount, 2);
  assert.deepEqual(seenUrls, [
    "https://docs.google.com/spreadsheets/d/sheet_ABC#gid=12",
    "https://docs.google.com/spreadsheets/d/sheet_ABC#gid=12",
  ]);
  assert.notEqual(first.previewId, second.previewId);
  assert.notEqual(first.contentSha256, second.contentSha256);
  assert.equal(storedRows[0].source_transport, "google_sheet");
  assert.equal(storedRows[0].source_identity, seenUrls[0]);
});

test("a failed Google Sheets fetch creates a safe failed preview without changing active state", async () => {
  let stored: Record<string, unknown> | null = null;
  const connection = new ScriptedConnection((sql, params) => {
    if (/INSERT INTO site_seo_intent_imports/i.test(sql)) {
      stored = {
        id: 17,
        import_uid: params[2], source_transport: params[3], source_identity: params[4],
        source_identity_hash: params[5], original_filename: params[6], accepted_worksheet: params[7],
        protected_artifact_ref: params[8], content_sha256: params[9], validation_state: params[10],
        validation_result_json: params[11], rule_count: params[12], duplicate_count: params[13],
        conflict_count: params[14], imported_by: params[15], created_at: "2026-09-15T10:00:00.000Z",
      };
      return [{ insertId: 17 }];
    }
    if (/FROM site_seo_intent_imports/i.test(sql)) return [[stored]];
    return [[]];
  });
  const deps = dependencies(connection, {
    googleSheets: {
      fetchSnapshot: async () => { throw new Error("oauth token and private URL"); },
    },
  });

  const result = await previewTargetIntent({
    transport: "google_sheet",
    sourceUrl: "https://docs.google.com/spreadsheets/d/sheet_ABC#gid=0",
    actor: "admin@example.test",
  }, deps);

  assert.equal(result.state, "failed");
  assert.equal(result.ruleCount, 0);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "source_unavailable",
    message: "Не удалось получить снимок Google Sheets",
  }]);
  assert.equal(connection.calls.some(({ sql }) => /site_seo_intent_active/i.test(sql)), false);
  assert.equal(JSON.stringify(stored).includes("oauth token"), false);
  assert.equal(JSON.stringify(stored).includes("private URL"), false);
});

test("publish locks the scoped dashboard and active pointer, writes a full new version, and switches atomically", async () => {
  const connection = new ScriptedConnection((sql) => {
    if (/FROM dashboards/i.test(sql)) return [[{ id: 41 }]];
    if (/FROM site_seo_intent_imports/i.test(sql)) return [[{
      id: 7, validation_state: "valid", validation_result_json: validationJson(), rule_count: 1,
    }]];
    if (/FROM site_seo_intent_active/i.test(sql)) return [[{ version_id: 5 }]];
    if (/FROM site_seo_intent_publications/i.test(sql)) return [[]];
    if (/INSERT INTO site_seo_intent_versions/i.test(sql)) return [{ insertId: 11 }];
    if (/INSERT INTO site_seo_intent_publications/i.test(sql)) return [{ insertId: 12 }];
    return [{}];
  });

  const result = await publishTargetIntent("7", "Мед. интент", "admin@example.test", dependencies(connection));

  assert.deepEqual(result, {
    publicationId: "12",
    versionId: "11",
    previousVersionId: "5",
    kind: "publish",
    label: "Мед. интент",
    publishedBy: "admin@example.test",
    publishedAt: "2026-09-15T10:00:00.000Z",
  });
  assert.deepEqual(connection.events, ["begin", "commit", "release"]);
  const sql = connection.calls.map(({ sql }) => sql).join("\n");
  assert.match(sql, /FROM dashboards[\s\S]*FOR UPDATE/i);
  assert.match(sql, /FROM site_seo_intent_active[\s\S]*FOR UPDATE/i);
  assert.match(sql, /INSERT INTO site_seo_intent_rules/i);
  assert.match(sql, /INSERT INTO site_seo_intent_publications/i);
  assert.match(sql, /INSERT INTO site_seo_intent_active[\s\S]*ON DUPLICATE KEY UPDATE/i);
  assert.doesNotMatch(sql, /DELETE FROM site_seo_intent_rules/i);
  assert.doesNotMatch(sql, /UPDATE site_seo_intent_rules/i);
});

test("a failed publication rolls back without committing an active transition", async () => {
  const connection = new ScriptedConnection((sql) => {
    if (/FROM dashboards/i.test(sql)) return [[{ id: 41 }]];
    if (/FROM site_seo_intent_imports/i.test(sql)) return [[{
      id: 7, validation_state: "valid", validation_result_json: validationJson(), rule_count: 1,
    }]];
    if (/FROM site_seo_intent_active/i.test(sql)) return [[]];
    if (/FROM site_seo_intent_publications/i.test(sql)) return [[]];
    if (/INSERT INTO site_seo_intent_versions/i.test(sql)) return [{ insertId: 11 }];
    if (/INSERT INTO site_seo_intent_publications/i.test(sql)) throw new Error("private database failure");
    return [{}];
  });

  await assert.rejects(
    publishTargetIntent("7", "Мед. интент", "admin@example.test", dependencies(connection)),
    /Не удалось опубликовать каталог/,
  );
  assert.deepEqual(connection.events, ["begin", "rollback", "release"]);
  assert.equal(connection.calls.some(({ sql }) => /INSERT INTO site_seo_intent_active/i.test(sql)), false);
});

test("history is read-only and restore copies a historical snapshot into a new published version", async () => {
  const connection = new ScriptedConnection((sql) => {
    if (/FROM dashboards/i.test(sql)) return [[{ id: 41 }]];
    if (/FROM site_seo_intent_versions AS version[\s\S]*JOIN site_seo_intent_rules/i.test(sql)) return [[{
      id: 4, import_id: 3, label: "Мед. интент v1", rule_count: 1,
      source_row_ordinal: 2, rule_key: "HER2", normalized_key: "her2", group_label: "Маркеры", match_type: "exact",
    }]];
    if (/FROM site_seo_intent_versions AS version/i.test(sql)) return [[{
      id: 4, import_id: 3, label: "Мед. интент v1", rule_count: 1,
    }]];
    if (/FROM site_seo_intent_active/i.test(sql)) return [[{ version_id: 9 }]];
    if (/FROM site_seo_intent_publications/i.test(sql) && /request_uid/i.test(sql)) return [[]];
    if (/INSERT INTO site_seo_intent_versions/i.test(sql)) return [{ insertId: 15 }];
    if (/INSERT INTO site_seo_intent_publications/i.test(sql)) return [{ insertId: 16 }];
    if (/SELECT[\s\S]*publication_kind[\s\S]*ORDER BY publication\.published_at/i.test(sql)) return [[{
      publication_id: 8, version_id: 9, previous_version_id: 4, publication_kind: "publish",
      published_by: "first@example.test", published_at: "2026-09-14T10:00:00.000Z",
      publication_comment: null, label: "Мед. интент v2", rule_count: 2,
      source_transport: "upload", source_identity: "v2.csv", source_identity_hash: "a".repeat(64),
      content_sha256: "b".repeat(64), import_id: 7,
    }]];
    if (/SELECT[\s\S]*validation_state[\s\S]*ORDER BY imported\.created_at/i.test(sql)) return [[]];
    return [{}];
  });
  const deps = dependencies(connection);

  const state = await readTargetIntentState(deps);
  const restored = await restoreTargetIntent("4", "admin@example.test", deps);

  assert.equal(state.history[0].versionId, "9");
  assert.equal(state.history[0].active, true);
  assert.equal(restored.kind, "restore");
  assert.equal(restored.versionId, "15");
  assert.equal(restored.previousVersionId, "9");
  const sql = connection.calls.map(({ sql }) => sql).join("\n");
  assert.doesNotMatch(sql, /UPDATE site_seo_intent_versions SET label/i);
  assert.doesNotMatch(sql, /DELETE FROM site_seo_intent_/i);
  const publication = connection.calls.find(({ sql }) => /INSERT INTO site_seo_intent_publications/i.test(sql));
  assert.equal(publication?.params[6], "restore");
});

test("browser restore identity is a scoped publication resolved to a version on the server", async () => {
  const resolveConnection = new ScriptedConnection((sql, params) => {
    if (/FROM site_seo_intent_publications[\s\S]*publication\.id = \?/i.test(sql)) {
      assert.deepEqual(params, ["site-med", 41, 8]);
      return [[{ version_id: 4 }]];
    }
    return [[]];
  });
  const restoreConnection = new ScriptedConnection((sql) => {
    if (/FROM dashboards/i.test(sql)) return [[{ id: 41 }]];
    if (/FROM site_seo_intent_active/i.test(sql)) return [[{ version_id: 9 }]];
    if (/FROM site_seo_intent_publications/i.test(sql) && /request_uid/i.test(sql)) return [[]];
    if (/FROM site_seo_intent_versions AS version[\s\S]*JOIN site_seo_intent_rules/i.test(sql)) return [[{
      id: 4, import_id: 3, label: "Мед. интент v1", rule_count: 1,
      source_row_ordinal: 2, rule_key: "HER2", normalized_key: "her2", group_label: "Маркеры", match_type: "exact",
    }]];
    if (/FROM site_seo_intent_versions AS version/i.test(sql)) return [[{
      id: 4, import_id: 3, label: "Мед. интент v1", rule_count: 1,
    }]];
    if (/INSERT INTO site_seo_intent_versions/i.test(sql)) return [{ insertId: 15 }];
    if (/INSERT INTO site_seo_intent_publications/i.test(sql)) return [{ insertId: 16 }];
    return [{}];
  });
  let connectionIndex = 0;
  const deps = dependencies(resolveConnection, {
    database: {
      getConnection: async () => [resolveConnection, restoreConnection][connectionIndex++],
    },
  });

  const result = await restorePublishedTargetIntent("8", "admin@example.test", deps);
  assert.equal(result.versionId, "15");
  assert.equal(result.kind, "restore");
});

test("filesystem snapshot storage is content-addressed, private and reusable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-intent-"));
  try {
    const store = createFilesystemTargetIntentSnapshotStore(root);
    const bytes = Buffer.from("protected evidence");
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const evidence = { contentSha256, sourceIdentityHash: "b".repeat(64) };
    const first = await store.save(bytes, evidence);
    const second = await store.save(bytes, evidence);

    assert.equal(first.protectedRef, second.protectedRef);
    assert.equal(await readFile(first.protectedRef, "utf8"), "protected evidence");
    assert.equal((await stat(first.protectedRef)).mode & 0o777, 0o640);
    assert.equal(first.protectedRef.startsWith(path.resolve(root) + path.sep), true);
    await first.release();
    await second.discard();
    assert.equal(await readFile(first.protectedRef, "utf8"), "protected evidence");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Google Sheets transport uses a bounded public XLSX export without credentials", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const transport = createGoogleSheetsSnapshotTransport(async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(Buffer.from("xlsx snapshot"), { status: 200 });
  });

  const snapshot = await transport.fetchSnapshot("https://docs.google.com/spreadsheets/d/sheet_ABC#gid=12");

  assert.equal(snapshot.filename, "target-intent.xlsx");
  assert.equal(Buffer.from(snapshot.bytes).toString("utf8"), "xlsx snapshot");
  assert.deepEqual(requests, [{
    url: "https://docs.google.com/spreadsheets/d/sheet_ABC/export?format=xlsx&gid=12",
    init: { method: "GET", redirect: "error", credentials: "omit", headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } },
  }]);
});
