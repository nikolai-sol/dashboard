import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const FINAL_DASHBOARD_TYPES = [
  "awareness",
  "performance",
  "overview",
  "multibrand",
  "abbott_bi",
  "zaruku_bi",
];

const migrationsDirectory = path.resolve("src/db/migrations");

function readDashboardTypeAlters() {
  return readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .flatMap((fileName) => {
      const sql = readFileSync(path.join(migrationsDirectory, fileName), "utf8");
      const matches = sql.matchAll(
        /ALTER\s+TABLE\s+dashboards[\s\S]*?MODIFY\s+COLUMN\s+dashboard_type\s+ENUM\s*\(([^)]+)\)/gi,
      );
      return Array.from(matches, (match) => ({
        fileName,
        values: Array.from(match[1].matchAll(/'([^']+)'/g), (value) => value[1]),
      }));
    });
}

const dashboardTypeAlters = readDashboardTypeAlters();

test("dashboard_type replay contract covers every historical ALTER migration", () => {
  assert.deepEqual(
    dashboardTypeAlters.map(({ fileName }) => fileName),
    [
      "018_dashboard_multibrand_type.sql",
      "019_dashboard_abbott_bi_type.sql",
      "030_dashboard_zaruku_bi_type.sql",
    ],
  );
});

for (const { fileName, values } of dashboardTypeAlters) {
  test(`${fileName} retains the final dashboard_type enum during repeat-all replay`, () => {
    assert.deepEqual(values, FINAL_DASHBOARD_TYPES);
    if (fileName.startsWith("018_") || fileName.startsWith("019_")) {
      assert.ok(values.includes("zaruku_bi"));
    }
  });
}
