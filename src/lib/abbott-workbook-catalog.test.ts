import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildAbbottCatalogAudit, parseAbbottWorkbookCatalog } from "./abbott-workbook-catalog";

function workbookBuffer(sheets: Record<string, Array<Record<string, unknown>>>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("preserves duplicate lookup rows with stable source provenance", () => {
  const parsed = parseAbbottWorkbookCatalog(workbookBuffer({
    pages: [
      { "Название": "Shared title", "Символьный код": "shared-slug", "Тип материала": "Статьи" },
    ],
    "Статьи": [
      { "Название": "Shared title", "Символьный код": "shared-slug" },
    ],
  }));

  assert.deepEqual(parsed.rows.map(({ sourceSheet, sourceRowOrdinal }) => [sourceSheet, sourceRowOrdinal]), [
    ["pages", 1],
    ["Статьи", 1],
  ]);
  assert.notEqual(parsed.rows[0]?.targetKeyFingerprint, parsed.rows[1]?.targetKeyFingerprint);

  const repeatedOnOneSheet = parseAbbottWorkbookCatalog(workbookBuffer({
    pages: [
      { "Название": "Same row", "Символьный код": "same-slug", "Тип материала": "Статьи" },
      { "Название": "Same row", "Символьный код": "same-slug", "Тип материала": "Статьи" },
    ],
  }));
  assert.deepEqual(repeatedOnOneSheet.rows.map((row) => row.sourceRowOrdinal), [1, 2]);
  assert.notEqual(
    repeatedOnOneSheet.rows[0]?.targetKeyFingerprint,
    repeatedOnOneSheet.rows[1]?.targetKeyFingerprint,
  );
});

test("skips only truly empty relevant rows and rejects populated metadata without an identity", () => {
  const skipped = parseAbbottWorkbookCatalog(workbookBuffer({
    pages: [
      { "Unrelated workbook note": "not catalog metadata" },
      { "Название": "Valid row", "Символьный код": "valid-row" },
    ],
  }));
  assert.equal(skipped.rows.length, 1);

  for (const populatedMetadata of [
    { "Направление": "cardiology" },
    { "Доступ": "registered" },
    { "Тип материала": "article" },
    { "Активность": "Да" },
  ]) {
    assert.throws(
      () => parseAbbottWorkbookCatalog(workbookBuffer({ "Помощник фармацевта": [populatedMetadata] })),
      (error: unknown) => error instanceof Error && error.message === "Workbook content identity is blank",
    );
  }
});

test("reports aggregate lookup conflicts with sorted hashes and no row-level keys", () => {
  const parsed = parseAbbottWorkbookCatalog(workbookBuffer({
    pages: [
      {
        "Название": "Shared title",
        "Символьный код": "shared-slug",
        "Тип материала": "Статьи",
        "Направление": "cardiology",
      },
    ],
    "Статьи": [
      { "Название": "Shared title", "Символьный код": "shared-slug", "Направление": "cardiology" },
    ],
    "Видео": [
      { "Название": "Shared title", "Символьный код": "video-slug", "Направление": "cardiology" },
    ],
  }));

  const audit = buildAbbottCatalogAudit(parsed.rows);
  assert.deepEqual(
    {
      source_row_count: audit.source_row_count,
      rows_with_slug: audit.rows_with_slug,
      unique_lookup_keys: audit.unique_lookup_keys,
      identical_groups: audit.identical_groups,
      ambiguous_groups: audit.ambiguous_groups,
      excess_occurrences: audit.excess_occurrences,
    },
    {
      source_row_count: 3,
      rows_with_slug: 3,
      unique_lookup_keys: 3,
      identical_groups: 1,
      ambiguous_groups: 1,
      excess_occurrences: 3,
    },
  );
  assert.equal(audit.conflict_set_fingerprints.length, 2);
  assert.deepEqual(audit.conflict_set_fingerprints, [...audit.conflict_set_fingerprints].sort());
  audit.conflict_set_fingerprints.forEach((value) => assert.match(value, /^[a-f0-9]{64}$/));

  const forbiddenKeys = new Set(["title", "slug", "url", "path", "user_id", "session"]);
  const assertNoForbiddenKeys = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(assertNoForbiddenKeys);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden audit key: ${key}`);
      assertNoForbiddenKeys(nested);
    }
  };
  assertNoForbiddenKeys(audit);
  assert.doesNotMatch(JSON.stringify(audit), /Shared title|shared-slug|video-slug|cardiology/);
});

test("audit CLI accepts only private input/output flags and writes aggregate evidence atomically with mode 0600", () => {
  const root = mkdtempSync(path.join(tmpdir(), "abbott-workbook-audit-"));
  try {
    const inputDir = path.join(root, "inputs");
    const outputDir = path.join(root, "evidence");
    const publicDir = path.join(root, "public");
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    mkdirSync(publicDir);
    const workbook = workbookBuffer({ "Статьи": [{ "Название": "Private source", "Символьный код": "private-slug" }] });
    const input = path.join(inputDir, "workbook.xlsx");
    const publicInput = path.join(publicDir, "workbook.xlsx");
    const output = path.join(outputDir, "audit.json");
    writeFileSync(input, workbook, { mode: 0o600 });
    writeFileSync(publicInput, workbook, { mode: 0o600 });
    const script = path.resolve("scripts/audit-abbott-workbook.ts");

    const completed = spawnSync(process.execPath, [
      "--import", "tsx", script,
      "--workbook-xlsx", input,
      "--output", output,
    ], { encoding: "utf8" });
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(completed.stdout, "Abbott workbook audit complete\n");
    assert.equal(completed.stderr, "");
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(outputDir), ["audit.json"]);
    const evidence = readFileSync(output, "utf8");
    assert.deepEqual(JSON.parse(evidence), buildAbbottCatalogAudit(parseAbbottWorkbookCatalog(workbook).rows));
    assert.doesNotMatch(evidence, /Private source|private-slug/);

    const publicAttempt = spawnSync(process.execPath, [
      "--import", "tsx", script,
      "--workbook-xlsx", publicInput,
      "--output", path.join(outputDir, "public-attempt.json"),
    ], { encoding: "utf8" });
    assert.equal(publicAttempt.status, 1);
    assert.equal(publicAttempt.stdout, "");
    assert.equal(publicAttempt.stderr, "Abbott workbook audit failed\n");

    const unknownFlag = spawnSync(process.execPath, [
      "--import", "tsx", script,
      "--workbook-xlsx", input,
      "--output", path.join(outputDir, "unknown-attempt.json"),
      "--archive", path.join(root, "archive"),
    ], { encoding: "utf8" });
    assert.equal(unknownFlag.status, 1);
    assert.equal(unknownFlag.stdout, "");
    assert.equal(unknownFlag.stderr, "Abbott workbook audit failed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit CLI rejects Git, worktree, web, and release roots after resolving symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "abbott-workbook-audit-roots-"));
  try {
    const safeInputDir = path.join(root, "inputs");
    const safeOutputDir = path.join(root, "evidence");
    mkdirSync(safeInputDir);
    mkdirSync(safeOutputDir);
    const workbook = workbookBuffer({ "Статьи": [{ "Название": "Safe fixture", "Символьный код": "safe-fixture" }] });
    const safeInput = path.join(safeInputDir, "workbook.xlsx");
    writeFileSync(safeInput, workbook, { mode: 0o600 });
    const script = path.resolve("scripts/audit-abbott-workbook.ts");
    const attempt = (input: string, output: string) => spawnSync(process.execPath, [
      "--import", "tsx", script,
      "--workbook-xlsx", input,
      "--output", output,
    ], { encoding: "utf8" });
    const assertRejected = (result: ReturnType<typeof attempt>): void => {
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Abbott workbook audit failed\n");
    };

    const gitRepo = path.join(root, "git-repo");
    mkdirSync(path.join(gitRepo, ".git"), { recursive: true });
    const gitRepoInput = path.join(gitRepo, "workbook.xlsx");
    writeFileSync(gitRepoInput, workbook, { mode: 0o600 });
    assertRejected(attempt(gitRepoInput, path.join(safeOutputDir, "git-repo-input.json")));
    assertRejected(attempt(safeInput, path.join(gitRepo, "git-repo-output.json")));

    const gitWorktree = path.join(root, "git-worktree");
    mkdirSync(gitWorktree);
    writeFileSync(path.join(gitWorktree, ".git"), "gitdir: ../git-repo/.git/worktrees/test\n");
    const gitWorktreeInput = path.join(gitWorktree, "workbook.xlsx");
    writeFileSync(gitWorktreeInput, workbook, { mode: 0o600 });
    assertRejected(attempt(gitWorktreeInput, path.join(safeOutputDir, "git-worktree-input.json")));
    assertRejected(attempt(safeInput, path.join(gitWorktree, "git-worktree-output.json")));

    for (const segment of ["public", ".next", "standalone", "static", "build", "dist"]) {
      const forbiddenRoot = path.join(root, segment);
      mkdirSync(forbiddenRoot);
      const forbiddenInput = path.join(forbiddenRoot, "workbook.xlsx");
      writeFileSync(forbiddenInput, workbook, { mode: 0o600 });
      assertRejected(attempt(forbiddenInput, path.join(safeOutputDir, `${segment}-input.json`)));
      assertRejected(attempt(safeInput, path.join(forbiddenRoot, "audit.json")));
    }

    const alias = path.join(root, "resolved-alias");
    symlinkSync(path.join(root, "dist"), alias, "dir");
    assertRejected(attempt(path.join(alias, "workbook.xlsx"), path.join(safeOutputDir, "alias-input.json")));
    assertRejected(attempt(safeInput, path.join(alias, "alias-output.json")));

    const safeAttempt = attempt(safeInput, path.join(safeOutputDir, "safe-audit.json"));
    assert.equal(safeAttempt.status, 0, safeAttempt.stderr);
    assert.equal(safeAttempt.stdout, "Abbott workbook audit complete\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
