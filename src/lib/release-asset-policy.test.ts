import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { findForbiddenPublicAssets, findPrivateReleaseAssets } from "./release-asset-policy";

const assetCli = fileURLToPath(new URL("../../scripts/assert-no-private-public-assets.ts", import.meta.url));

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

    assert.deepEqual(findForbiddenPublicAssets(publicRoot), filenames.sort());
  });
});

test("rejects Abbott source filenames outside an Abbott directory", async () => {
  await withPublicTree(async (publicRoot) => {
    await mkdir(path.join(publicRoot, "downloads"), { recursive: true });
    await writeFile(path.join(publicRoot, "downloads", "AbBoTt-workbook.JsOn"), "fixture");

    assert.deepEqual(findForbiddenPublicAssets(publicRoot), ["downloads/AbBoTt-workbook.JsOn"]);
  });
});

test("allows ordinary images, non-Abbott public data, and missing roots", async () => {
  await withPublicTree(async (publicRoot) => {
    await mkdir(path.join(publicRoot, "abbott", "images"), { recursive: true });
    await writeFile(path.join(publicRoot, "abbott", "images", "hero.PNG"), "fixture");
    await writeFile(path.join(publicRoot, "manual_data_template.csv"), "fixture");

    assert.deepEqual(findForbiddenPublicAssets(publicRoot), []);
    assert.deepEqual(findForbiddenPublicAssets(path.join(publicRoot, "missing")), []);
  });
});

test("public scans fail closed on file, directory, and loop symlinks without following them", async () => {
  await withPublicTree(async (publicRoot) => {
    const outsideFile = path.join(path.dirname(publicRoot), "outside.json");
    const outsideDirectory = path.join(path.dirname(publicRoot), "outside-directory");
    await writeFile(outsideFile, "fixture");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "abbott-source.json"), "fixture");
    await symlink(outsideFile, path.join(publicRoot, "abbott-file.json"));
    await symlink(outsideDirectory, path.join(publicRoot, "linked-directory"));
    await symlink(".", path.join(publicRoot, "loop"));

    assert.deepEqual(findForbiddenPublicAssets(publicRoot), [
      "abbott-file.json",
      "linked-directory",
      "loop",
    ]);
  });
});

test("release scans reject private data outside public while allowing Abbott schema migrations", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-standalone-"));
  try {
    await mkdir(path.join(releaseRoot, "src", "db", "migrations"), { recursive: true });
    await mkdir(path.join(releaseRoot, "public", "abbott"), { recursive: true });
    await writeFile(path.join(releaseRoot, "ABBOTT-UNRESOLVED.csv"), "fixture");
    await writeFile(path.join(releaseRoot, "src", "db", "migrations", "019_dashboard_abbott_bi_type.sql"), "DDL");
    await writeFile(path.join(releaseRoot, "src", "db", "migrations", "033_abbott_canonical_release_control.sql"), "DDL");
    await writeFile(path.join(releaseRoot, "src", "db", "migrations", "034_abbott_unreviewed.sql"), "DDL");
    await writeFile(path.join(releaseRoot, "public", "abbott", "source.json"), "fixture");

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), [
      "ABBOTT-UNRESOLVED.csv",
      "public/abbott/source.json",
      "src/db/migrations/034_abbott_unreviewed.sql",
    ]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("asset CLI is silent on success and prints only violating paths on failure", async () => {
  await withPublicTree(async (publicRoot) => {
    await writeFile(path.join(publicRoot, "logo.png"), "fixture");
    const success = spawnSync(process.execPath, ["--import", "tsx", assetCli, publicRoot], { encoding: "utf8" });
    assert.equal(success.status, 0);
    assert.equal(success.stdout, "");
    assert.equal(success.stderr, "");

    await mkdir(path.join(publicRoot, "ABBOTT"));
    await writeFile(path.join(publicRoot, "ABBOTT", "source.JSON"), "fixture");
    const failure = spawnSync(process.execPath, ["--import", "tsx", assetCli, publicRoot], { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.equal(failure.stderr, "ABBOTT/source.JSON\n");
  });
});
