import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./access-auth";
import { createDashboardSharedAccessStore } from "./dashboard-shared-access";

type FakeSetting = {
  password_hash: string;
  credential_version: number;
  updated_at?: string | null;
};

type FakeDatabaseInput = {
  client_id: string;
  setting: FakeSetting | null;
  failOnUpsert?: boolean;
};

function fakeDatabase(input: FakeDatabaseInput) {
  let setting = input.setting;
  const executed: Array<{ sql: string; params: unknown[] }> = [];

  const database = {
    commits: 0,
    rollbacks: 0,
    releases: 0,
    lastPasswordValue: null as string | null,
    executed,
    async execute(sql: string, params: unknown[] = []) {
      return execute(sql, params);
    },
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() {
          database.commits += 1;
        },
        async rollback() {
          database.rollbacks += 1;
        },
        release() {
          database.releases += 1;
        },
      };
    },
  };

  async function execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    executed.push({ sql, params });
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalizedSql.includes("from dashboards d")) {
      return [[{
        client_id: input.client_id,
        password_hash: setting?.password_hash ?? null,
        credential_version: setting?.credential_version ?? null,
        updated_at: setting?.updated_at ?? null,
      }], []];
    }
    if (normalizedSql.includes("from dashboards") && normalizedSql.includes("for update")) {
      return [[{ client_id: input.client_id }], []];
    }
    if (normalizedSql.includes("from dashboard_shared_access_settings")) {
      return [setting ? [{ ...setting }] : [], []];
    }
    if (normalizedSql.startsWith("insert into dashboard_shared_access_settings")) {
      if (input.failOnUpsert) throw new Error("simulated write failure: replacement-password");
      const [, passwordHash, credentialVersion] = params;
      database.lastPasswordValue = String(passwordHash);
      setting = {
        password_hash: String(passwordHash),
        credential_version: Number(credentialVersion),
        updated_at: "2026-07-22 12:00:00",
      };
      return [{ affectedRows: 1 }, []];
    }
    throw new Error("Unexpected fake database query");
  }

  return database;
}

test("Abbott uses version zero env fallback only when the DB row is absent", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({ client_id: "abbott", setting: null }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.deepEqual(await store.verifySharedDashboardPassword(18, " Abbott ", "legacy-password"), {
    credentialVersion: 0,
  });
});

test("a database credential takes authority over the Abbott env fallback", async () => {
  const databasePasswordHash = hashPassword("database-password");
  const store = createDashboardSharedAccessStore(
    fakeDatabase({
      client_id: "abbott",
      setting: { password_hash: databasePasswordHash, credential_version: 7 },
    }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.deepEqual(await store.verifySharedDashboardPassword(18, "abbott", "database-password"), {
    credentialVersion: 7,
  });
  assert.equal(await store.verifySharedDashboardPassword(18, "abbott", "legacy-password"), null);
});

test("Zaruku without a DB row fails closed", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({ client_id: "zaruku", setting: null }),
    { abbottLegacyPassword: "unused" },
  );

  assert.equal(await store.verifySharedDashboardPassword(28, "zaruku", "anything-at-all"), null);
});

test("admin state never returns password material", async () => {
  const database = fakeDatabase({
    client_id: "zaruku",
    setting: {
      password_hash: hashPassword("configured-password"),
      credential_version: 4,
      updated_at: "2026-07-22 10:00:00",
    },
  });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  const state = await store.getSharedPasswordAdminState(28);

  assert.deepEqual(state, {
    supported: true,
    configured: true,
    client_id: "zaruku",
    credential_version: 4,
    updated_at: "2026-07-22 10:00:00",
  });
  assert.equal(JSON.stringify(state).includes("password"), false);
  assert.deepEqual(database.executed[0]?.params, [28]);
});

test("rotation hashes and atomically increments the credential version", async () => {
  const database = fakeDatabase({
    client_id: "zaruku",
    setting: { password_hash: hashPassword("old-password"), credential_version: 4 },
  });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  const state = await store.rotateSharedDashboardPassword(28, "new-password", "admin@example.test");

  assert.equal(state.credential_version, 5);
  assert.equal(database.commits, 1);
  assert.equal(database.rollbacks, 0);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue?.includes("new-password"), false);
  assert.equal(verifyPassword("new-password", database.lastPasswordValue ?? ""), true);
  assert.equal(
    database.executed.filter(({ sql }) => /for\s+update/i.test(sql)).length,
    2,
  );
});

test("rotation rolls back and releases when the write fails", async () => {
  const database = fakeDatabase({ client_id: "abbott", setting: null, failOnUpsert: true });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: "legacy-password" });

  await assert.rejects(store.rotateSharedDashboardPassword(18, "replacement-password", "admin@example.test"), (error) => {
    assert.equal((error as Error).message, "Unable to rotate shared dashboard password");
    assert.equal((error as Error).message.includes("replacement-password"), false);
    return true;
  });
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
});

test("rotation rejects unsupported clients inside the transaction", async () => {
  const database = fakeDatabase({ client_id: "other-client", setting: null });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  await assert.rejects(
    store.rotateSharedDashboardPassword(99, "replacement-password", "admin@example.test"),
    /not supported/i,
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue, null);
});
