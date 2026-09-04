import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as XLSX from "xlsx";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: "" };
  delete environment.NODE_OPTIONS;
  for (const key of Object.keys(environment)) {
    if (key.startsWith("DB_") || key.startsWith("MYSQL_")) delete environment[key];
  }
  return environment;
}

test("packaged Alice importer runs an external workbook dry-run without source or runtime dependencies", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "alice-release-"));
  try {
    const releaseRoot = path.join(temporaryRoot, "release");
    const scriptsDirectory = path.join(releaseRoot, "scripts");
    const workbookPath = path.join(temporaryRoot, "outside-release.xlsx");
    const artifactPath = path.join(scriptsDirectory, "import-zaruku-alice-visibility.cjs");
    mkdirSync(scriptsDirectory, { recursive: true });
    writeFileSync(path.join(releaseRoot, ".env"), "", "utf8");
    writeFileSync(path.join(releaseRoot, "package.json"), JSON.stringify({
      name: "isolated-alice-release",
      private: true,
      scripts: { "import:zaruku-alice": "tsx scripts/import-zaruku-alice-visibility.ts" },
    }), "utf8");

    const sheet = XLSX.utils.aoa_to_sheet([
      ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_, index) => `Сайт ${index + 1}`)],
      ["тестовый запрос", "true", "https://yandex.ru/search/?text=test", "https://zaruku.ru/article/"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "sheet1");
    XLSX.writeFile(workbook, workbookPath);

    const build = spawnSync(process.execPath, [
      "scripts/build-zaruku-alice-importer.mjs",
      "--outfile", artifactPath,
      "--package-json", path.join(releaseRoot, "package.json"),
    ], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);

    const packagedManifest = JSON.parse(readFileSync(path.join(releaseRoot, "package.json"), "utf8"));
    assert.equal(
      packagedManifest.scripts["import:zaruku-alice"],
      "node --env-file=.env scripts/import-zaruku-alice-visibility.cjs",
    );
    assert.deepEqual(readdirSync(scriptsDirectory), ["import-zaruku-alice-visibility.cjs"]);
    assert.equal(filesBelow(releaseRoot).some((file) => /\.(xlsx|xls)$/i.test(file)), false);
    assert.equal(filesBelow(releaseRoot).some((file) => file.includes(`${path.sep}node_modules${path.sep}`)), false);

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const smoke = spawnSync(npmCommand, [
      "run", "--silent", "import:zaruku-alice", "--",
      "--xlsx", workbookPath,
      "--period", "2026-08",
      "--official-sov", "43.91",
      "--captured-at", "2026-09-04T13:28:14.000Z",
      "--dry-run",
    ], { cwd: releaseRoot, encoding: "utf8", env: sanitizedEnvironment() });
    assert.equal(smoke.status, 0, `${smoke.stdout}${smoke.stderr}`);
    assert.match(smoke.stdout, /mode=xlsx queries=1 portal_present=1 sample_presence_pct=100\.00 sources=1 featured_sites=0 validation_mismatches=0/);

    const artifact = readFileSync(artifactPath, "utf8");
    assert.doesNotMatch(artifact, /\/Users\/|@esbuild\/darwin-arm64|node_modules\/tsx|get-tsconfig/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("release packaging builds only the bundled importer while local development keeps tsx", () => {
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const deploy = readFileSync(path.join(projectRoot, "scripts/deploy.sh"), "utf8");

  assert.equal(manifest.scripts["import:zaruku-alice"], "tsx scripts/import-zaruku-alice-visibility.ts");
  assert.equal(manifest.devDependencies.esbuild, "0.27.3");
  assert.match(deploy, /build-zaruku-alice-importer\.mjs/);
  assert.match(deploy, /import-zaruku-alice-visibility\.cjs/);
  assert.doesNotMatch(deploy, /cp scripts\/import-zaruku-alice-visibility\.ts/);
  assert.doesNotMatch(deploy, /cp .*\.(?:xlsx|xls)(?:["' ]|$)/i);
});
