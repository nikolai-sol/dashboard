import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FORBIDDEN_ABBOTT_ARTIFACT,
  assertAbbottArtifact,
  inspectAbbottArtifact,
} from "./assert-abbott-artifact.mjs";

function withArtifact(run) {
  const root = mkdtempSync(path.join(tmpdir(), "abbott-scan-"));
  try {
    write(root, "apps/abbott/server.js", "module.exports = {};\n");
    write(root, "src/schemas/yandex_metrika.yaml", "platform: yandex_metrika\n");
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relative, contents) {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
}

test("exports the complete fixed Abbott filename policy", () => {
  const sources = FORBIDDEN_ABBOTT_ARTIFACT.map((pattern) => pattern.source).join("\n");
  for (const marker of ["\\.env", "\\.git", "uploads?", "xlsx?", "csv", "log", "sql", "dump", "zaruku", "medroche", "google-ads", "yandex-direct", "media-plan", "raw-client-id"]) {
    assert.match(sources, new RegExp(marker, "i"));
  }
});

test("legitimate Abbott files pass while dependency text is not treated as dashboard content", () => withArtifact((root) => {
  write(root, "node_modules/example/README.md", "google-ads and zaruku are dependency documentation\n");
  const result = inspectAbbottArtifact(root);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scannedFiles, 3);
  assert.equal(result.scannedTextFiles, 2);
  assert.doesNotThrow(() => assertAbbottArtifact(root));
}));

test("rejects each forbidden Abbott artifact filename", async (t) => {
  const names = [
    ".env.production", ".git/config", "uploads/source.bin", "export.xlsx", "rows.csv", "runtime.log", "backup.sql", "state.dump",
    "apps/zaruku/server.js", "medroche/page.js", "google-ads/client.js", "yandex-direct/client.js", "media-plan/data.js", "raw-client-id.txt",
  ];
  for (const [index, name] of names.entries()) await t.test(name, () => withArtifact((root) => {
    write(root, name, `fixture-${index}\n`);
    assert.ok(inspectAbbottArtifact(root).violations.some((item) => item.includes(name)));
  }));
});

test("rejects secret assignments, viewer tokens and the private baseline name without revealing values", async (t) => {
  const cases = {
    metrika: "METRIKA_TOKEN=metrika-sensitive-value",
    auth: "DASHBOARD_AUTH_SECRET=auth-sensitive-value",
    database: "DB_PASSWORD=database-sensitive-value",
    private_database: "ABBOTT_PRIVATE_DB_PASSWORD=private-sensitive-value",
    viewer_jwt: "VIEWER_JWT=viewer-sensitive-value",
    query_token: "QUERY_TOKEN=query-sensitive-value",
    access_token: "access_token=access-sensitive-value",
    baseline: "/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14/private.png",
  };
  for (const [name, contents] of Object.entries(cases)) await t.test(name, () => withArtifact((root) => {
    const filename = `apps/abbott/.next-abbott/server/chunks/${name}.js`;
    write(root, filename, contents);
    const result = inspectAbbottArtifact(root);
    assert.ok(result.violations.some((item) => item.includes(filename)));
    assert.ok(result.violations.every((item) => !item.includes("sensitive-value")));
    assert.throws(() => assertAbbottArtifact(root), (error) => {
      assert.doesNotMatch(String(error), /(?:metrika|auth|database|private|viewer|query|access)-sensitive-value/);
      return true;
    });
  }));
});

test("rejects symlinks without reading their targets", () => withArtifact((root) => {
  const outside = mkdtempSync(path.join(tmpdir(), "abbott-scan-outside-"));
  try {
    write(outside, "secret.txt", "METRIKA_TOKEN=outside-sensitive-value\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "linked-secret"));
    const result = inspectAbbottArtifact(root);
    assert.ok(result.violations.some((item) => item.includes("linked-secret")));
    assert.ok(result.violations.every((item) => !item.includes("outside-sensitive-value")));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));

test("CLI rejection output contains filenames and never secret values", () => withArtifact((root) => {
  const filename = "apps/abbott/.next-abbott/server/chunks/leak.js";
  write(root, filename, "METRIKA_TOKEN=cli-sensitive-value\n");
  const result = spawnSync(process.execPath, ["scripts/assert-abbott-artifact.mjs", root], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /leak\.js/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /cli-sensitive-value/);
}));
