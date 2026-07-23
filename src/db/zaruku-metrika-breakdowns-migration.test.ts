import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = readFileSync(
  path.resolve("src/db/migrations/043_zaruku_metrika_breakdowns_daily.sql"),
  "utf8",
);

function tableBody(tableName: string) {
  const match = sql.match(
    new RegExp(
      `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\)\\s+ENGINE=`,
      "i",
    ),
  );
  assert.ok(match, `${tableName} must use CREATE TABLE IF NOT EXISTS`);
  return match[1];
}

function keyColumns(tableSql: string, keyName: string) {
  const match = tableSql.match(
    new RegExp(`(?:UNIQUE\\s+)?KEY\\s+${keyName}\\s*\\(([^)]+)\\)`, "i"),
  );
  assert.ok(match, `${keyName} must be declared`);
  return match[1].split(",").map((column) => column.trim());
}

test("migration 043 defines the complete Metrika breakdown and coverage schema", () => {
  const breakdownSql = tableBody("canonical_fact_metrika_breakdowns_daily");
  const coverageSql = tableBody(
    "canonical_metrika_breakdown_coverage_daily",
  );

  assert.match(breakdownSql, /source_key VARCHAR\(64\) NOT NULL/);
  assert.match(breakdownSql, /analytics_account_id VARCHAR\(128\) NOT NULL/);
  assert.match(breakdownSql, /report_date DATE NOT NULL/);
  assert.match(breakdownSql, /report_key VARCHAR\(64\) NOT NULL/);
  assert.match(
    breakdownSql,
    /segment_key VARCHAR\(64\) NOT NULL DEFAULT 'russia'/,
  );
  assert.match(
    breakdownSql,
    /row_kind ENUM\('detail', 'total'\) NOT NULL DEFAULT 'detail'/,
  );
  assert.match(breakdownSql, /dimension_1_key VARCHAR\(64\)/);
  assert.match(breakdownSql, /dimension_1_id VARCHAR\(255\)/);
  assert.match(breakdownSql, /dimension_1_value TEXT/);
  assert.match(breakdownSql, /dimension_2_key VARCHAR\(64\)/);
  assert.match(breakdownSql, /dimension_2_id VARCHAR\(255\)/);
  assert.match(breakdownSql, /dimension_2_value TEXT/);
  assert.match(breakdownSql, /page_url TEXT/);
  assert.match(breakdownSql, /dimension_hash CHAR\(64\) NOT NULL/);
  assert.match(breakdownSql, /visits BIGINT/);
  assert.match(breakdownSql, /users BIGINT/);
  assert.match(breakdownSql, /new_users BIGINT/);
  assert.match(breakdownSql, /pageviews BIGINT/);
  assert.match(breakdownSql, /bounce_rate DECIMAL\(18,6\)/);
  assert.match(breakdownSql, /avg_visit_duration_seconds DECIMAL\(18,6\)/);
  assert.match(breakdownSql, /page_depth DECIMAL\(18,6\)/);
  assert.match(breakdownSql, /ingestion_run_id BIGINT DEFAULT NULL/);
  assert.match(
    breakdownSql,
    /created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP/,
  );
  assert.match(
    breakdownSql,
    /updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/,
  );

  assert.deepEqual(
    keyColumns(breakdownSql, "uniq_metrika_breakdown_daily"),
    [
      "source_key",
      "analytics_account_id",
      "report_date",
      "report_key",
      "segment_key",
      "row_kind",
      "dimension_hash",
    ],
  );
  assert.deepEqual(
    keyColumns(breakdownSql, "idx_metrika_breakdown_read"),
    [
      "analytics_account_id",
      "report_key",
      "segment_key",
      "report_date",
    ],
  );

  assert.match(coverageSql, /source_key VARCHAR\(64\) NOT NULL/);
  assert.match(coverageSql, /analytics_account_id VARCHAR\(128\) NOT NULL/);
  assert.match(coverageSql, /report_date DATE NOT NULL/);
  assert.match(coverageSql, /report_key VARCHAR\(64\) NOT NULL/);
  assert.match(
    coverageSql,
    /segment_key VARCHAR\(64\) NOT NULL DEFAULT 'russia'/,
  );
  assert.match(coverageSql, /status ENUM\('success', 'empty'\) NOT NULL/);
  assert.match(
    coverageSql,
    /api_total_rows BIGINT UNSIGNED NOT NULL DEFAULT 0/,
  );
  assert.match(
    coverageSql,
    /persisted_rows BIGINT UNSIGNED NOT NULL DEFAULT 0/,
  );
  assert.match(
    coverageSql,
    /pagination_complete TINYINT\(1\) NOT NULL DEFAULT 0/,
  );
  assert.match(coverageSql, /ingestion_run_id BIGINT DEFAULT NULL/);
  assert.match(
    coverageSql,
    /created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP/,
  );
  assert.match(
    coverageSql,
    /updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/,
  );
  assert.deepEqual(
    keyColumns(coverageSql, "uniq_metrika_breakdown_coverage_daily"),
    [
      "source_key",
      "analytics_account_id",
      "report_date",
      "report_key",
      "segment_key",
    ],
  );
  assert.deepEqual(
    keyColumns(coverageSql, "idx_metrika_breakdown_coverage_read"),
    [
      "analytics_account_id",
      "report_key",
      "segment_key",
      "report_date",
    ],
  );

  assert.doesNotMatch(sql, /canonical_fact_metrika_[a-z0-9_]*_release/i);
  assert.doesNotMatch(sql, /report_bd_private/i);
});

test("migration 043 repairs mismatched compatibility indexes on replay", () => {
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /COLUMN_TYPE LIKE '%''entry_page''%'/i);
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.match(
    sql,
    /GROUP_CONCAT\(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','\)/i,
  );
  assert.match(sql, /MIN\(NON_UNIQUE\)/i);

  assert.match(
    sql,
    /@site_scope_read_index_target\s*:=\s*'source_key,analytics_account_id,analytics_scope,report_date'/i,
  );
  assert.match(
    sql,
    /COALESCE\(@site_scope_read_index_columns, ''\)\s*=\s*@site_scope_read_index_target[\s\S]*?COALESCE\(@site_scope_read_index_non_unique, 0\)\s*=\s*1/i,
  );
  assert.match(
    sql,
    /DROP INDEX idx_site_analytics_scope_read,\s*ADD KEY idx_site_analytics_scope_read \(source_key, analytics_account_id, analytics_scope, report_date\)/i,
  );
  assert.match(
    sql,
    /@gsc_country_date_index_target\s*:=\s*'analytics_account_id,country,report_date'/i,
  );
  assert.match(
    sql,
    /COALESCE\(@gsc_country_date_index_columns, ''\)\s*=\s*@gsc_country_date_index_target[\s\S]*?COALESCE\(@gsc_country_date_index_non_unique, 0\)\s*=\s*1/i,
  );
  assert.match(
    sql,
    /DROP INDEX idx_gsc_country_date,\s*ADD KEY idx_gsc_country_date \(analytics_account_id, country, report_date\)/i,
  );

  assert.ok(
    (sql.match(/PREPARE stmt FROM @sql/gi) ?? []).length >= 3,
    "every guarded compatibility change must use conditional prepared SQL",
  );
});
