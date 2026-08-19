import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enqueueCanonicalImport } from "./canonical-import-request";
import { resolveReviewedAdvertisingSource } from "./admin-dashboards";

class FakeConnection {
  readonly statements: Array<{ sql: string; params: Array<string | number | boolean | null | Buffer> }> = [];

  async execute(sql: string, params: Array<string | number | boolean | null | Buffer> = []) {
    this.statements.push({ sql, params });
    if (sql.includes("INSERT INTO canonical_ad_import_requests")) {
      return [{ insertId: 123 }];
    }
    return [{}];
  }
}

test("confirmed upload writes a protected artifact and queues a canonical import", async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  try {
    const connection = new FakeConnection();
    const result = await enqueueCanonicalImport(
      connection,
      {
        advertiserKey: "gidrofuril",
        sourceKey: "yandex_direct",
        platformAccountId: "gidrofuril-search",
        transport: "upload",
        upload: {
          filename: "report.csv",
          contentBase64: Buffer.from("date,campaign\n2026-08-18,Search\n").toString("base64"),
        },
        adapterConfig: {
          adapter_config_version: "file-v1",
          source_key: "yandex_direct",
          platform_account_id: "gidrofuril-search",
          column_map: { date: "date", campaign_name: "campaign" },
        },
      },
      { spoolDir, requestedBy: "manager@example.com" },
    );

    assert.equal(result.status, "pending");
    assert.equal(result.requestId, 123);
    assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(result.protectedRef?.startsWith(spoolDir));
    assert.equal(await readFile(result.protectedRef!, "utf8"), "date,campaign\n2026-08-18,Search\n");
    assert.equal((await stat(result.protectedRef!)).mode & 0o777, 0o640);

    const sql = connection.statements.map((statement) => statement.sql).join("\n");
    assert.match(sql, /canonical_advertiser_source_accounts/);
    assert.match(sql, /canonical_ad_import_requests/);
    assert.doesNotMatch(sql, /dashboard_manual_facts_daily/);
    const request = connection.statements.find((statement) =>
      statement.sql.includes("INSERT INTO canonical_ad_import_requests"),
    );
    assert.ok(request);
    assert.doesNotMatch(request!.sql, /adapter_config_sha256/);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
});

test("reviewed Google Sheet request pins its snapshot digest without an artifact path", async () => {
  const connection = new FakeConnection();
  const result = await enqueueCanonicalImport(
    connection,
    {
      advertiserKey: "gidrofuril",
      sourceKey: "yandex_direct",
      platformAccountId: "gidrofuril-search",
      transport: "google_sheet",
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit#gid=0",
      reviewedContent: Buffer.from("date,campaign\n2026-08-18,Search\n"),
      adapterConfig: {
        adapter_config_version: "file-v1",
        source_key: "yandex_direct",
        platform_account_id: "gidrofuril-search",
        column_map: { date: "date", campaign_name: "campaign" },
      },
    },
    { requestedBy: "manager@example.com" },
  );

  assert.equal(result.status, "pending");
  assert.equal(result.protectedRef, null);
  assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
  const request = connection.statements.find((statement) =>
    statement.sql.includes("INSERT INTO canonical_ad_import_requests"),
  );
  assert.ok(request);
  assert.equal(request!.params[4], null);
  assert.equal(request!.params[5], "https://docs.google.com/spreadsheets/d/sheet123/edit#gid=0");
});

test("manual intake resolves to its real canonical platform and reviewed account", () => {
  const reviewed = resolveReviewedAdvertisingSource({
    advertiser_key: "gidrofuril",
    source_key: "yandex_direct",
    platform_account_id: "gidrofuril-search",
  });

  assert.equal(reviewed.platform, "yandex");
  assert.equal(reviewed.schemaFile, "schemas/yandex.yaml");
  assert.equal(reviewed.adapterConfig.source_key, "yandex_direct");
  assert.equal(reviewed.adapterConfig.platform_account_id, "gidrofuril-search");
});
