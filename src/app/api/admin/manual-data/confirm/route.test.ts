import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSession, ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/access-auth";
import { createManualDataConfirmPostHandler } from "./route";

type QueuedState = {
  discards: number;
  releases: number;
  releaseError?: Error;
};

function confirmedRequest(sourceConfig: Record<string, unknown>) {
  const session = createAdminSession("manager@example.test");
  return new Request("https://dash.test/api/admin/manual-data/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(session)}`,
    },
    body: JSON.stringify({ dashboard_id: 11, source_id: 22, source_config: sourceConfig }),
  });
}

function createConnection(options: { updateError?: Error; commitError?: Error } = {}) {
  const calls = { rollbacks: 0, commits: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async execute(sql: string) {
      if (sql.includes("FROM dashboard_sources")) {
        return [[{
          id: 22,
          dashboard_id: 11,
          platform: "manual_data",
          source_config: "{}",
        }], []];
      }
      if (sql.includes("FROM canonical_advertiser_source_accounts")) {
        return [[{
          advertiser_key: "gidrofuril",
          source_key: "yandex_direct",
          platform_account_id: "gidrofuril-search",
        }], []];
      }
      if (sql.includes("UPDATE dashboard_sources")) {
        if (options.updateError) throw options.updateError;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async commit() {
      calls.commits += 1;
      if (options.commitError) throw options.commitError;
    },
    async rollback() {
      calls.rollbacks += 1;
    },
    release() {
      calls.releases += 1;
    },
  };
  return { connection, calls };
}

function createHandler(connection: ReturnType<typeof createConnection>["connection"], queuedState: QueuedState, captured: { sourceUrl?: string }) {
  return createManualDataConfirmPostHandler({
    pool: { getConnection: async () => connection } as never,
    adminEmail: (request) => verifyAdminSession(
      decodeURIComponent((request.headers.get("cookie") ?? "").split("=")[1] ?? ""),
    )?.email ?? null,
    enqueueCanonicalImport: async (_conn, input) => {
      captured.sourceUrl = input.sourceUrl;
      return {
        requestId: 123,
        status: "pending",
        contentSha256: "a".repeat(64),
        protectedRef: "/private/uploads/generated.bin",
        discardCreatedArtifact: async () => {
          queuedState.discards += 1;
        },
        releaseCreatedArtifact: async () => {
          queuedState.releases += 1;
          if (queuedState.releaseError) throw queuedState.releaseError;
        },
      };
    },
    resolveReviewedAdvertisingSource: () => ({
      advertiserKey: "gidrofuril",
      sourceKey: "yandex_direct",
      platformAccountId: "gidrofuril-search",
      platform: "yandex",
      schemaFile: "schemas/yandex.yaml",
      adapterConfig: {
        adapter_config_version: "file-v1",
        source_key: "yandex_direct",
        platform_account_id: "gidrofuril-search",
      },
    }),
    createSnapshotKey: () => "2166d807-11f8-4e34-a59b-fc9f0c64fe4f",
  });
}

const sheetConfig = { sheet_url: "https://docs.google.com/spreadsheets/d/sheet-id#gid=1" };

test("manual import confirmation passes the raw Google Sheet URL to enqueue", async () => {
  const { connection } = createConnection();
  const queuedState = { discards: 0, releases: 0 };
  const captured: { sourceUrl?: string } = {};
  const POST = createHandler(connection, queuedState, captured);

  const response = await POST(confirmedRequest({ sheet_url: `${sheetConfig.sheet_url} ` }));

  assert.equal(response.status, 200);
  assert.equal(captured.sourceUrl, `${sheetConfig.sheet_url} `);
  assert.equal(queuedState.releases, 1);
});

test("manual import confirmation discards an upload when its source update fails", async () => {
  const { connection, calls } = createConnection({ updateError: new Error("update unavailable") });
  const queuedState = { discards: 0, releases: 0 };
  const POST = createHandler(connection, queuedState, {});

  const response = await POST(confirmedRequest(sheetConfig));

  assert.equal(response.status, 500);
  assert.equal(calls.rollbacks, 1);
  assert.equal(queuedState.discards, 1);
  assert.equal(queuedState.releases, 0);
});

test("manual import confirmation releases without deleting when commit outcome is unknown", async () => {
  const { connection, calls } = createConnection({ commitError: new Error("commit connection reset") });
  const queuedState = { discards: 0, releases: 0 };
  const POST = createHandler(connection, queuedState, {});

  const response = await POST(confirmedRequest(sheetConfig));

  assert.equal(response.status, 500);
  assert.equal(calls.rollbacks, 1);
  assert.equal(queuedState.discards, 0);
  assert.equal(queuedState.releases, 1);
});

test("manual import confirmation releases ownership only after commit", async () => {
  const { connection, calls } = createConnection();
  const queuedState = { discards: 0, releases: 0 };
  const POST = createHandler(connection, queuedState, {});

  const response = await POST(confirmedRequest(sheetConfig));

  assert.equal(response.status, 200);
  assert.equal(calls.commits, 1);
  assert.equal(queuedState.discards, 0);
  assert.equal(queuedState.releases, 1);
});

test("manual import confirmation never deletes a committed artifact when release fails", async () => {
  const { connection, calls } = createConnection();
  const queuedState = { discards: 0, releases: 0, releaseError: new Error("close failed") };
  const POST = createHandler(connection, queuedState, {});

  const response = await POST(confirmedRequest(sheetConfig));

  assert.equal(response.status, 500);
  assert.equal(calls.rollbacks, 0);
  assert.equal(queuedState.discards, 0);
  assert.equal(queuedState.releases, 1);
});
