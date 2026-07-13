import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCtr,
  completedIsoWeekBefore,
  discoverHostId,
  normalizePopularQueryRows,
  refreshYandexToken,
  replaceWeekRowsTransaction,
} from "../scripts/collect-yandex-webmaster";

test("completedIsoWeekBefore returns the previous completed Monday-Sunday week", () => {
  assert.deepEqual(completedIsoWeekBefore(new Date("2026-07-13T09:00:00.000Z")), {
    weekKey: "2026-W28",
    from: "2026-07-06",
    to: "2026-07-12",
  });
});

test("discoverHostId resolves one exact zaruku host and rejects ambiguity", async () => {
  const hostId = await discoverHostId("zaruku.ru", async () => ({
    hosts: [{ host_id: "https:zaruku.ru:443", ascii_host_url: "https://zaruku.ru/" }],
  }));

  assert.equal(hostId, "https:zaruku.ru:443");
  await assert.rejects(
    () =>
      discoverHostId("zaruku.ru", async () => ({
        hosts: [
          { host_id: "a", ascii_host_url: "https://zaruku.ru/" },
          { host_id: "b", ascii_host_url: "http://zaruku.ru/" },
        ],
      })),
    /Ambiguous/,
  );
});

test("refreshYandexToken writes access and refresh token state without returning secrets in errors", async () => {
  const written: unknown[] = [];
  const result = await refreshYandexToken(
    { clientId: "id", clientSecret: "secret", refreshToken: "refresh", tokenStatePath: "/tmp/state.json" },
    async () => ({ access_token: "access2", refresh_token: "refresh2", expires_in: 3600 }),
    async (path, value) => {
      written.push({ path, value });
    },
  );

  assert.equal(result.accessToken, "access2");
  assert.equal(result.refreshToken, "refresh2");
  assert.equal(written.length, 1);
  assert.deepEqual(written[0], {
    path: "/tmp/state.json",
    value: {
      access_token: "access2",
      refresh_token: "refresh2",
      expires_at: result.expiresAt,
    },
  });
});

test("normalizePopularQueryRows extracts Webmaster indicators", () => {
  assert.deepEqual(
    normalizePopularQueryRows(
      {
        queries: [
          {
            query_id: "q1",
            query_text: "за руку помощь",
            indicators: { TOTAL_SHOWS: 100, TOTAL_CLICKS: 7, AVG_SHOW_POSITION: 3.5 },
          },
        ],
        date_from: "2026-07-06",
        date_to: "2026-07-12",
      },
      "ALL",
    ),
    [
      {
        queryId: "q1",
        queryText: "за руку помощь",
        device: "ALL",
        impressions: 100,
        clicks: 7,
        ctr: 7,
        averagePosition: 3.5,
        raw: {
          query_id: "q1",
          query_text: "за руку помощь",
          indicators: { TOTAL_SHOWS: 100, TOTAL_CLICKS: 7, AVG_SHOW_POSITION: 3.5 },
        },
      },
    ],
  );
});

test("calculateCtr returns null when impressions are zero", () => {
  assert.equal(calculateCtr(0, 10), null);
  assert.equal(calculateCtr(200, 5), 2.5);
});

test("replaceWeekRowsTransaction deletes then inserts in one transaction", async () => {
  const calls: string[] = [];
  const conn = {
    beginTransaction: async () => calls.push("begin"),
    execute: async (sql: string) => calls.push(sql.trim().split(/\s+/, 2).join(" ")),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    release: () => calls.push("release"),
  };

  await replaceWeekRowsTransaction(conn, {
    accountId: "66624469",
    hostId: "host",
    weekKey: "2026-W28",
    weekFrom: "2026-07-06",
    weekTo: "2026-07-12",
    device: "ALL",
    runId: 7,
    queryRows: [],
    pageRows: [],
  });

  assert.deepEqual(calls, ["begin", "DELETE FROM", "DELETE FROM", "commit", "release"]);
});
