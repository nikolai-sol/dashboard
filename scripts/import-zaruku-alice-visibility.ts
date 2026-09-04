#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import {
  parseAliceVisibilityWorkbook,
  type ParsedAliceVisibilitySnapshot,
} from "../src/lib/zaruku-alice-visibility-import";

type QueryResult = readonly [unknown, unknown];

export interface AliceVisibilityImportConnection {
  beginTransaction(): Promise<unknown>;
  execute(sql: string, params?: readonly unknown[]): Promise<QueryResult>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
}

export type AliceVisibilityPersistableSnapshot = Pick<
  ParsedAliceVisibilitySnapshot,
  "accountId" | "portalDomain" | "period" | "officialSovPct" | "capturedAt" | "sourceSha256" | "queries" | "sources" | "featured"
> & {
  sourceFilename: string | null;
  exportedQueryCount: number | null;
  portalPresentQueryCount: number | null;
  samplePresencePct: number | null;
};

export type AliceVisibilityPersistOptions = {
  supersedeSnapshotId?: number;
  sourceKey?: string;
  ingestionRunId?: string;
  sourcePayloadJson?: Record<string, unknown>;
};

export type AliceVisibilityPersistResult = "inserted" | "already_exists" | "superseded";

function rows(result: QueryResult): Array<Record<string, unknown>> {
  return Array.isArray(result[0]) ? result[0] as Array<Record<string, unknown>> : [];
}

function insertId(result: QueryResult): number {
  const id = Number((result[0] as { insertId?: unknown })?.insertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("База данных не вернула идентификатор вставленной строки");
  return id;
}

function mysqlDate(isoTimestamp: string): string {
  const match = isoTimestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error("captured-at должен быть ISO timestamp с датой, временем и timezone");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offset = timezone === "Z" ? null : timezone!.slice(1).split(":").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day || (offset && (offset[0]! > 23 || offset[1]! > 59))) {
    throw new Error("captured-at должен быть корректным ISO timestamp");
  }
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("captured-at должен быть ISO timestamp");
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function periodMonth(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("period должен иметь формат YYYY-MM");
  return `${period}-01`;
}

function validateSnapshot(snapshot: AliceVisibilityPersistableSnapshot): void {
  if (!/^[a-f0-9]{64}$/.test(snapshot.sourceSha256)) throw new Error("source_sha256 должен быть SHA-256");
  periodMonth(snapshot.period);
  mysqlDate(snapshot.capturedAt);
  if (!Number.isFinite(snapshot.officialSovPct) || snapshot.officialSovPct < 0 || snapshot.officialSovPct > 100) {
    throw new Error("official-sov должен быть от 0 до 100");
  }
  const queryHashes = new Set(snapshot.queries.map((query) => query.queryHash));
  if (queryHashes.size !== snapshot.queries.length) throw new Error("Повторяющиеся query_hash в snapshot");
  if (snapshot.exportedQueryCount !== null && snapshot.exportedQueryCount !== snapshot.queries.length) throw new Error("Количество queries не совпадает с snapshot");
  if (snapshot.portalPresentQueryCount !== null && snapshot.portalPresentQueryCount !== snapshot.queries.filter((query) => query.portalPresent).length) {
    throw new Error("Количество присутствующих queries не совпадает с snapshot");
  }
  if (snapshot.samplePresencePct !== null && (!Number.isFinite(snapshot.samplePresencePct) || snapshot.samplePresencePct < 0 || snapshot.samplePresencePct > 100)) {
    throw new Error("sample presence должен быть конечным числом от 0 до 100");
  }
  if (snapshot.queries.length > 0) {
    if (snapshot.exportedQueryCount === null || snapshot.portalPresentQueryCount === null || snapshot.samplePresencePct === null) {
      throw new Error("Детальный snapshot требует sample presence coverage");
    }
    const expectedSamplePresencePct = snapshot.portalPresentQueryCount / snapshot.exportedQueryCount * 100;
    if (Math.abs(snapshot.samplePresencePct - expectedSamplePresencePct) > 1e-9 * Math.max(1, Math.abs(expectedSamplePresencePct))) {
      throw new Error("sample presence не совпадает с query coverage");
    }
  }
  if (snapshot.queries.some((query) => !Number.isSafeInteger(query.sourceCount) || query.sourceCount < 0)) throw new Error("Некорректное количество источников query");
  if (snapshot.sources.some((source) => !queryHashes.has(source.queryHash))) throw new Error("Источник ссылается на отсутствующий query");
  const sourceCounts = new Map<string, number>();
  const sourceRanks = new Map<string, Set<number>>();
  for (const source of snapshot.sources) {
    if (!Number.isSafeInteger(source.sourceRank) || source.sourceRank < 1 || source.sourceRank > 10) throw new Error("source rank должен быть целым числом от 1 до 10");
    const ranks = sourceRanks.get(source.queryHash) ?? new Set<number>();
    if (ranks.has(source.sourceRank)) throw new Error("source rank повторяется в одном query");
    ranks.add(source.sourceRank);
    sourceRanks.set(source.queryHash, ranks);
    sourceCounts.set(source.queryHash, (sourceCounts.get(source.queryHash) ?? 0) + 1);
  }
  if (snapshot.queries.some((query) => (sourceCounts.get(query.queryHash) ?? 0) !== query.sourceCount)) throw new Error("Количество источников query не совпадает с snapshot");
  if (snapshot.featured.some((site, index) => site.displayOrder !== index + 1)) throw new Error("Порядок featured sites не является последовательным");
}

export async function persistAliceVisibilitySnapshot(
  connection: AliceVisibilityImportConnection,
  snapshot: AliceVisibilityPersistableSnapshot,
  options: AliceVisibilityPersistOptions,
): Promise<AliceVisibilityPersistResult> {
  validateSnapshot(snapshot);
  const sourceKey = options.sourceKey ?? "yandex_webmaster_alice_manual";
  const ingestionRunId = options.ingestionRunId ?? `alice-${snapshot.accountId}-${sourceKey}-${snapshot.sourceSha256}`;
  if (!sourceKey || sourceKey.length > 64 || ingestionRunId.length > 128) throw new Error("Некорректный идентификатор импорта");
  if (options.supersedeSnapshotId !== undefined && (!Number.isSafeInteger(options.supersedeSnapshotId) || options.supersedeSnapshotId <= 0)) {
    throw new Error("supersede-snapshot-id должен быть положительным целым числом");
  }

  await connection.beginTransaction();
  try {
    const sameChecksum = rows(await connection.execute(
      `SELECT id FROM canonical_alice_visibility_snapshots
       WHERE analytics_account_id = ? AND source_key = ? AND source_sha256 = ? FOR UPDATE`,
      [snapshot.accountId, sourceKey, snapshot.sourceSha256],
    ));
    if (sameChecksum.length > 1) throw new Error("Найдены конфликтующие snapshots с одинаковым checksum");
    if (sameChecksum.length === 1) {
      await connection.commit();
      return "already_exists";
    }

    const publishedForMonth = rows(await connection.execute(
      `SELECT id, source_sha256 FROM canonical_alice_visibility_snapshots
       WHERE analytics_account_id = ? AND period_month = ? AND publication_status = 'published' FOR UPDATE`,
      [snapshot.accountId, periodMonth(snapshot.period)],
    ));
    if (publishedForMonth.length > 1) throw new Error("Для периода найдено несколько опубликованных snapshots");
    const currentPublished = publishedForMonth[0];
    if (currentPublished && options.supersedeSnapshotId === undefined) throw new Error("Для этого месяца уже опубликован другой файл; укажите supersede-snapshot-id");
    if (currentPublished && Number(currentPublished.id) !== options.supersedeSnapshotId) throw new Error("supersede-snapshot-id не соответствует опубликованному snapshot");
    if (!currentPublished && options.supersedeSnapshotId !== undefined) throw new Error("Для supersede не найден опубликованный snapshot месяца");
    if (currentPublished) {
      await connection.execute(
        "UPDATE canonical_alice_visibility_snapshots SET publication_status = 'superseded' WHERE id = ? AND publication_status = 'published'",
        [options.supersedeSnapshotId],
      );
    }

    const snapshotResult = await connection.execute(
      `INSERT INTO canonical_alice_visibility_snapshots
       (source_key, analytics_account_id, domain, period_month, captured_at, official_sov_pct,
        exported_query_count, portal_present_query_count, sample_presence_pct, source_filename,
        source_sha256, publication_status, supersedes_snapshot_id, ingestion_run_id, source_payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
      [
        sourceKey, snapshot.accountId, snapshot.portalDomain, periodMonth(snapshot.period), mysqlDate(snapshot.capturedAt), snapshot.officialSovPct,
        snapshot.exportedQueryCount, snapshot.portalPresentQueryCount, snapshot.samplePresencePct, snapshot.sourceFilename,
        snapshot.sourceSha256, options.supersedeSnapshotId ?? null, ingestionRunId, options.sourcePayloadJson ? JSON.stringify(options.sourcePayloadJson) : null,
      ],
    );
    const snapshotId = insertId(snapshotResult);
    const queryIds = new Map<string, number>();
    for (const query of snapshot.queries) {
      const result = await connection.execute(
        `INSERT INTO canonical_alice_visibility_queries
         (snapshot_id, query_hash, query_text, portal_present, portal_position, portal_url, alice_answer_url, source_count, raw_present_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, query.queryHash, query.queryText, query.portalPresent ? 1 : 0, query.portalPosition, query.portalUrl, query.aliceAnswerUrl, query.sourceCount, query.rawPresentValue],
      );
      queryIds.set(query.queryHash, insertId(result));
    }
    for (const source of snapshot.sources) {
      await connection.execute(
        `INSERT INTO canonical_alice_visibility_sources
         (query_id, source_rank, source_url, source_domain, is_portal) VALUES (?, ?, ?, ?, ?)`,
        [queryIds.get(source.queryHash), source.sourceRank, source.sourceUrl, source.sourceDomain, source.isPortal ? 1 : 0],
      );
    }
    for (const site of snapshot.featured) {
      await connection.execute(
        `INSERT INTO canonical_alice_visibility_featured_sites
         (snapshot_id, display_order, site_url, site_domain) VALUES (?, ?, ?, ?)`,
        [snapshotId, site.displayOrder, site.siteUrl, site.siteDomain],
      );
    }
    const reconciliation = rows(await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM canonical_alice_visibility_queries WHERE snapshot_id = ?) AS query_count,
        (SELECT COUNT(*) FROM canonical_alice_visibility_sources source
          JOIN canonical_alice_visibility_queries q ON q.id = source.query_id WHERE q.snapshot_id = ?) AS source_count,
        (SELECT COUNT(*) FROM canonical_alice_visibility_queries WHERE snapshot_id = ? AND portal_present = 1) AS portal_present_count,
        (SELECT COUNT(*) FROM canonical_alice_visibility_featured_sites WHERE snapshot_id = ?) AS featured_count`,
      [snapshotId, snapshotId, snapshotId, snapshotId],
    ))[0];
    if (!reconciliation || Number(reconciliation.query_count) !== snapshot.queries.length || Number(reconciliation.source_count) !== snapshot.sources.length || Number(reconciliation.portal_present_count) !== snapshot.queries.filter((query) => query.portalPresent).length || Number(reconciliation.featured_count) !== snapshot.featured.length) {
      throw new Error("Post-write reconciliation Alice visibility snapshot failed");
    }
    await connection.commit();
    return currentPublished ? "superseded" : "inserted";
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original import error if rollback itself fails.
    }
    throw error;
  }
}

type CliOptions = {
  xlsxPath: string | null;
  period: string;
  officialSovPct: number;
  capturedAt: string;
  featuredSites: string[];
  accountId: string;
  domain: string;
  supersedeSnapshotId?: number;
  execute: boolean;
  summaryOnly: boolean;
  legacySource?: string;
  legacyMentions?: number;
  legacyCitations?: number;
};

export const ALICE_VISIBILITY_IMPORT_USAGE = `Usage:
  npm run import:zaruku-alice -- --xlsx /absolute/path/export.xlsx --period YYYY-MM --official-sov PERCENT --captured-at ISO_TIMESTAMP --dry-run
  npm run import:zaruku-alice -- --summary-only --period YYYY-MM --official-sov PERCENT --captured-at ISO_TIMESTAMP --legacy-source SOURCE --legacy-mentions COUNT --legacy-citations COUNT --dry-run

Use --execute only after a successful dry-run. The workbook path must be absolute.
`;

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} требует значение`);
  return value;
}

export function parseCliArgs(args: string[]): CliOptions {
  const result: Partial<CliOptions> & { featuredSites: string[] } = { featuredSites: [], execute: false, summaryOnly: false, accountId: "66624469", domain: "zaruku.ru" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--dry-run") result.execute = false;
    else if (flag === "--execute") result.execute = true;
    else if (flag === "--summary-only") result.summaryOnly = true;
    else if (flag === "--featured-site") { result.featuredSites.push(requiredValue(args, index, flag)); index += 1; }
    else if (flag === "--xlsx") { result.xlsxPath = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--period") { result.period = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--official-sov") { result.officialSovPct = Number(requiredValue(args, index, flag)); index += 1; }
    else if (flag === "--captured-at") { result.capturedAt = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--account-id") { result.accountId = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--domain") { result.domain = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--supersede-snapshot-id") { result.supersedeSnapshotId = Number(requiredValue(args, index, flag)); index += 1; }
    else if (flag === "--legacy-source") { result.legacySource = requiredValue(args, index, flag); index += 1; }
    else if (flag === "--legacy-mentions") { result.legacyMentions = Number(requiredValue(args, index, flag)); index += 1; }
    else if (flag === "--legacy-citations") { result.legacyCitations = Number(requiredValue(args, index, flag)); index += 1; }
    else throw new Error(`Неизвестный аргумент: ${flag}`);
  }
  if (!result.period || !Number.isFinite(result.officialSovPct) || !result.capturedAt) throw new Error("Требуются --period, --official-sov и --captured-at");
  if (result.summaryOnly) {
    const legacyMentions = result.legacyMentions;
    const legacyCitations = result.legacyCitations;
    if (result.xlsxPath || result.featuredSites.length > 0 || !result.legacySource || typeof legacyMentions !== "number" || typeof legacyCitations !== "number" || !Number.isSafeInteger(legacyMentions) || !Number.isSafeInteger(legacyCitations) || legacyMentions < 0 || legacyCitations < 0) {
      throw new Error("summary-only требует legacy-source, legacy-mentions и legacy-citations без XLSX или featured sites");
    }
  } else if (!result.xlsxPath || !path.isAbsolute(result.xlsxPath)) {
    throw new Error("--xlsx должен быть абсолютным путем");
  }
  return result as CliOptions;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createSummaryOnlySnapshot(options: CliOptions): { snapshot: AliceVisibilityPersistableSnapshot; sourcePayloadJson: Record<string, unknown>; sourceKey: string } {
  const legacyUnconfirmed = {
    definition: "unconfirmed",
    legacy_mentions: options.legacyMentions!,
    legacy_citations: options.legacyCitations!,
  };
  const sourcePayloadJson = { legacy_unconfirmed: legacyUnconfirmed, provenance: options.legacySource! };
  const checksumPayload = {
    account: options.accountId,
    portal: options.domain,
    period: options.period,
    official_sov: options.officialSovPct,
    provenance: options.legacySource!,
    metadata: sourcePayloadJson,
  };
  return {
    sourceKey: "yandex_webmaster_alice_manual",
    sourcePayloadJson,
    snapshot: {
      accountId: options.accountId,
      portalDomain: options.domain,
      period: options.period,
      officialSovPct: options.officialSovPct,
      capturedAt: options.capturedAt,
      sourceFilename: null,
      sourceSha256: createHash("sha256").update(stableJson(checksumPayload)).digest("hex"),
      exportedQueryCount: null,
      portalPresentQueryCount: null,
      samplePresencePct: null,
      queries: [],
      sources: [],
      featured: [],
    },
  };
}

function configuredConnection() {
  const host = process.env.DB_HOST ?? process.env.MYSQL_HOST;
  const port = Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306);
  const user = process.env.DB_USER ?? process.env.MYSQL_USER;
  const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD;
  const database = process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd";
  if (!host || !user || !password || !database) throw new Error("Missing DB connection env values");
  return mysql.createConnection({ host, port, user, password, database, charset: "utf8mb4", dateStrings: true, multipleStatements: false });
}

export async function runAliceVisibilityImportCli(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(ALICE_VISIBILITY_IMPORT_USAGE);
    return;
  }
  const options = parseCliArgs(args);
  const prepared = options.summaryOnly
    ? createSummaryOnlySnapshot(options)
    : {
      sourceKey: "yandex_webmaster_alice_manual",
      sourcePayloadJson: undefined,
      snapshot: parseAliceVisibilityWorkbook(readFileSync(options.xlsxPath!), {
        accountId: options.accountId,
        portalDomain: options.domain,
        period: options.period,
        officialSovPct: options.officialSovPct,
        capturedAt: options.capturedAt,
        sourceFilename: path.basename(options.xlsxPath!),
        featuredSites: options.featuredSites,
      }),
    };
  const snapshot = prepared.snapshot;
  const label = options.summaryOnly ? "summary_only" : "xlsx";
  validateSnapshot(snapshot);
  if (!options.execute) {
    process.stdout.write(`Alice visibility dry-run mode=${label} queries=${snapshot.queries.length} portal_present=${snapshot.portalPresentQueryCount ?? "null"} sample_presence_pct=${snapshot.samplePresencePct === null ? "null" : snapshot.samplePresencePct.toFixed(2)} sources=${snapshot.sources.length} featured_sites=${snapshot.featured.length} validation_mismatches=0 checksum=${snapshot.sourceSha256}\n`);
    return;
  }
  const connection = await configuredConnection();
  try {
    const result = await persistAliceVisibilitySnapshot(connection as unknown as AliceVisibilityImportConnection, snapshot, {
      sourceKey: prepared.sourceKey,
      sourcePayloadJson: prepared.sourcePayloadJson,
      supersedeSnapshotId: options.supersedeSnapshotId,
    });
    process.stdout.write(`Alice visibility import result=${result} checksum=${snapshot.sourceSha256}\n`);
  } finally {
    await connection.end();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  runAliceVisibilityImportCli().catch((error) => {
    process.stderr.write(`Alice visibility import failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
