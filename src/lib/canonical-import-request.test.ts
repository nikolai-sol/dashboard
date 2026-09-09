import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enqueueCanonicalImport } from "./canonical-import-request";
import { resolveReviewedAdvertisingSource } from "./admin-dashboards";

class FakeConnection {
  readonly statements: Array<{ sql: string; params: Array<string | number | boolean | null | Buffer> }> = [];
  readonly persisted: {
    id: number;
    status: "pending" | "processing" | "retryable" | "published" | "rejected" | "failed";
    content_sha256: string | null;
    protected_ref: string | null;
    sheet_snapshot_key: string | null;
  } = {
    id: 123,
    status: "pending",
    content_sha256: "a".repeat(64),
    protected_ref: null as string | null,
    sheet_snapshot_key: null as string | null,
  };
  onInsert: ((params: Array<string | number | boolean | null | Buffer>) => Promise<void>) | null = null;

  async execute(sql: string, params: Array<string | number | boolean | null | Buffer> = []) {
    this.statements.push({ sql, params });
    if (sql.includes("INSERT INTO canonical_ad_import_requests")) {
      if (this.persisted.status === "pending") {
        this.persisted.protected_ref = typeof params[4] === "string" ? params[4] : null;
        this.persisted.content_sha256 = typeof params[7] === "string" ? params[7] : null;
        this.persisted.sheet_snapshot_key = typeof params[8] === "string" ? params[8] : null;
      }
      await this.onInsert?.(params);
      return [{ insertId: 123 }];
    }
    if (sql.includes("FROM canonical_ad_import_requests") && sql.includes("LAST_INSERT_ID")) {
      return [[this.persisted]];
    }
    return [{}];
  }
}

test("confirmed upload writes a protected artifact and queues a canonical import", { skip: process.platform !== "linux" }, async () => {
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
    assert.match(result.contentSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(result.protectedRef ?? "", /\/uploads\/[0-9a-f-]+\.bin$/);
    assert.equal(await readFile(result.protectedRef!, "utf8"), "date,campaign\n2026-08-18,Search\n");
    assert.equal((await stat(result.protectedRef!)).mode & 0o777, 0o640);
    await result.releaseCreatedArtifact();
    assert.equal(await readFile(result.protectedRef!, "utf8"), "date,campaign\n2026-08-18,Search\n");

    const sql = connection.statements.map((statement) => statement.sql).join("\n");
    assert.doesNotMatch(sql, /INSERT INTO canonical_advertiser_source_accounts/);
    assert.doesNotMatch(sql, /INSERT INTO canonical_source_accounts/);
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

test("configured spool roots may not be symlinks", { skip: process.platform !== "linux" }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "canonical-import-parent-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "canonical-import-external-"));
  const spoolDir = path.join(parent, "spool");
  try {
    await symlink(external, spoolDir);
    await assert.rejects(
      enqueueCanonicalImport(
        new FakeConnection(),
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
          },
        },
        { spoolDir },
      ),
      /Protected spool path (?:may not contain symlinks|must be a directory)/,
    );
    assert.equal(existsSync(path.join(external, "uploads")), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("configured spool paths may not contain symlinked ancestors", { skip: process.platform !== "linux" }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "canonical-import-parent-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "canonical-import-external-"));
  const spoolDir = path.join(parent, "redirect", "spool");
  try {
    await symlink(external, path.join(parent, "redirect"));
    await assert.rejects(
      enqueueCanonicalImport(
        new FakeConnection(),
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
          },
        },
        { spoolDir },
      ),
      /Protected spool path (?:may not contain symlinks|must be a directory)/,
    );
    assert.equal(existsSync(path.join(external, "spool", "uploads")), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("configured spool paths reject traversal before descriptor validation", { skip: process.platform !== "linux" }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "canonical-import-parent-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "canonical-import-external-"));
  const spoolDir = `${parent}/redirect/../spool`;
  try {
    await symlink(external, path.join(parent, "redirect"));
    await assert.rejects(
      enqueueCanonicalImport(
        new FakeConnection(),
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
          },
        },
        { spoolDir },
      ),
      /Protected spool path may not contain traversal components/,
    );
    assert.equal(existsSync(path.join(parent, "spool", "uploads")), false);
    assert.equal(existsSync(path.join(external, "spool", "uploads")), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("configured uploads directories may not be symlinks", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "canonical-import-external-"));
  try {
    await symlink(external, path.join(spoolDir, "uploads"));
    await assert.rejects(
      enqueueCanonicalImport(
        new FakeConnection(),
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
          },
        },
        { spoolDir },
      ),
      /Protected spool path (?:may not contain symlinks|must be a directory)/,
    );
    assert.equal(existsSync(path.join(external, "uploads")), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("Google Sheet confirmation queues a collector-owned snapshot intent without fetching content", async () => {
  const connection = new FakeConnection();
  const result = await enqueueCanonicalImport(
    connection,
    {
      advertiserKey: "gidrofuril",
      sourceKey: "yandex_direct",
      platformAccountId: "gidrofuril-search",
      transport: "google_sheet",
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit#gid=0",
      sheetSnapshotKey: "2166d807-11f8-4e34-a59b-fc9f0c64fe4f",
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
  assert.equal(result.contentSha256, null);
  const request = connection.statements.find((statement) =>
    statement.sql.includes("INSERT INTO canonical_ad_import_requests"),
  );
  assert.ok(request);
  assert.equal(request!.params[4], null);
  assert.equal(request!.params[5], "https://docs.google.com/spreadsheets/d/sheet123#gid=0");
  assert.equal(request!.params[7], null);
  assert.equal(request!.params[8], "2166d807-11f8-4e34-a59b-fc9f0c64fe4f");
});

test("Google Sheet confirmation matches the collector reviewed-reference contract", async () => {
  const cases: Array<{ sourceUrl: string; reviewedReference?: string }> = [
    {
      sourceUrl: "HTTPS://DOCS.GOOGLE.COM/spreadsheets/d/Sheet_42-foo/edit#gid=00042",
      reviewedReference: "https://docs.google.com/spreadsheets/d/Sheet_42-foo#gid=42",
    },
    {
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id",
      reviewedReference: "https://docs.google.com/spreadsheets/d/sheet-id#gid=0",
    },
    {
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id?gid=00091",
      reviewedReference: "https://docs.google.com/spreadsheets/d/sheet-id#gid=91",
    },
    {
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit?g%69d=%30%30%30%34%32&ignored=x%26gid%3D7",
      reviewedReference: "https://docs.google.com/spreadsheets/d/sheet-id#gid=42",
    },
    {
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id/../../another-path#gid=7",
      reviewedReference: "https://docs.google.com/spreadsheets/d/sheet-id#gid=7",
    },
    { sourceUrl: " https://docs.google.com/spreadsheets/d/sheet-id#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id#gid=1 " },
    { sourceUrl: "http://docs.google.com/spreadsheets/d/sheet-id#gid=1" },
    { sourceUrl: "https://docs.google.com:443/spreadsheets/d/sheet-id#gid=1" },
    { sourceUrl: "https://reader@docs.google.com/spreadsheets/d/sheet-id#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/u/0/d/sheet-id#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id#gid=not-a-number" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id?gid=1#gid=2" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id?gid=1&gid=2" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id#gid=1&gid=2" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id?g%69d=1#gid=2" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id%2Ftrailer#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id.any#gid=1" },
    { sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-id;foo#gid=1" },
    { sourceUrl: "https://docs%2egoogle.com/spreadsheets/d/sheet-id#gid=1" },
  ];

  for (const { sourceUrl, reviewedReference } of cases) {
    const connection = new FakeConnection();
    const enqueue = enqueueCanonicalImport(
      connection,
      {
        advertiserKey: "gidrofuril",
        sourceKey: "yandex_direct",
        platformAccountId: "gidrofuril-search",
        transport: "google_sheet",
        sourceUrl,
        sheetSnapshotKey: "2166d807-11f8-4e34-a59b-fc9f0c64fe4f",
        adapterConfig: {
          adapter_config_version: "file-v1",
          source_key: "yandex_direct",
          platform_account_id: "gidrofuril-search",
        },
      },
    );

    if (!reviewedReference) {
      await assert.rejects(enqueue, /source_url must be a Google Sheets URL/, sourceUrl);
      continue;
    }

    await enqueue;
    const request = connection.statements.find((statement) =>
      statement.sql.includes("INSERT INTO canonical_ad_import_requests"),
    );
    assert.ok(request, sourceUrl);
    assert.equal(request.params[5], reviewedReference, sourceUrl);
  }
});

test("upload confirmation fails closed where descriptor-anchored writes are unavailable", { skip: process.platform === "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  try {
    await assert.rejects(
      enqueueCanonicalImport(
        new FakeConnection(),
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
          },
        },
        { spoolDir },
      ),
      /descriptor-anchored writes are only supported on Linux/,
    );
    assert.equal(existsSync(path.join(spoolDir, "uploads")), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
});

test("duplicate uploads remove their newly spooled artifact and return the persisted request", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  try {
    const connection = new FakeConnection();
    connection.persisted.status = "retryable";
    connection.persisted.protected_ref = "/private/existing-report.csv";
    connection.persisted.content_sha256 = "b".repeat(64);
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

    assert.equal(result.status, "retryable");
    assert.equal(result.protectedRef, "/private/existing-report.csv");
    assert.equal(existsSync(path.join(spoolDir, "uploads")), true);
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(path.join(spoolDir, "uploads")), []);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
});

test("upload insert errors remove their newly spooled artifact", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  let protectedRef = "";
  try {
    const connection = new FakeConnection();
    connection.onInsert = async (params) => {
      protectedRef = String(params[4]);
      throw new Error("database unavailable");
    };

    await assert.rejects(
      enqueueCanonicalImport(
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
          },
        },
        { spoolDir },
      ),
      /database unavailable/,
    );
    assert.match(protectedRef, /\/uploads\/[0-9a-f-]+\.bin$/);
    assert.equal(existsSync(protectedRef), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
});

test("duplicate cleanup remains descriptor-anchored after the spool path is replaced", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  const movedSpoolDir = `${spoolDir}-moved`;
  const external = await mkdtemp(path.join(os.tmpdir(), "canonical-import-external-"));
  let sentinel = "";
  try {
    const connection = new FakeConnection();
    connection.persisted.status = "retryable";
    connection.persisted.protected_ref = "/private/existing-report.csv";
    connection.persisted.content_sha256 = "b".repeat(64);
    connection.onInsert = async (params) => {
      await rename(spoolDir, movedSpoolDir);
      await mkdir(path.join(external, "uploads"));
      sentinel = path.join(external, "uploads", path.basename(String(params[4])));
      await writeFile(sentinel, "do-not-remove");
      await symlink(external, spoolDir);
    };

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
        },
      },
      { spoolDir },
    );
    const originalArtifact = path.join(movedSpoolDir, "uploads", path.basename(sentinel));
    assert.equal(result.status, "retryable");
    assert.equal(await readFile(sentinel, "utf8"), "do-not-remove");
    assert.equal(existsSync(originalArtifact), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
    await rm(movedSpoolDir, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("duplicate cleanup removes the original artifact through its retained descriptor after spool replacement", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  const movedSpoolDir = `${spoolDir}-moved`;
  let sentinel = "";
  try {
    const connection = new FakeConnection();
    connection.persisted.status = "retryable";
    connection.persisted.protected_ref = "/private/existing-report.csv";
    connection.persisted.content_sha256 = "b".repeat(64);
    connection.onInsert = async (params) => {
      await rename(spoolDir, movedSpoolDir);
      await mkdir(path.join(spoolDir, "uploads"), { recursive: true });
      sentinel = path.join(spoolDir, "uploads", path.basename(String(params[4])));
      await writeFile(sentinel, "do-not-remove");
    };

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
        },
      },
      { spoolDir },
    );
    const originalArtifact = path.join(movedSpoolDir, "uploads", path.basename(sentinel));
    assert.equal(result.status, "retryable");
    assert.equal(await readFile(sentinel, "utf8"), "do-not-remove");
    assert.equal(existsSync(originalArtifact), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
    await rm(movedSpoolDir, { recursive: true, force: true });
  }
});

test("upload insert errors remove the original artifact through its retained descriptor after spool replacement", { skip: process.platform !== "linux" }, async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "canonical-import-"));
  const movedSpoolDir = `${spoolDir}-moved`;
  let sentinel = "";
  let originalArtifact = "";
  try {
    const connection = new FakeConnection();
    connection.onInsert = async (params) => {
      await rename(spoolDir, movedSpoolDir);
      await mkdir(path.join(spoolDir, "uploads"), { recursive: true });
      sentinel = path.join(spoolDir, "uploads", path.basename(String(params[4])));
      originalArtifact = path.join(movedSpoolDir, "uploads", path.basename(String(params[4])));
      await writeFile(sentinel, "do-not-remove");
      throw new Error("database unavailable");
    };

    await assert.rejects(
      enqueueCanonicalImport(
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
          },
        },
        { spoolDir },
      ),
      /database unavailable/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "do-not-remove");
    assert.equal(existsSync(originalArtifact), false);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
    await rm(movedSpoolDir, { recursive: true, force: true });
  }
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

test("manual intake rejects browser-supplied adapter configuration", () => {
  assert.throws(
    () => resolveReviewedAdvertisingSource({
      advertiser_key: "gidrofuril",
      source_key: "yandex_direct",
      platform_account_id: "gidrofuril-search",
      adapter_config: { adapter_config_version: "unreviewed-v99" },
    }),
    /adapter_config is derived/,
  );
});
