import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationsDir = join(new URL(".", import.meta.url).pathname, "migrations");
const migration = (name: string) => readFileSync(join(migrationsDir, name), "utf8");

const baseSql = migration("034_google_search_console_daily_canonical.sql");
const contractSql = migration("037_gsc_new_canonical_contract.sql");
const optionalSql = migration("038_gsc_optional_search_layers.sql");

const activeColumns = ["analytics_account_id", "query", "page", "country", "device", "position"] as const;
const legacyColumns = ["property_url", "device_type", "query_text"] as const;

type SchemaModel = {
  columns: Set<string>;
  nullable: Set<string>;
  indexes: Map<string, string>;
};

function schemaFrom034(): SchemaModel {
  const queryTable = baseSql.match(/CREATE TABLE IF NOT EXISTS canonical_fact_gsc_queries_daily \(([\s\S]*?)\n\)/)?.[1];
  assert.ok(queryTable, "034 must create the core GSC query table");

  const columns = new Set<string>();
  const nullable = new Set<string>();
  const indexes = new Map<string, string>();
  for (const rawLine of queryTable.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    const column = line.match(/^([a-z_]+)\s+/i)?.[1];
    if (column && !/^(PRIMARY|UNIQUE|KEY|CONSTRAINT)$/i.test(column)) {
      columns.add(column);
      if (!/\bNOT NULL\b/i.test(line)) nullable.add(column);
    }
    const index = line.match(/^(?:UNIQUE KEY|KEY)\s+([a-z0-9_]+)\s*\(([^)]+)\)/i);
    if (index) indexes.set(index[1], index[2].replace(/\s+/g, ""));
  }
  return { columns, nullable, indexes };
}

function apply037(model: SchemaModel) {
  for (const column of activeColumns) {
    const guard = new RegExp(
      `information_schema\\.COLUMNS[\\s\\S]*?TABLE_NAME = 'canonical_fact_gsc_queries_daily'[\\s\\S]*?COLUMN_NAME = '${column}'[\\s\\S]*?ADD COLUMN ${column}\\s+([^']+)`,
      "i",
    );
    assert.match(contractSql, guard, `037 must guard and add ${column}`);
    if (!model.columns.has(column)) {
      model.columns.add(column);
      model.nullable.add(column);
    }
  }

  for (const column of legacyColumns) {
    assert.match(
      contractSql,
      new RegExp(`MODIFY(?: COLUMN)? ${column}[^;]*\\bNULL\\b`, "i"),
      `037 must preserve nullable legacy column ${column}`,
    );
    model.nullable.add(column);
  }

  assert.match(
    contractSql,
    /SET @gsc_unique_target := 'analytics_account_id,report_date,query_hash'/,
  );
  model.indexes.set("uniq_gsc_queries_daily", "analytics_account_id,report_date,query_hash");

  assert.match(
    contractSql,
    /ADD INDEX idx_gsc_queries_daily_account_date \(analytics_account_id, report_date\)/,
  );
  assert.match(contractSql, /SET @gsc_index_target := 'analytics_account_id,report_date'/);
  model.indexes.set("idx_gsc_queries_daily_account_date", "analytics_account_id,report_date");
}

function signature(model: SchemaModel) {
  return JSON.stringify({
    columns: [...model.columns].sort(),
    nullable: [...model.nullable].sort(),
    indexes: [...model.indexes].sort(([left], [right]) => left.localeCompare(right)),
  });
}

test("GSC migrations 034 through 038 build the active canonical schema and repeat safely", () => {
  const fresh = schemaFrom034();
  apply037(fresh);
  const freshSignature = signature(fresh);
  apply037(fresh);
  assert.equal(signature(fresh), freshSignature);

  for (const column of activeColumns) assert.ok(fresh.columns.has(column));
  for (const column of legacyColumns) assert.ok(fresh.nullable.has(column));
  assert.equal(fresh.indexes.get("uniq_gsc_queries_daily"), "analytics_account_id,report_date,query_hash");
  assert.equal(fresh.indexes.get("idx_gsc_queries_daily_account_date"), "analytics_account_id,report_date");

  const old = schemaFrom034();
  old.indexes.set("idx_gsc_queries_daily_account_date", "report_date");
  const legacyRow = { property_url: "https://zaruku.ru/", device_type: "ALL", query_text: "заруку" };
  apply037(old);
  assert.equal(old.indexes.get("idx_gsc_queries_daily_account_date"), "analytics_account_id,report_date");
  const oldSignature = signature(old);
  apply037(old);
  assert.equal(signature(old), oldSignature);
  assert.deepEqual(legacyRow, {
    property_url: "https://zaruku.ru/",
    device_type: "ALL",
    query_text: "заруку",
  });

  assert.equal((optionalSql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length, 2);
});
