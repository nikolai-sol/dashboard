import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { findPrivatePublicAssets, findPrivateReleaseAssets } from "./release-asset-policy";

async function withPublicTree(run: (publicRoot: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "release-asset-policy-"));
  const publicRoot = path.join(root, "public");
  await mkdir(publicRoot);
  try {
    await run(publicRoot);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("rejects prohibited Abbott source assets recursively and case-insensitively", async () => {
  await withPublicTree(async (publicRoot) => {
    const filenames = [
      "ABBOTT/users.JSON",
      "nested/abbott/report.XLSX",
      "nested/ABBOTT-export.xls",
      "nested/abbott/rows.CsV",
      "nested/abbott/dump.SQL",
      "nested/abbott/archive.zip",
      "nested/abbott/archive.TAR.GZ",
    ];
    for (const filename of filenames) {
      const target = path.join(publicRoot, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "fixture");
    }

    assert.deepEqual(findPrivatePublicAssets(publicRoot), filenames.sort());
  });
});

test("rejects Abbott source filenames outside an Abbott directory", async () => {
  await withPublicTree(async (publicRoot) => {
    await mkdir(path.join(publicRoot, "downloads"), { recursive: true });
    await writeFile(path.join(publicRoot, "downloads", "AbBoTt-workbook.JsOn"), "fixture");

    assert.deepEqual(findPrivatePublicAssets(publicRoot), ["downloads/AbBoTt-workbook.JsOn"]);
  });
});

test("allows ordinary images, non-Abbott public data, and missing roots", async () => {
  await withPublicTree(async (publicRoot) => {
    await mkdir(path.join(publicRoot, "abbott", "images"), { recursive: true });
    await writeFile(path.join(publicRoot, "abbott", "images", "hero.PNG"), "fixture");
    await writeFile(path.join(publicRoot, "manual_data_template.csv"), "fixture");

    assert.deepEqual(findPrivatePublicAssets(publicRoot), []);
    assert.deepEqual(findPrivatePublicAssets(path.join(publicRoot, "missing")), []);
  });
});

test("release scans reject private data outside public while allowing Abbott schema migrations", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-standalone-"));
  try {
    await mkdir(path.join(releaseRoot, "src", "db", "migrations"), { recursive: true });
    await mkdir(path.join(releaseRoot, "public", "abbott"), { recursive: true });
    await writeFile(path.join(releaseRoot, "ABBOTT-UNRESOLVED.csv"), "fixture");
    await writeFile(path.join(releaseRoot, "src", "db", "migrations", "033_abbott_schema.sql"), "DDL");
    await writeFile(path.join(releaseRoot, "public", "abbott", "source.json"), "fixture");

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), [
      "ABBOTT-UNRESOLVED.csv",
      "public/abbott/source.json",
    ]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});
