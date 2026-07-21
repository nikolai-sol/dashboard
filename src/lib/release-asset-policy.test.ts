import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as XLSX from "xlsx";

import { findForbiddenPublicAssets, findPrivateReleaseAssets } from "./release-asset-policy";
import { parseWorkbookJson } from "../../scripts/import-abbott-private-data";

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
    await writeFile(path.join(releaseRoot, "src", "db", "migrations", "040_abbott_snapshot_parser_version_identity.sql"), "DDL");
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

test("release scans detect private signatures under neutral JSON and CSV names", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-content-"));
  try {
    await writeFile(path.join(releaseRoot, "users.json"), JSON.stringify({ rows: [{ raw_user_id: "doctor-001", direction: "cardio" }] }));
    await writeFile(path.join(releaseRoot, "events.csv"), "report_date,protected_visit_id,event_sequence\n2026-07-01,visit-secret,0\n");
    await writeFile(path.join(releaseRoot, "summary.json"), JSON.stringify({ sessions: 12, users: 9 }));
    await writeFile(path.join(releaseRoot, "totals.csv"), "date,sessions,users\n2026-07-01,12,9\n");

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["events.csv", "users.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject native Yandex Logs visit exports while allowing aggregate metrics", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-metrika-logs-"));
  try {
    const visitFields = [
      "ym:s:visitID",
      "ym:s:dateTime",
      "ym:s:startURL",
      "ym:s:endURL",
      "ym:s:pageViews",
      "ym:s:visitDuration",
      "ym:s:bounce",
      "ym:s:clientID",
      "ym:s:lastsignTrafficSource",
      "ym:s:parsedParamsKey1",
      "ym:s:parsedParamsKey2",
    ];
    const visitValues = [
      "visit-secret-native",
      "2026-07-20 10:00:00",
      "https://private.example/start?doctor=one",
      "https://private.example/end?doctor=one",
      "3",
      "120",
      "0",
      "client-secret-native",
      "organic",
      "UserID",
      "doctor-secret-native",
    ];
    await writeFile(path.join(releaseRoot, "native-visits.tsv"), `${visitFields.join("\t")}\n${visitValues.join("\t")}\n`);
    await writeFile(
      path.join(releaseRoot, "native-visits.csv"),
      `${[...visitFields, "ym:s:params"].join(",")}\n${[...visitValues, "[]"].join(",")}\n`,
    );
    await writeFile(
      path.join(releaseRoot, "aggregate-metrics.tsv"),
      "ym:s:dateTime\tym:s:visits\tym:s:users\tym:s:pageViews\tym:s:bounce\n2026-07-20\t12\t9\t20\t0.25\n",
    );
    await writeFile(
      path.join(releaseRoot, "aggregate-metrics.csv"),
      "ym:s:dateTime,ym:s:visits,ym:s:users,ym:s:pageViews\n2026-07-20,12,9,20\n",
    );

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["native-visits.csv", "native-visits.tsv"]);

    const failure = spawnSync(process.execPath, ["--import", "tsx", assetCli, "--release", releaseRoot], { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.equal(failure.stderr, "native-visits.csv\nnative-visits.tsv\n");
    assert.doesNotMatch(failure.stderr, /visit-secret-native|client-secret-native|doctor-secret-native|private\.example/);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject an importer-valid Abbott user mapping under a neutral JSON name", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-user-map-"));
  try {
    const payload = {
      id: [
        { id: "doctor-secret-001", direction: "cardiology" },
        { id: "doctor-secret-002", direction: "neurology" },
      ],
    };
    assert.equal(parseWorkbookJson(payload).privateUserDirections.length, 2);
    await writeFile(path.join(releaseRoot, "users.json"), JSON.stringify(payload));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["users.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject an Abbott user mapping when direction is empty", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-empty-direction-"));
  try {
    await writeFile(path.join(releaseRoot, "mapping.json"), JSON.stringify({
      id: [{ id: "doctor-secret-without-direction", direction: "" }],
    }));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["mapping.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject an Abbott user mapping when direction is omitted", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-omitted-direction-"));
  try {
    await writeFile(path.join(releaseRoot, "mapping.json"), JSON.stringify({
      id: [{ id: "doctor-secret-without-direction-field" }],
    }));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["mapping.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject an importer-consumed user row with extra ignored keys", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-user-map-extra-"));
  try {
    const payload = {
      id: [{ id: "doctor-secret-extra", direction: "cardiology", note: "ignored by importer" }],
    };
    assert.equal(parseWorkbookJson(payload).privateUserDirections.length, 1);
    await writeFile(path.join(releaseRoot, "users-extra.json"), JSON.stringify(payload));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["users-extra.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans reject mixed user arrays when any row is importer-consumed", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-user-map-mixed-"));
  try {
    const payload = {
      id: [
        { kind: "metadata" },
        { id: "doctor-secret-mixed", direction: "neurology" },
        { id: "rejected-user", direction: "" },
      ],
    };
    const parsed = parseWorkbookJson(payload);
    assert.equal(parsed.privateUserDirections.length, 2);
    assert.equal(parsed.rejectedCount, 1);
    await writeFile(path.join(releaseRoot, "users-mixed.json"), JSON.stringify(payload));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["users-mixed.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans allow ordinary JSON objects with ID fields outside the Abbott top-level id array", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-ordinary-ids-"));
  try {
    await writeFile(path.join(releaseRoot, "catalog.json"), JSON.stringify({
      catalog: [
        { id: "article-1", title: "Ordinary article" },
        { direction: "north", label: "Region" },
      ],
      rows: [
        { id: "article-2", direction: "north" },
      ],
    }));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), []);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans detect neutral spreadsheet journey and Bitrix export signatures", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-sheet-"));
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ SESSION_ID: "session-secret", USER_ID: "doctor-001", PAGE_URL: "/private" }]),
      "Export",
    );
    XLSX.writeFile(workbook, path.join(releaseRoot, "activity.xlsx"));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["activity.xlsx"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans fail closed for malformed candidate data", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-malformed-"));
  try {
    await writeFile(path.join(releaseRoot, "neutral.json"), "{ not valid json");
    await writeFile(path.join(releaseRoot, "broken.xlsx"), "not a workbook");

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), ["broken.xlsx", "neutral.json"]);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release scans allow large bounded aggregate JSON without private keys", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-large-json-"));
  try {
    const metrics = Array.from({ length: 50_001 }, (_, index) => ({ sessions: index, users: index }));
    await writeFile(path.join(releaseRoot, "metrics.json"), JSON.stringify({ metrics }));

    assert.deepEqual(findPrivateReleaseAssets(releaseRoot), []);
  } finally {
    await rm(releaseRoot, { force: true, recursive: true });
  }
});

test("release CLI reports paths only when neutral private content is rejected", async () => {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "release-asset-policy-cli-"));
  try {
    const pii = "doctor-secret-value";
    await writeFile(path.join(releaseRoot, "users.json"), JSON.stringify({ id: [{ id: pii, direction: "cardiology" }] }));
    const failure = spawnSync(process.execPath, ["--import", "tsx", assetCli, "--release", releaseRoot], { encoding: "utf8" });

    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.equal(failure.stderr, "users.json\n");
    assert.doesNotMatch(failure.stderr, new RegExp(pii));
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
