import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { splitMigrationStatements } from "../src/db/run-migration";

const migrationPath = "src/db/migrations/056_advertising_ingestion_foundation.sql";

async function expectReject(operation: () => Promise<unknown>) {
  await assert.rejects(operation);
}

async function main() {
  const databaseUrl = process.env.ADVERTISING_INGESTION_MIGRATION_TEST_URL;
  if (!databaseUrl) {
    throw new Error("ADVERTISING_INGESTION_MIGRATION_TEST_URL is required for the local MySQL verifier");
  }

  const parsedDatabaseUrl = new URL(databaseUrl);
  const connection = await mysql.createConnection({
    host: parsedDatabaseUrl.hostname,
    port: Number(parsedDatabaseUrl.port || 3306),
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)),
    multipleStatements: true,
  });
  try {
    await connection.query(`
      CREATE TABLE canonical_collector_runs (
        id BIGINT NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE canonical_source_accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        source_key VARCHAR(64) NOT NULL,
        platform_account_id VARCHAR(128) NOT NULL,
        UNIQUE KEY uniq_canonical_source_accounts (source_key, platform_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query(`
      CREATE TABLE canonical_source_campaigns (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        source_key VARCHAR(64) NOT NULL,
        platform_account_id VARCHAR(128) NOT NULL,
        platform_campaign_id VARCHAR(128) NOT NULL,
        UNIQUE KEY uniq_canonical_source_campaigns (source_key, platform_account_id, platform_campaign_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query("INSERT INTO canonical_collector_runs (id) VALUES (1), (2), (3)");
    await connection.query(`
      INSERT INTO canonical_source_accounts (source_key, platform_account_id)
      VALUES ('test_source', 'account_a'), ('test_source', 'account_b')
    `);
    await connection.query(`
      INSERT INTO canonical_source_campaigns (source_key, platform_account_id, platform_campaign_id)
      VALUES ('test_source', 'account_a', 'campaign_a')
    `);

    const migration = readFileSync(migrationPath, "utf8");
    for (let replay = 0; replay < 2; replay += 1) {
      for (const statement of splitMigrationStatements(migration)) {
        await connection.query(statement);
      }
    }

    await connection.query(`
      INSERT INTO canonical_ad_publications
        (id, ingestion_run_id, source_key, platform_account_id, report_date, publication_mode, ordering_policy, received_at, status, is_active, published_at)
      VALUES (1, 1, 'test_source', 'account_a', '2026-08-01', 'incremental', 'revision', UTC_TIMESTAMP(), 'published', 1, '2026-08-02 03:04:05')
    `);
    const [policyRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT ordering_policy FROM canonical_ad_publications WHERE id = 1
    `);
    assert.deepEqual(policyRows.map((row) => row.ordering_policy), ['revision']);
    await expectReject(() => connection.query(`
      INSERT INTO canonical_ad_publications
        (ingestion_run_id, source_key, platform_account_id, report_date, publication_mode, received_at, status, is_active)
      VALUES (1, 'test_source', 'account_a', '2026-08-02', 'incremental', UTC_TIMESTAMP(), 'staged', 1)
    `));
    await expectReject(() => connection.query(`
      INSERT INTO canonical_ad_publications
        (ingestion_run_id, source_key, platform_account_id, report_date, publication_mode, ordering_policy, received_at, status, is_active)
      VALUES (1, 'test_source', 'account_a', '2026-08-03', 'incremental', 'revision', UTC_TIMESTAMP(), 'published', 0)
    `));
    await expectReject(() => connection.query(`
      INSERT INTO canonical_ad_publications
        (ingestion_run_id, source_key, platform_account_id, report_date, publication_mode, ordering_policy, received_at, status)
      VALUES (99, 'test_source', 'account_a', '2026-08-04', 'incremental', 'revision', UTC_TIMESTAMP(), 'staged')
    `));

    await connection.query(`
      INSERT INTO canonical_ad_fact_versions_daily
        (publication_id, source_key, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id, report_date, ingestion_run_id)
      VALUES (1, 'test_source', 'account_a', 'campaign_a', 'delivery_entity', 'ad', 'default', 'delivery_a', 'creative_a', '2026-08-01', 1)
    `);
    await connection.query(`
      INSERT INTO canonical_ad_fact_versions_daily
        (publication_id, source_key, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id, report_date, ingestion_run_id)
      VALUES (1, 'test_source', 'account_a', 'campaign_a', 'delivery_entity', 'banner', 'default', 'delivery_a', 'creative_a', '2026-08-01', 1)
    `);
    await expectReject(() => connection.query(`
      INSERT INTO canonical_ad_fact_versions_daily
        (publication_id, source_key, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id, report_date, ingestion_run_id)
      VALUES (1, 'test_source', 'account_a', 'campaign_a', 'delivery_entity', 'creative', 'default', 'delivery_b', 'creative_b', '2026-08-02', 1)
    `));

    await expectReject(() => connection.query(`
      INSERT INTO canonical_ad_coverage_daily
        (source_key, platform_account_id, report_date, coverage_state, ingestion_run_id, publication_id)
      VALUES ('test_source', 'account_b', '2026-08-01', 'complete_with_data', 1, 1)
    `));
    await connection.query(`
      INSERT INTO canonical_ad_coverage_daily
        (source_key, platform_account_id, report_date, coverage_state, ingestion_run_id, publication_id)
      VALUES ('test_source', 'account_a', '2026-08-01', 'complete_with_data', 1, 1)
    `);
    await expectReject(() => connection.query(
      "UPDATE canonical_ad_publications SET is_active = NULL WHERE id = 1",
    ));

    await connection.query(`
      INSERT INTO canonical_ad_publications
        (id, ingestion_run_id, source_key, platform_account_id, report_date, publication_mode, ordering_policy, received_at, status, is_active, supersedes_publication_id, published_at)
      VALUES (2, 2, 'test_source', 'account_a', '2026-08-01', 'incremental', 'revision', UTC_TIMESTAMP(), 'validated', NULL, 1, NULL)
    `);
    await connection.query(`
      INSERT INTO canonical_ad_fact_versions_daily
        (publication_id, source_key, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id, report_date, ingestion_run_id)
      VALUES (2, 'test_source', 'account_a', 'campaign_a', 'delivery_entity', 'creative', 'default', 'delivery_b', 'creative_b', '2026-08-01', 2)
    `);

    await connection.beginTransaction();
    await connection.query("UPDATE canonical_ad_coverage_daily SET publication_id = NULL WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND report_date = '2026-08-01'");
    await connection.query("UPDATE canonical_ad_publications SET status = 'superseded', is_active = NULL WHERE id = 1");
    await connection.query("UPDATE canonical_ad_publications SET status = 'published', is_active = 1, published_at = UTC_TIMESTAMP() WHERE id = 2");
    await connection.query("UPDATE canonical_ad_coverage_daily SET publication_id = 2, ingestion_run_id = 2 WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND report_date = '2026-08-01'");
    await connection.query(`
      INSERT INTO canonical_ad_publication_activations
        (publication_id, previous_publication_id, source_key, platform_account_id, report_date, collector_run_id, actor, reason, activated_at)
      VALUES (2, 1, 'test_source', 'account_a', '2026-08-01', 2, 'collector', 'successor publication', UTC_TIMESTAMP())
    `);
    await connection.commit();

    const [successorCoverageRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT publication_id FROM canonical_ad_coverage_daily
      WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND report_date = '2026-08-01'
    `);
    assert.deepEqual(successorCoverageRows.map((row) => row.publication_id), [2]);

    await connection.beginTransaction();
    await connection.query("UPDATE canonical_ad_coverage_daily SET publication_id = NULL WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND report_date = '2026-08-01'");
    await connection.query("UPDATE canonical_ad_publications SET status = 'superseded', is_active = NULL WHERE id = 2");
    await connection.query("UPDATE canonical_ad_publications SET status = 'published', is_active = 1, published_at = UTC_TIMESTAMP() WHERE id = 1");
    await connection.query("UPDATE canonical_ad_coverage_daily SET publication_id = 1, ingestion_run_id = 3 WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND report_date = '2026-08-01'");
    await connection.query(`
      INSERT INTO canonical_ad_publication_activations
        (publication_id, previous_publication_id, source_key, platform_account_id, report_date, collector_run_id, actor, reason, activated_at)
      VALUES (1, 2, 'test_source', 'account_a', '2026-08-01', 3, 'operator', 'historical rollback', UTC_TIMESTAMP())
    `);
    await connection.commit();

    const [activationRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT publication_id, previous_publication_id, actor, reason
      FROM canonical_ad_publication_activations
      ORDER BY id
    `);
    assert.deepEqual(activationRows, [
      { publication_id: 2, previous_publication_id: 1, actor: 'collector', reason: 'successor publication' },
      { publication_id: 1, previous_publication_id: 2, actor: 'operator', reason: 'historical rollback' },
    ]);
    await expectReject(() => connection.query("UPDATE canonical_ad_publication_activations SET actor = 'other' WHERE id = 1"));
    await expectReject(() => connection.query("DELETE FROM canonical_ad_publication_activations WHERE id = 1"));

    const [reactivatedPublicationRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:%s') AS published_at
      FROM canonical_ad_publications WHERE id = 1
    `);
    assert.deepEqual(reactivatedPublicationRows.map((row) => row.published_at), ['2026-08-02 03:04:05']);

    const [currentRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT native_grain FROM canonical_advertising_facts_current ORDER BY native_grain
    `);
    assert.deepEqual(currentRows.map((row) => row.native_grain), ["ad", "banner"]);
    await expectReject(() => connection.query("DELETE FROM canonical_collector_runs WHERE id = 1"));
    await expectReject(() => connection.query(`
      DELETE FROM canonical_source_campaigns
      WHERE source_key = 'test_source' AND platform_account_id = 'account_a' AND platform_campaign_id = 'campaign_a'
    `));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
