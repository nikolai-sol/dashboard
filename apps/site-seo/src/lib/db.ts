import type { Period, SourceScope } from "@reportingdash/site-seo-contract";
import mysql from "mysql2/promise";
import type { GscReadRows } from "./gsc.ts";

export type CanonicalReadQuery = Readonly<{
  name: "gsc" | "dataset";
  scope: SourceScope;
  period: Period;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
}>;

/**
 * The runtime implementation is supplied by the site's MySQL-only adapter.
 * Keeping this boundary injected lets fixtures verify scope without accepting
 * request-provided source identifiers or reading import artifacts.
 */
export type CanonicalReadExecutor = (
  query: CanonicalReadQuery,
) => Promise<GscReadRows | import("@reportingdash/site-seo-contract").DatasetMeta>;

export class MissingCanonicalReadMappingError extends Error {
  constructor() {
    super("Canonical site-seo read mapping is not installed");
    this.name = "MissingCanonicalReadMappingError";
  }
}

/** Fails closed until T1–T3 publish the canonical table/row mapping. */
export const missingCanonicalReadExecutor: CanonicalReadExecutor = async () => {
  throw new MissingCanonicalReadMappingError();
};

function mysqlPool() {
  return mysql.createPool({
    host: process.env.DB_HOST ?? process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.DB_USER ?? process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd",
    dateStrings: ["DATE"], waitForConnections: true, connectionLimit: 5, queueLimit: 0,
  });
}

let defaultPool: mysql.Pool | null = null;

/** Uses only the canonical dashboard credential authority; no source credentials or APIs. */
export async function loadCurrentCredentialVersion(dashboardId: number): Promise<number | null> {
  defaultPool ??= mysqlPool();
  const [rows] = await defaultPool.execute<mysql.RowDataPacket[]>(
    "SELECT credential_version FROM dashboard_shared_access_settings WHERE dashboard_id = ? LIMIT 1",
    [dashboardId],
  );
  const value = Number(rows[0]?.credential_version);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
