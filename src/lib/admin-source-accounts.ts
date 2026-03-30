import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { listSchemaMetas } from "@/lib/schema-registry";
import type {
  SourceAccountCollectionRow,
  SourceAccountCollectionSettingInput,
  SourceCollectionMode,
} from "@/lib/admin-ui-types";

type SqlSourceAccountCollectionRow = RowDataPacket & {
  source_key: string;
  platform_account_id: string;
  account_name: string | null;
  base_is_active: number | boolean | null;
  settings_is_active: number | boolean | null;
  settings_cron_enabled: number | boolean | null;
  settings_collection_mode: string | null;
  settings_exists: number | boolean | null;
  last_run_status: "running" | "success" | "partial" | "failed" | null;
  last_run_at: string | Date | null;
  latest_data_date: string | Date | null;
};

const YANDEX_METRIKA_COLLECTION_MODES: SourceCollectionMode[] = [
  "ads_only",
  "ads_plus_seo",
  "ads_plus_seo_plus_user_behavior",
];

function supportsCollectionMode(sourceKey: string): boolean {
  return sourceKey === "yandex_metrika";
}

function normalizeMode(sourceKey: string, mode: unknown): SourceCollectionMode | null {
  if (!supportsCollectionMode(sourceKey)) {
    return null;
  }
  if (typeof mode === "string" && YANDEX_METRIKA_COLLECTION_MODES.includes(mode as SourceCollectionMode)) {
    return mode as SourceCollectionMode;
  }
  return "ads_only";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "0" && value.toLowerCase() !== "false";
  return fallback;
}

function toIsoDateOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19);
  }
  const text = String(value).trim();
  return text || null;
}

export async function listSourceAccountCollectionRows(): Promise<SourceAccountCollectionRow[]> {
  const schemaMetaMap = new Map(listSchemaMetas().map((meta) => [meta.source_key, meta.display_name]));

  const sql = `
    WITH base_accounts_raw AS (
      SELECT
        a.source_key,
        a.platform_account_id,
        CASE
          WHEN a.source_key = 'yandex_direct' THEN COALESCE(yn.name, NULLIF(a.account_name, ''), NULLIF(a.advertiser_name, ''), a.platform_account_id)
          ELSE COALESCE(NULLIF(a.account_name, ''), NULLIF(a.advertiser_name, ''), a.platform_account_id)
        END AS account_name,
        1 AS base_is_active,
        1 AS priority
      FROM canonical_source_accounts a
      LEFT JOIN yandex_names yn
        ON a.source_key = 'yandex_direct'
       AND CAST(SUBSTRING_INDEX(a.platform_account_id, '::', -1) AS UNSIGNED) = yn.campaign_id

      UNION ALL

      SELECT
        'yandex_metrika' AS source_key,
        CAST(n.counter_id AS CHAR) AS platform_account_id,
        COALESCE(NULLIF(CAST(n.name AS CHAR), ''), CAST(n.counter_id AS CHAR)) AS account_name,
        COALESCE(n.active, 1) AS base_is_active,
        1 AS priority
      FROM yandex_metrika_names n
      WHERE n.counter_id IS NOT NULL

      UNION ALL

      SELECT
        s.source_key,
        s.platform_account_id,
        s.platform_account_id AS account_name,
        1 AS base_is_active,
        9 AS priority
      FROM canonical_source_account_collection_settings s
    ),
    base_accounts AS (
      SELECT
        source_key,
        platform_account_id,
        account_name,
        base_is_active
      FROM (
        SELECT
          raw.*,
          ROW_NUMBER() OVER (
            PARTITION BY raw.source_key, raw.platform_account_id
            ORDER BY raw.priority ASC
          ) AS row_num
        FROM base_accounts_raw raw
      ) ranked
      WHERE row_num = 1
    )
    SELECT
      a.source_key,
      a.platform_account_id,
      a.account_name,
      a.base_is_active,
      s.is_active AS settings_is_active,
      s.cron_enabled AS settings_cron_enabled,
      s.collection_mode AS settings_collection_mode,
      CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS settings_exists,
      lr.status AS last_run_status,
      COALESCE(lr.finished_at, lr.started_at) AS last_run_at,
      ld.latest_data_date
    FROM base_accounts a
    LEFT JOIN canonical_source_account_collection_settings s
      ON s.source_key = a.source_key
     AND s.platform_account_id = a.platform_account_id
    LEFT JOIN (
      SELECT r.source_key, r.status, r.started_at, r.finished_at
      FROM canonical_collector_runs r
      INNER JOIN (
        SELECT source_key, MAX(id) AS max_id
        FROM canonical_collector_runs
        GROUP BY source_key
      ) latest
        ON latest.source_key = r.source_key
       AND latest.max_id = r.id
    ) lr
      ON lr.source_key = a.source_key
    LEFT JOIN (
      SELECT source_key, account_id, MAX(report_date) AS latest_data_date
      FROM (
        SELECT source_key, platform_account_id AS account_id, report_date
        FROM canonical_fact_ads_daily
        UNION ALL
        SELECT source_key, analytics_account_id AS account_id, report_date
        FROM canonical_fact_site_analytics_daily
        UNION ALL
        SELECT source_key, platform_account_id AS account_id, report_date
        FROM canonical_fact_promopages_daily
      ) fact_dates
      GROUP BY source_key, account_id
    ) ld
      ON ld.source_key = a.source_key
     AND ld.account_id = a.platform_account_id
    ORDER BY a.source_key, account_name, a.platform_account_id
  `;

  const [rows] = await pool.query<SqlSourceAccountCollectionRow[]>(sql);
  return rows.map((row) => {
    const sourceKey = String(row.source_key);
    const collectionModeSupported = supportsCollectionMode(sourceKey);
    return {
      source_key: sourceKey,
      source_label: schemaMetaMap.get(sourceKey) ?? sourceKey,
      platform_account_id: String(row.platform_account_id),
      account_name: String(row.account_name ?? row.platform_account_id),
      is_active: asBoolean(
        row.settings_is_active,
        sourceKey === "yandex_metrika" ? asBoolean(row.base_is_active, true) : true,
      ),
      cron_enabled: asBoolean(row.settings_cron_enabled, true),
      collection_mode: collectionModeSupported ? normalizeMode(sourceKey, row.settings_collection_mode) : null,
      collection_mode_supported: collectionModeSupported,
      settings_exists: asBoolean(row.settings_exists, false),
      last_run_at: toIsoDateOrNull(row.last_run_at),
      last_run_status: row.last_run_status ?? null,
      latest_data_date: toIsoDateOrNull(row.latest_data_date)?.slice(0, 10) ?? null,
    };
  });
}

export async function saveSourceAccountCollectionSettings(
  inputs: SourceAccountCollectionSettingInput[],
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const rawInput of inputs) {
      const sourceKey = String(rawInput.source_key ?? "").trim();
      const platformAccountId = String(rawInput.platform_account_id ?? "").trim();
      if (!sourceKey || !platformAccountId) {
        continue;
      }
      const isActive = rawInput.is_active ? 1 : 0;
      const cronEnabled = rawInput.cron_enabled ? 1 : 0;
      const collectionMode = normalizeMode(sourceKey, rawInput.collection_mode);
      await connection.execute(
        `
          INSERT INTO canonical_source_account_collection_settings (
            source_key,
            platform_account_id,
            is_active,
            cron_enabled,
            collection_mode
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            is_active = VALUES(is_active),
            cron_enabled = VALUES(cron_enabled),
            collection_mode = VALUES(collection_mode),
            updated_at = CURRENT_TIMESTAMP
        `,
        [sourceKey, platformAccountId, isActive, cronEnabled, collectionMode],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
