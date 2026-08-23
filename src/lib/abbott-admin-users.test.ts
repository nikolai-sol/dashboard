import assert from "node:assert/strict";
import test from "node:test";

import {
  AbbottAdminUsersError,
  addAbbottAdminUserIdsWithExecutor,
  listAbbottAdminUserIdsWithExecutor,
  normalizeAbbottAdminUserId,
  removeAbbottAdminUserIdWithExecutor,
  type AbbottAdminUsersMutationExecutor,
} from "./abbott-admin-users";

class StatefulExecutor implements AbbottAdminUsersMutationExecutor {
  readonly values = new Set<string>();
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  constructor(
    initial: readonly string[] = [],
    private readonly dashboardValid = true,
  ) {
    initial.forEach((value) => this.values.add(value));
  }

  async query(sql: string, params: readonly unknown[]) {
    this.calls.push({ sql, params });
    if (sql.includes("FROM `report_bd`.`dashboards`")) {
      return this.dashboardValid ? [{ id: params[0] }] : [];
    }
    if (sql.includes("COUNT(*) AS configured_count")) {
      return [{ configured_count: this.values.size }];
    }
    if (sql.includes("SELECT raw_user_id")) {
      return [...this.values]
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((raw_user_id) => ({ raw_user_id }));
    }
    throw new Error("unexpected query");
  }

  async execute(sql: string, params: readonly unknown[]) {
    this.calls.push({ sql, params });
    if (sql.startsWith("INSERT IGNORE")) {
      for (let index = 1; index < params.length; index += 2) {
        this.values.add(String(params[index]));
      }
      return;
    }
    if (sql.startsWith("DELETE FROM")) {
      this.values.delete(String(params[1]));
      return;
    }
    throw new Error("unexpected mutation");
  }
}

test("normalizes bounded ASCII decimal IDs without losing leading zeroes", () => {
  assert.equal(normalizeAbbottAdminUserId(" 00900001 "), "00900001");
  assert.equal(normalizeAbbottAdminUserId("0"), "0");
  assert.equal(normalizeAbbottAdminUserId("12.3"), null);
  assert.equal(normalizeAbbottAdminUserId("１２３"), null);
  assert.equal(normalizeAbbottAdminUserId("8".repeat(33)), null);
  assert.equal(normalizeAbbottAdminUserId(900001), null);
});

test("lists IDs only for one active Abbott dashboard in stable order", async () => {
  const executor = new StatefulExecutor(["20", "003", "9"]);

  assert.deepEqual(await listAbbottAdminUserIdsWithExecutor(executor, 7), ["003", "20", "9"]);
  assert.deepEqual(executor.calls[0]?.params, [7, "abbott", "abbott_bi"]);
  assert.match(executor.calls[1]?.sql ?? "", /report_bd_private[\s\S]*portal_abbott_admin_user_exclusions/);
});

test("adds normalized IDs idempotently with placeholders and returns persisted rows", async () => {
  const executor = new StatefulExecutor(["9"]);

  assert.deepEqual(
    await addAbbottAdminUserIdsWithExecutor(executor, 7, [" 002 ", "2", "002", "9"]),
    ["002", "2", "9"],
  );
  const insert = executor.calls.find((call) => call.sql.startsWith("INSERT IGNORE"));
  assert.ok(insert);
  assert.doesNotMatch(insert.sql, /002|\b2\b/);
  assert.deepEqual(insert.params, [7, "002", 7, "2", 7, "9"]);
});

test("removes one normalized ID idempotently", async () => {
  const executor = new StatefulExecutor(["001", "2"]);

  assert.deepEqual(await removeAbbottAdminUserIdWithExecutor(executor, 7, " 001 "), ["2"]);
  assert.deepEqual(await removeAbbottAdminUserIdWithExecutor(executor, 7, "001"), ["2"]);
});

test("rejects malformed, oversized, and non-Abbott operations without mutation", async () => {
  const malformed = new StatefulExecutor();
  await assert.rejects(
    () => addAbbottAdminUserIdsWithExecutor(malformed, 7, ["123", "abc"]),
    (error: unknown) => error instanceof AbbottAdminUsersError && error.code === "INVALID_USER_IDS",
  );
  assert.equal(malformed.calls.length, 0);

  await assert.rejects(
    () => addAbbottAdminUserIdsWithExecutor(new StatefulExecutor(), 7, Array.from({ length: 201 }, (_, index) => String(index))),
    (error: unknown) => error instanceof AbbottAdminUsersError && error.code === "TOO_MANY_USER_IDS",
  );

  const full = new StatefulExecutor(Array.from({ length: 1_000 }, (_, index) => String(index)));
  await assert.rejects(
    () => addAbbottAdminUserIdsWithExecutor(full, 7, ["1001"]),
    (error: unknown) => error instanceof AbbottAdminUsersError && error.code === "TOO_MANY_USER_IDS",
  );
  assert.equal(full.values.has("1001"), false);

  const wrongDashboard = new StatefulExecutor([], false);
  await assert.rejects(
    () => listAbbottAdminUserIdsWithExecutor(wrongDashboard, 7),
    (error: unknown) => error instanceof AbbottAdminUsersError && error.code === "INVALID_DASHBOARD",
  );
});

test("sanitizes unexpected database failures", async () => {
  const executor: AbbottAdminUsersMutationExecutor = {
    async query() {
      throw new Error("secret SQL detail");
    },
    async execute() {
      throw new Error("secret mutation detail");
    },
  };

  await assert.rejects(
    () => listAbbottAdminUserIdsWithExecutor(executor, 7),
    (error: unknown) =>
      error instanceof AbbottAdminUsersError
      && error.code === "PRIVATE_DATA_UNAVAILABLE"
      && !error.message.includes("secret"),
  );
});
