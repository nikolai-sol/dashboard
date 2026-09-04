import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function sourceFilesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(absolute);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [absolute] : [];
  });
}

test("production and test sources use ExcelJS without the vulnerable SheetJS package", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(manifest.dependencies?.xlsx, undefined);
  assert.equal(manifest.devDependencies?.xlsx, undefined);
  assert.equal(lockfile.packages?.["node_modules/xlsx"], undefined);

  const offenders = ["src", "scripts"]
    .flatMap(sourceFilesBelow)
    .filter((file) => /(?:from\s+|require\()['"]xlsx['"]/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(offenders, []);
});
