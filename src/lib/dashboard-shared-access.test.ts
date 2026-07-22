import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashPassword, verifyPassword } from "./access-auth";
import {
  createDashboardSharedAccessStore,
  SharedPasswordRotationError,
} from "./dashboard-shared-access";

type FakeSetting = {
  password_hash: string;
  credential_version: unknown;
  updated_at?: string | null;
};

type FakeDatabaseInput = {
  client_id: string | null;
  is_active?: boolean;
  setting: FakeSetting | null;
  failOnUpsert?: boolean;
  failAfterUpsert?: boolean;
};

function fakeDatabase(input: FakeDatabaseInput) {
  let setting = input.setting;
  let lockHolder: FakeConnectionState | null = null;
  const lockWaiters: Array<{ connection: FakeConnectionState; resolve: () => void }> = [];
  const executed: Array<{ sql: string; params: unknown[] }> = [];

  type FakeConnectionState = {
    hasStagedSetting: boolean;
    stagedSetting: FakeSetting | null;
  };

  const database = {
    commits: 0,
    rollbacks: 0,
    releases: 0,
    lastPasswordValue: null as string | null,
    executed,
    get setting() {
      return setting;
    },
    async execute(sql: string, params: unknown[] = []) {
      return executeQuery(null, sql, params);
    },
    async getConnection() {
      const state: FakeConnectionState = {
        hasStagedSetting: false,
        stagedSetting: null,
      };
      return {
        execute(sql: string, params: unknown[] = []) {
          return executeQuery(state, sql, params);
        },
        async beginTransaction() {},
        async commit() {
          if (state.hasStagedSetting) setting = state.stagedSetting;
          database.commits += 1;
          releaseLock(state);
        },
        async rollback() {
          database.rollbacks += 1;
          state.hasStagedSetting = false;
          state.stagedSetting = null;
          releaseLock(state);
        },
        release() {
          database.releases += 1;
          releaseLock(state);
        },
      };
    },
  };

  async function acquireLock(connection: FakeConnectionState) {
    if (lockHolder === connection) return;
    if (!lockHolder) {
      lockHolder = connection;
      return;
    }
    await new Promise<void>((resolve) => {
      lockWaiters.push({ connection, resolve });
    });
  }

  function releaseLock(connection: FakeConnectionState) {
    if (lockHolder !== connection) return;
    lockHolder = null;
    const next = lockWaiters.shift();
    if (next) {
      lockHolder = next.connection;
      next.resolve();
    }
  }

  async function executeQuery(
    connection: FakeConnectionState | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<[unknown, unknown]> {
    executed.push({ sql, params });
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toLowerCase();
    const visibleSetting = connection?.hasStagedSetting ? connection.stagedSetting : setting;

    if (normalizedSql.includes("from dashboards d")) {
      if (input.client_id === null) return [[], []];
      return [[{
        client_id: input.client_id,
        password_hash: visibleSetting?.password_hash ?? null,
        credential_version: visibleSetting?.credential_version ?? null,
        updated_at: visibleSetting?.updated_at ?? null,
      }], []];
    }
    if (normalizedSql.includes("from dashboards") && normalizedSql.includes("for update")) {
      if (!connection) throw new Error("Lock query requires a connection");
      await acquireLock(connection);
      if (input.client_id === null || input.is_active === false) return [[], []];
      return [[{ client_id: input.client_id }], []];
    }
    if (normalizedSql.includes("from dashboard_shared_access_settings")) {
      if (input.failAfterUpsert && connection?.hasStagedSetting) {
        input.failAfterUpsert = false;
        throw new Error("simulated read failure after staged write");
      }
      return [visibleSetting ? [{ ...visibleSetting }] : [], []];
    }
    if (normalizedSql.startsWith("insert into dashboard_shared_access_settings")) {
      if (!connection) throw new Error("Write query requires a connection");
      if (input.failOnUpsert) throw new Error("simulated write failure: replacement-password");
      const [, passwordHash, credentialVersion] = params;
      database.lastPasswordValue = String(passwordHash);
      connection.stagedSetting = {
        password_hash: String(passwordHash),
        credential_version: credentialVersion,
        updated_at: "2026-07-22 12:00:00",
      };
      connection.hasStagedSetting = true;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error("Unexpected fake database query");
  }

  return database;
}

test("credential reads reject an unsupported authoritative dashboard even when settings exist", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({
      client_id: "unsupported-client",
      setting: { password_hash: hashPassword("stored-password"), credential_version: 3 },
    }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.equal(await store.verifySharedDashboardPassword(99, "abbott", "stored-password"), null);
});

test("a rowless non-Abbott dashboard cannot gain the Abbott fallback from the caller", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({ client_id: "zaruku", setting: null }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.equal(await store.verifySharedDashboardPassword(28, "abbott", "legacy-password"), null);
});

test("credential reads reject mismatched supported dashboard and caller client IDs", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({
      client_id: "zaruku",
      setting: { password_hash: hashPassword("stored-password"), credential_version: 2 },
    }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.equal(await store.verifySharedDashboardPassword(28, "abbott", "stored-password"), null);
});

for (const [label, credentialVersion] of [
  ["negative", -1],
  ["zero", 0],
  ["fractional", 1.5],
  ["null", null],
  ["non-numeric", "corrupt"],
  ["unsafe", Number.MAX_SAFE_INTEGER + 1],
] as const) {
  test(`credential reads reject the ${label} database version with a sanitized error`, async () => {
    const store = createDashboardSharedAccessStore(
      fakeDatabase({
        client_id: "zaruku",
        setting: { password_hash: hashPassword("stored-password"), credential_version: credentialVersion },
      }),
      { abbottLegacyPassword: null },
    );

    await assert.rejects(store.loadSharedPasswordCredential(28, "zaruku"), (error) => {
      assert.equal((error as Error).message, "Unable to load shared dashboard credential");
      assert.equal((error as Error).message.includes(String(credentialVersion)), false);
      return true;
    });
  });
}

test("admin state rejects a corrupt database version with a sanitized error", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({
      client_id: "zaruku",
      setting: { password_hash: hashPassword("stored-password"), credential_version: 0 },
    }),
    { abbottLegacyPassword: null },
  );

  await assert.rejects(store.getSharedPasswordAdminState(28), {
    message: "Unable to load shared dashboard password state",
  });
});

for (const [label, credentialVersion] of [
  ["corrupt zero", 0],
  ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ["overflowing", Number.MAX_SAFE_INTEGER],
] as const) {
  test(`rotation rejects the ${label} existing version without writing`, async () => {
    const database = fakeDatabase({
      client_id: "zaruku",
      setting: { password_hash: hashPassword("stored-password"), credential_version: credentialVersion },
    });
    const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

    await assert.rejects(
      store.rotateSharedDashboardPassword(28, "replacement-password", "admin@example.test"),
      { message: "Unable to rotate shared dashboard password" },
    );
    assert.equal(database.commits, 0);
    assert.equal(database.rollbacks, 1);
    assert.equal(database.releases, 1);
    assert.equal(database.lastPasswordValue, null);
  });
}

test("legacy fallback compares fixed-length cryptographic digests", () => {
  const source = readFileSync(new URL("./dashboard-shared-access.ts", import.meta.url), "utf8");

  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /timingSafeEqual\(leftDigest, rightDigest\)/);
  assert.doesNotMatch(source, /leftBuffer\.length\s*!==\s*rightBuffer\.length/);
});

test("Abbott uses version zero env fallback only when the DB row is absent", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({ client_id: "abbott", setting: null }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.deepEqual(await store.verifySharedDashboardPassword(18, " Abbott ", "legacy-password"), {
    credentialVersion: 0,
  });
});

test("rowless Abbott fallback authenticates but admin state remains not migrated", async () => {
  const store = createDashboardSharedAccessStore(
    fakeDatabase({ client_id: "abbott", setting: null }),
    { abbottLegacyPassword: "legacy-password" },
  );

  assert.deepEqual(await store.verifySharedDashboardPassword(18, "abbott", "legacy-password"), {
    credentialVersion: 0,
  });
  assert.deepEqual(await store.getSharedPasswordAdminState(18), {
    supported: true,
    configured: false,
    client_id: "abbott",
    credential_version: 0,
    updated_at: null,
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

test("rotation rollback discards a staged upsert when a later query fails", async () => {
  const database = fakeDatabase({
    client_id: "zaruku",
    setting: { password_hash: hashPassword("stored-password"), credential_version: 4 },
    failAfterUpsert: true,
  });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  await assert.rejects(
    store.rotateSharedDashboardPassword(28, "replacement-password", "admin@example.test"),
    { message: "Unable to rotate shared dashboard password" },
  );

  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.setting?.credential_version, 4);
  assert.deepEqual(await store.verifySharedDashboardPassword(28, "zaruku", "stored-password"), {
    credentialVersion: 4,
  });
  assert.equal(
    await store.verifySharedDashboardPassword(28, "zaruku", "replacement-password"),
    null,
  );
});

test("concurrent first rotations serialize to versions one then two", async () => {
  const database = fakeDatabase({ client_id: "zaruku", setting: null });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  const states = await Promise.all([
    store.rotateSharedDashboardPassword(28, "first-replacement-password", "first@example.test"),
    store.rotateSharedDashboardPassword(28, "second-replacement-password", "second@example.test"),
  ]);

  assert.deepEqual(states.map((state) => state.credential_version).sort((a, b) => a - b), [1, 2]);
  assert.equal(database.setting?.credential_version, 2);
  assert.equal(database.commits, 2);
  assert.equal(database.rollbacks, 0);
  assert.equal(database.releases, 2);
});

test("rotation rejects unsupported clients inside the transaction", async () => {
  const database = fakeDatabase({ client_id: "other-client", setting: null });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  await assert.rejects(
    store.rotateSharedDashboardPassword(99, "replacement-password", "admin@example.test"),
    (error) => {
      assert.equal(error instanceof SharedPasswordRotationError, true);
      assert.equal(
        (error as SharedPasswordRotationError).code,
        "UNSUPPORTED_DASHBOARD",
      );
      return true;
    },
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue, null);
});

test("rotation reports a transaction-authoritative missing dashboard", async () => {
  const database = fakeDatabase({ client_id: null, setting: null });
  const store = createDashboardSharedAccessStore(database, {
    abbottLegacyPassword: null,
  });

  await assert.rejects(
    store.rotateSharedDashboardPassword(
      404,
      "replacement-password",
      "admin@example.test",
    ),
    (error) => {
      assert.equal(error instanceof SharedPasswordRotationError, true);
      assert.equal(
        (error as SharedPasswordRotationError).code,
        "DASHBOARD_NOT_FOUND",
      );
      return true;
    },
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue, null);
});

test("seed rotation rejects a dashboard deactivated after active-ID resolution", async () => {
  const input: FakeDatabaseInput = {
    client_id: "zaruku",
    is_active: true,
    setting: null,
  };
  const database = fakeDatabase(input);
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  input.is_active = false;
  await assert.rejects(
    store.rotateSharedDashboardPassword(28, "replacement-password", "production-seed", "zaruku"),
    (error) => {
      assert.equal(error instanceof SharedPasswordRotationError, true);
      assert.equal((error as SharedPasswordRotationError).code, "DASHBOARD_NOT_FOUND");
      return true;
    },
  );

  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue, null);
  assert.match(database.executed[0]?.sql ?? "", /is_active\s*=\s*TRUE/i);
});

test("seed rotation rejects a client reassigned after active-ID resolution", async () => {
  const input: FakeDatabaseInput = { client_id: "zaruku", setting: null };
  const database = fakeDatabase(input);
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  input.client_id = "abbott";
  await assert.rejects(
    store.rotateSharedDashboardPassword(28, "replacement-password", "production-seed", "zaruku"),
    (error) => {
      assert.equal(error instanceof SharedPasswordRotationError, true);
      assert.equal((error as SharedPasswordRotationError).code, "UNSUPPORTED_DASHBOARD");
      return true;
    },
  );

  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(database.lastPasswordValue, null);
});

test("admin rotation remains limited to active supported dashboards", async () => {
  const database = fakeDatabase({ client_id: "zaruku", is_active: false, setting: null });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });

  await assert.rejects(
    store.rotateSharedDashboardPassword(28, "replacement-password", "admin@example.test"),
    (error) => {
      assert.equal(error instanceof SharedPasswordRotationError, true);
      assert.equal((error as SharedPasswordRotationError).code, "DASHBOARD_NOT_FOUND");
      return true;
    },
  );
  assert.equal(database.lastPasswordValue, null);
  assert.match(database.executed[0]?.sql ?? "", /is_active\s*=\s*TRUE/i);
});
