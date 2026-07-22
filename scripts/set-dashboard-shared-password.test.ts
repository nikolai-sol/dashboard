import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  parseSeedClientId,
  resolveActiveDashboardIdByClientId,
} from "./set-dashboard-shared-password";

test("seed CLI accepts only a client id argument and reads password from fd zero", () => {
  const source = readFileSync(path.resolve("scripts/set-dashboard-shared-password.ts"), "utf8");

  assert.match(source, /readFileSync\(0, "utf8"\)/);
  assert.match(source, /--client-id/);
  assert.doesNotMatch(source, /--password/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*PASSWORD/);
  assert.doesNotMatch(source, /console\.log\([^)]*password/i);
  assert.match(
    source,
    /rotateSharedDashboardPassword\(dashboardId, validation\.password, "production-seed"\)/,
  );
  assert.match(source, /process\.stdout\.write\("Shared dashboard password configured\.\\n"\)/);
});

test("seed CLI permits only Abbott and Zaruku", () => {
  assert.equal(parseSeedClientId(["--client-id", "abbott"]), "abbott");
  assert.equal(parseSeedClientId(["--client-id", "zaruku"]), "zaruku");

  for (const args of [
    [],
    ["--client-id"],
    ["--client-id", "other"],
    ["--client-id", "zaruku", "unexpected"],
    ["--password", "not-allowed"],
  ]) {
    assert.throws(() => parseSeedClientId(args), /Usage: --client-id abbott\|zaruku/);
  }
});

test("seed CLI resolves exactly one active dashboard by canonical client id", async () => {
  let observedSql = "";
  let observedParams: unknown[] | undefined;
  const dashboardId = await resolveActiveDashboardIdByClientId("zaruku", {
    async execute(sql: string, params?: unknown[]) {
      observedSql = sql;
      observedParams = params;
      return [[{ id: 28 }], []];
    },
  });

  assert.equal(dashboardId, 28);
  assert.match(observedSql, /FROM dashboards/);
  assert.match(observedSql, /client_id = \?/);
  assert.match(observedSql, /is_active = TRUE/);
  assert.match(observedSql, /LIMIT 2/);
  assert.deepEqual(observedParams, ["zaruku"]);
});

test("seed CLI fails closed for missing, ambiguous, malformed, or failed dashboard resolution", async () => {
  for (const rows of [[], [{ id: 1 }, { id: 2 }], [{ id: "not-an-id" }]]) {
    await assert.rejects(
      resolveActiveDashboardIdByClientId("abbott", {
        async execute() {
          return [rows, []];
        },
      }),
      { message: "Unable to resolve active dashboard" },
    );
  }

  await assert.rejects(
    resolveActiveDashboardIdByClientId("abbott", {
      async execute() {
        throw new Error("SELECT secret_hash FROM hidden_table");
      },
    }),
    (error: unknown) => {
      assert.equal((error as Error).message, "Unable to resolve active dashboard");
      assert.doesNotMatch((error as Error).message, /SELECT|secret_hash|hidden_table/);
      return true;
    },
  );
});

test("importing the seed module does not run the CLI", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", 'await import("./scripts/set-dashboard-shared-password.ts")'],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      input: "stdin-import-marker",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("invalid CLI paths do not echo argv or stdin", () => {
  const argvMarker = "argv-secret-marker";
  const stdinMarker = "stdin-secret-marker";
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/set-dashboard-shared-password.ts", "--client-id", "other", argvMarker],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      input: stdinMarker,
    },
  );
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, new RegExp(argvMarker));
  assert.doesNotMatch(output, new RegExp(stdinMarker));
  assert.doesNotMatch(output, /SELECT|INSERT|UPDATE|password_hash/i);
});

test("package exposes the reviewed shared-password seed command", () => {
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["access:set-shared-password"],
    "tsx scripts/set-dashboard-shared-password.ts",
  );
});
