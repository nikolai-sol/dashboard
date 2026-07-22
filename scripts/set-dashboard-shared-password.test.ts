import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
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
    /rotateSharedDashboardPassword\(dashboardId, validation\.password, "production-seed", clientId\)/,
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
    ["--client-id", "ABBOTT"],
    ["--client-id", " zaruku "],
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
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "shared-password-seed-import-"));
  try {
    const { closeMarkerPath, preloadPath } = createFakePoolPreload(tempDirectory);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preloadPath,
        "--input-type=module",
        "--eval",
        'await import("./scripts/set-dashboard-shared-password.ts")',
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        input: "stdin-import-marker",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(existsSync(closeMarkerPath), false);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

function createFakePoolPreload(tempDirectory: string, endError: string | null = null) {
  const closeMarkerPath = path.join(tempDirectory, "pool-close.log");
  const preloadPath = path.join(tempDirectory, "fake-pool.mjs");
  writeFileSync(
    preloadPath,
    `import { appendFileSync } from "node:fs";
globalThis.__dashboardMysqlPool = {
  async execute(sql) {
    if (/FROM dashboards/i.test(sql)) return [[{ id: 28 }], []];
    throw new Error("unexpected pool query");
  },
  async getConnection() {
    return {
      async beginTransaction() {},
      async execute(sql) {
        const normalized = sql.replace(/\\s+/g, " ").trim().toLowerCase();
        if (normalized.includes("from dashboards") && normalized.includes("for update")) {
          return [[{ client_id: "zaruku" }], []];
        }
        if (normalized.includes("from dashboard_shared_access_settings")) return [[], []];
        if (normalized.startsWith("insert into dashboard_shared_access_settings")) {
          return [{ affectedRows: 1 }, []];
        }
        throw new Error("unexpected connection query");
      },
      async commit() {},
      async rollback() {},
      release() {},
    };
  },
  async end() {
    appendFileSync(${JSON.stringify(closeMarkerPath)}, "closed\\n");
    ${endError === null ? "" : `throw new Error(${JSON.stringify(endError)});`}
  },
};
`,
    { mode: 0o600 },
  );
  return { closeMarkerPath, preloadPath };
}

test("successful entrypoint closes its module-level pool exactly once and exits", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "shared-password-seed-success-"));
  try {
    const { closeMarkerPath, preloadPath } = createFakePoolPreload(tempDirectory);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preloadPath,
        "scripts/set-dashboard-shared-password.ts",
        "--client-id",
        "zaruku",
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        input: "valid-seed-value",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Shared dashboard password configured.\n");
    assert.equal(result.stderr, "");
    assert.equal(readFileSync(closeMarkerPath, "utf8"), "closed\n");
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("failed entrypoint closes its module-level pool exactly once", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "shared-password-seed-failure-"));
  try {
    const { closeMarkerPath, preloadPath } = createFakePoolPreload(tempDirectory);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preloadPath,
        "scripts/set-dashboard-shared-password.ts",
        "--client-id",
        "other",
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        input: "stdin-failure-marker",
      },
    );

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Unable to configure shared dashboard password.\n");
    assert.equal(readFileSync(closeMarkerPath, "utf8"), "closed\n");
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("a pool close failure suppresses success and emits one sanitized failure", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "shared-password-seed-close-failure-"));
  const closeErrorMarker = "pool-close-error-details";
  const stdinMarker = "stdin-secret-close-marker";
  try {
    const { closeMarkerPath, preloadPath } = createFakePoolPreload(
      tempDirectory,
      closeErrorMarker,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        preloadPath,
        "scripts/set-dashboard-shared-password.ts",
        "--client-id",
        "zaruku",
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        input: stdinMarker,
      },
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Unable to configure shared dashboard password.\n");
    assert.equal(readFileSync(closeMarkerPath, "utf8"), "closed\n");
    assert.doesNotMatch(output, new RegExp(stdinMarker));
    assert.doesNotMatch(output, new RegExp(closeErrorMarker));
    assert.doesNotMatch(output, /zaruku|SELECT|INSERT|UPDATE|password_hash/i);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("a symlinked seed entrypoint executes instead of silently importing", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "shared-password-seed-link-"));
  try {
    const symlinkPath = path.join(tempDirectory, "seed-link.ts");
    symlinkSync(path.resolve("scripts/set-dashboard-shared-password.ts"), symlinkPath);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", symlinkPath, "--client-id", "zaruku"],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        input: "short",
      },
    );

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Unable to configure shared dashboard password.\n");
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
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

test("silent npm invocation never echoes rejected client arguments or stdin", () => {
  const clientMarker = "rejected-client-marker";
  const stdinMarker = "stdin-secret-marker";
  const result = spawnSync(
    "npm",
    [
      "--silent",
      "run",
      "access:set-shared-password",
      "--",
      "--client-id",
      "zaruku",
      clientMarker,
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      input: stdinMarker,
    },
  );
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Unable to configure shared dashboard password.\n");
  assert.doesNotMatch(output, new RegExp(clientMarker));
  assert.doesNotMatch(output, /zaruku/);
  assert.doesNotMatch(output, new RegExp(stdinMarker));
  assert.doesNotMatch(output, /SELECT|INSERT|UPDATE|password_hash/i);
});

test("package exposes the reviewed shared-password seed command", () => {
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["access:set-shared-password"],
    "tsx scripts/set-dashboard-shared-password.ts",
  );
  assert.equal(
    packageJson.scripts.test,
    "node --import tsx --test src/**/*.test.ts scripts/set-dashboard-shared-password.test.ts",
  );
});

test("documented seed invocations silence npm argument diagnostics", () => {
  const plan = readFileSync(
    path.resolve("docs/superpowers/plans/2026-07-22-abbott-zaruku-shared-password-admin.md"),
    "utf8",
  );

  assert.match(plan, /npm --silent run access:set-shared-password -- --client-id zaruku/);
  assert.doesNotMatch(plan, /(?<!npm --silent )npm run access:set-shared-password/);
});
