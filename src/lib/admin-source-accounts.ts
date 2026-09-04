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
  timezone_name: string | null;
  expected_hour_local: number | null;
  source_delay_days: number | null;
  allowed_lag_days: number | null;
  lookback_days: number | null;
  latest_published_date: string | Date | null;
  missing_dates_csv: string | null;
  unbound_campaign_count: number | null;
};

type SqlCoverageRow = RowDataPacket & {
  source_key: string;
  platform_account_id: string;
  report_date: string | Date;
  coverage_state: SourceAccountCollectionRow["coverage_state"];
  rows_received: number | null;
  rows_rejected: number | null;
  rows_published: number | null;
  validation_error_count: number | null;
};

type AdvertisingSchedulePolicy = {
  timezone_name: string;
  expected_hour_local: number;
  source_delay_days: number;
  allowed_lag_days: number;
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

function calendarDate(parts: Record<string, number>, daysDelta: number): string {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysDelta));
  return value.toISOString().slice(0, 10);
}

export function calculateLatestDueDate(now: Date, policy: AdvertisingSchedulePolicy): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.timezone_name,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const local = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const beforeExpectedHour = local.hour < policy.expected_hour_local;
  const lag = policy.source_delay_days + policy.allowed_lag_days + (beforeExpectedHour ? 1 : 0);
  return calendarDate(local, -lag);
}

export function discoveryModeForSource(sourceKey: string): string {
  const modes: Record<string, string> = {
    between: "gmail_label",
    hybrid: "api_discovery",
    vk_ads_v2: "credential_registry",
    getintent: "api_configured",
    google_ads: "api_configured",
    linkedin: "api_configured",
    reddit: "api_configured",
    yandex_direct: "api_configured",
    yandex_direct_api_shadow: "api_configured",
  };
  return modes[sourceKey] ?? "registry";
}

function coverageKey(sourceKey: string, accountId: string, reportDate: string): string {
  return `${sourceKey}\u0000${accountId}\u0000${reportDate}`;
}

function csvDates(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
}

export function mapSourceAccountCollectionRows(
  rows: Array<SqlSourceAccountCollectionRow | Record<string, unknown>>,
  coverageByScope: Map<string, SqlCoverageRow | Record<string, unknown>>,
  now: Date,
  schemaMetaMap: Map<string, string>,
): SourceAccountCollectionRow[] {
  return rows.map((rawRow) => {
    const row = rawRow as SqlSourceAccountCollectionRow;
    const sourceKey = String(row.source_key);
    const accountId = String(row.platform_account_id);
    const collectionModeSupported = supportsCollectionMode(sourceKey);
    const isActive = asBoolean(
      row.settings_is_active,
      sourceKey === "yandex_metrika" ? asBoolean(row.base_is_active, true) : true,
    );
    const cronEnabled = asBoolean(row.settings_cron_enabled, true);
    const hasSchedule = Boolean(row.timezone_name) && row.expected_hour_local !== null;
    const latestDueDate = hasSchedule
      ? calculateLatestDueDate(now, {
          timezone_name: String(row.timezone_name),
          expected_hour_local: Number(row.expected_hour_local),
          source_delay_days: Number(row.source_delay_days ?? 1),
          allowed_lag_days: Number(row.allowed_lag_days ?? 0),
        })
      : null;
    const coverage = latestDueDate
      ? coverageByScope.get(coverageKey(sourceKey, accountId, latestDueDate))
      : undefined;
    const coverageState = (coverage?.coverage_state ?? null) as SourceAccountCollectionRow["coverage_state"];
    const rowsRejected = Number(coverage?.rows_rejected ?? 0);
    const validationErrors = Number(coverage?.validation_error_count ?? 0);
    const unboundCampaigns = Number(row.unbound_campaign_count ?? 0);
    const accepted = coverageState === "complete_with_data" || coverageState === "complete_empty";
    let healthStatus: SourceAccountCollectionRow["health_status"] = null;
    let healthReason: string | null = hasSchedule ? "missing_due_coverage" : null;
    if (hasSchedule && (!isActive || !cronEnabled)) {
      healthStatus = "DISABLED";
      healthReason = "collection_disabled";
    } else if (hasSchedule && (coverageState === "failed" || row.last_run_status === "failed")) {
      healthStatus = "CRITICAL";
      healthReason = "collection_failed";
    } else if (hasSchedule && !accepted) {
      healthStatus = "CRITICAL";
      healthReason = "missing_due_coverage";
    } else if (hasSchedule && (rowsRejected > 0 || validationErrors > 0)) {
      healthStatus = "WARN";
      healthReason = "validation_rejections";
    } else if (hasSchedule && unboundCampaigns > 0) {
      healthStatus = "WARN";
      healthReason = "unbound_campaigns";
    } else if (hasSchedule) {
      healthStatus = "OK";
      healthReason = coverageState;
    }

    const missingDates = csvDates(row.missing_dates_csv);
    if (healthReason === "missing_due_coverage" && latestDueDate && !missingDates.includes(latestDueDate)) {
      missingDates.push(latestDueDate);
      missingDates.sort();
    }
    return {
      source_key: sourceKey,
      source_label: schemaMetaMap.get(sourceKey) ?? sourceKey,
      platform_account_id: accountId,
      account_name: String(row.account_name ?? row.platform_account_id),
      is_active: isActive,
      cron_enabled: cronEnabled,
      collection_mode: collectionModeSupported ? normalizeMode(sourceKey, row.settings_collection_mode) : null,
      collection_mode_supported: collectionModeSupported,
      settings_exists: asBoolean(row.settings_exists, false),
      last_run_at: toIsoDateOrNull(row.last_run_at),
      last_run_status: row.last_run_status ?? null,
      latest_data_date: toIsoDateOrNull(row.latest_data_date)?.slice(0, 10) ?? null,
      discovery_mode: discoveryModeForSource(sourceKey),
      health_status: healthStatus,
      health_reason: healthReason,
      latest_due_date: latestDueDate,
      latest_published_date: toIsoDateOrNull(row.latest_published_date)?.slice(0, 10) ?? null,
      coverage_state: coverageState,
      missing_dates: missingDates,
      rows_received: Number(coverage?.rows_received ?? 0),
      rows_rejected: rowsRejected,
      rows_published: Number(coverage?.rows_published ?? 0),
      validation_error_count: validationErrors,
      unbound_campaign_count: unboundCampaigns,
    };
  });
}

export async function listSourceAccountCollectionRows(): Promise<SourceAccountCollectionRow[]> {
  const schemaMetaMap = new Map(listSchemaMetas().map((meta) => [meta.source_key, meta.display_name]));

  const sql = `
    WITH base_accounts_raw AS (
      SELECT
        a.source_key,
        a.platform_account_id,
        CASE
          WHEN a.source_key = 'yandex_direct' THEN COALESCE(yc.campaign_name, NULLIF(a.account_name, ''), NULLIF(a.advertiser_name, ''), a.platform_account_id)
          ELSE COALESCE(NULLIF(a.account_name, ''), NULLIF(a.advertiser_name, ''), a.platform_account_id)
        END AS account_name,
        1 AS base_is_active,
        1 AS priority
      FROM canonical_source_accounts a
      LEFT JOIN (
        SELECT
          source_key,
          platform_account_id,
          MAX(NULLIF(campaign_name, '')) AS campaign_name
        FROM canonical_source_campaigns
        WHERE source_key = 'yandex_direct'
        GROUP BY source_key, platform_account_id
      ) yc
        ON a.source_key = 'yandex_direct'
       AND yc.source_key = a.source_key
       AND yc.platform_account_id = a.platform_account_id

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
      ld.latest_data_date,
      policy.timezone_name,
      policy.expected_hour_local,
      policy.source_delay_days,
      policy.allowed_lag_days,
      policy.lookback_days,
      coverage_summary.latest_published_date,
      coverage_summary.missing_dates_csv,
      COALESCE(unbound.unbound_campaign_count, 0) AS unbound_campaign_count
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
    LEFT JOIN canonical_ad_source_schedule_policies policy
      ON policy.source_key = a.source_key
     AND policy.platform_account_id = a.platform_account_id
    LEFT JOIN (
      SELECT
        source_key,
        platform_account_id,
        MAX(CASE
          WHEN coverage_state IN ('complete_with_data', 'complete_empty') THEN report_date
          ELSE NULL
        END) AS latest_published_date,
        GROUP_CONCAT(CASE
          WHEN coverage_state IN ('missing', 'failed') THEN DATE_FORMAT(report_date, '%Y-%m-%d')
          ELSE NULL
        END ORDER BY report_date SEPARATOR ',') AS missing_dates_csv
      FROM canonical_ad_coverage_daily
      GROUP BY source_key, platform_account_id
    ) coverage_summary
      ON coverage_summary.source_key = a.source_key
     AND coverage_summary.platform_account_id = a.platform_account_id
    LEFT JOIN (
      SELECT campaigns.source_key, campaigns.platform_account_id, COUNT(*) AS unbound_campaign_count
      FROM canonical_source_campaigns campaigns
      WHERE NOT EXISTS (
        SELECT 1 FROM media_plan_bindings bindings
        WHERE bindings.canonical_campaign_id = campaigns.id
      )
      GROUP BY campaigns.source_key, campaigns.platform_account_id
    ) unbound
      ON unbound.source_key = a.source_key
     AND unbound.platform_account_id = a.platform_account_id
    ORDER BY a.source_key, account_name, a.platform_account_id
  `;

  const [rows] = await pool.query<SqlSourceAccountCollectionRow[]>(sql);
  const now = new Date();
  const dueScopes = rows.flatMap((row) => {
    if (!row.timezone_name || row.expected_hour_local === null) return [];
    const reportDate = calculateLatestDueDate(now, {
      timezone_name: row.timezone_name,
      expected_hour_local: Number(row.expected_hour_local),
      source_delay_days: Number(row.source_delay_days ?? 1),
      allowed_lag_days: Number(row.allowed_lag_days ?? 0),
    });
    return [{ sourceKey: String(row.source_key), accountId: String(row.platform_account_id), reportDate }];
  });
  const coverageByScope = new Map<string, SqlCoverageRow>();
  if (dueScopes.length > 0) {
    const predicates = dueScopes.map(() => "(coverage.source_key = ? AND coverage.platform_account_id = ? AND coverage.report_date = ?)");
    const params = dueScopes.flatMap((scope) => [scope.sourceKey, scope.accountId, scope.reportDate]);
    const [coverageRows] = await pool.query<SqlCoverageRow[]>(
      `
        SELECT
          coverage.source_key,
          coverage.platform_account_id,
          coverage.report_date,
          coverage.coverage_state,
          coverage.rows_received,
          coverage.rows_rejected,
          coverage.rows_published,
          COALESCE(validation.validation_error_count, 0) AS validation_error_count
        FROM canonical_ad_coverage_daily coverage
        LEFT JOIN (
          SELECT publication_id, COUNT(*) AS validation_error_count
          FROM canonical_ad_validation_issues
          WHERE severity = 'error'
          GROUP BY publication_id
        ) validation
          ON validation.publication_id = coverage.publication_id
        WHERE ${predicates.join(" OR ")}
      `,
      params,
    );
    for (const coverage of coverageRows) {
      const reportDate = toIsoDateOrNull(coverage.report_date)?.slice(0, 10) ?? "";
      coverageByScope.set(
        coverageKey(String(coverage.source_key), String(coverage.platform_account_id), reportDate),
        coverage,
      );
    }
  }
  return mapSourceAccountCollectionRows(rows, coverageByScope, now, schemaMetaMap);
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
