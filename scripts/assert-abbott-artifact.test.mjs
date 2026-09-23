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
    write(root, "apps/abbott/src/schemas/yandex_metrika.yaml", "platform: yandex_metrika\n");
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
  write(root, "apps/abbott/runtime.js", 'const safe = ["long.application.namespace.withSegments", {"access_token":""}, "?access_token="];\n');
  const result = inspectAbbottArtifact(root);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scannedFiles, 4);
  assert.equal(result.scannedTextFiles, 3);
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
    bare_jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmJvdHQtdmlld2VyIn0.dmlld2VyLXNpZ25hdHVyZS1zZW5zaXRpdmU",
    json_access_token: '{"access_token":"json-sensitive-value"}',
    string_access_token: "'access_token': 'string-sensitive-value'",
    embedded_access_token: '"access_token=embedded-sensitive-value"',
    query_access_token: "https://dashboard.invalid/view?access_token=query-access-sensitive-value",
    joined_access_token: "https://dashboard.invalid/view?a=1&access_token=joined-access-sensitive-value",
    query_embed_key: "https://dashboard.invalid/view?embed_key=query-embed-sensitive-value",
    joined_embed_key: "https://dashboard.invalid/view?a=1&embed_key=joined-embed-sensitive-value",
    baseline: "/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14/private.png",
  };
  for (const [name, contents] of Object.entries(cases)) await t.test(name, () => withArtifact((root) => {
    const filename = `apps/abbott/.next-abbott/server/chunks/${name}.js`;
    write(root, filename, contents);
    const result = inspectAbbottArtifact(root);
    assert.ok(result.violations.some((item) => item.includes(filename)));
    assert.ok(result.violations.every((item) => !item.includes("sensitive-value")));
    assert.throws(() => assertAbbottArtifact(root), (error) => {
      assert.doesNotMatch(String(error), /(?:metrika|auth|database|private|viewer|query|joined|string|embedded|json|access)-sensitive-value/);
      return true;
    });
  }));
});

test("scans test-named files and rejects their secret values without echoing them", () => withArtifact((root) => {
  const filename = "apps/abbott/src/anything.test.ts";
  write(root, filename, "METRIKA_TOKEN=test-file-sensitive-value\n");
  const result = inspectAbbottArtifact(root);
  assert.ok(result.violations.some((item) => item.includes(`secret marker: ${filename}`)));
  assert.ok(result.violations.every((item) => !item.includes("test-file-sensitive-value")));
}));

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

test("CLI missing and non-directory root diagnostics never disclose absolute input paths", async (t) => {
  for (const kind of ["missing", "file"]) await t.test(kind, () => {
    const parent = mkdtempSync(path.join(tmpdir(), "abbott-root-sensitive-parent-"));
    const root = path.join(parent, `${kind}-safe-basename`);
    try {
      if (kind === "file") writeFileSync(root, "not a directory\n");
      const result = spawnSync(process.execPath, ["scripts/assert-abbott-artifact.mjs", root], {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
      });
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 1);
      assert.match(output, new RegExp(`${kind === "missing" ? "missing" : "unsafe"} artifact root`));
      assert.match(output, new RegExp(`${kind}-safe-basename`));
      assert.doesNotMatch(output, new RegExp(parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
