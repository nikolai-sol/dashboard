import {
  type AbbottPrivateMutationExecutor,
  type AbbottPrivateQueryExecutor,
  withAbbottPrivateMutationExecutor,
  withReadOnlyAbbottExecutor,
} from "./abbott-private-store";

const MAX_USER_ID_LENGTH = 32;
const MAX_REQUEST_IDS = 200;
const MAX_DASHBOARD_IDS = 1_000;
const PRIVATE_ERROR_MESSAGE = "Abbott administrator settings are unavailable";

export type AbbottAdminUsersErrorCode =
  | "INVALID_DASHBOARD"
  | "INVALID_USER_IDS"
  | "TOO_MANY_USER_IDS"
  | "PRIVATE_DATA_UNAVAILABLE";

export class AbbottAdminUsersError extends Error {
  constructor(
    public readonly code: AbbottAdminUsersErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AbbottAdminUsersError";
  }
}

export interface AbbottAdminUsersMutationExecutor extends AbbottPrivateQueryExecutor {
  execute(sql: string, params: readonly unknown[]): Promise<void>;
}

export function normalizeAbbottAdminUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return new RegExp(`^[0-9]{1,${MAX_USER_ID_LENGTH}}$`).test(normalized)
    ? normalized
    : null;
}

function adminError(code: AbbottAdminUsersErrorCode, message = PRIVATE_ERROR_MESSAGE) {
  return new AbbottAdminUsersError(code, message);
}

function sanitizeError(error: unknown): AbbottAdminUsersError {
  return error instanceof AbbottAdminUsersError
    ? error
    : adminError("PRIVATE_DATA_UNAVAILABLE");
}

function positiveDashboardId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function requireAbbottDashboard(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<void> {
  if (!positiveDashboardId(dashboardId)) throw adminError("INVALID_DASHBOARD");
  const rows = await executor.query(
    `SELECT id
     FROM \`report_bd\`.\`dashboards\`
     WHERE id = ?
       AND LOWER(TRIM(client_id)) = ?
       AND dashboard_type = ?
       AND is_active = TRUE
     LIMIT 2`,
    [dashboardId, "abbott", "abbott_bi"],
  );
  if (rows.length !== 1 || Number(rows[0]?.id) !== dashboardId) {
    throw adminError("INVALID_DASHBOARD");
  }
}

function parseRows(rows: readonly Record<string, unknown>[]): string[] {
  const values = rows.map((row) => normalizeAbbottAdminUserId(row.raw_user_id));
  if (values.some((value) => value === null) || new Set(values).size !== values.length) {
    throw adminError("PRIVATE_DATA_UNAVAILABLE");
  }
  return (values as string[]).sort((left, right) => left.localeCompare(right, "en"));
}

async function readConfiguredIds(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
  lock = false,
): Promise<string[]> {
  const rows = await executor.query(
    `SELECT raw_user_id
     FROM \`report_bd_private\`.\`portal_abbott_admin_user_exclusions\`
     WHERE dashboard_id = ?
     ORDER BY raw_user_id${lock ? " FOR UPDATE" : ""}`,
    [dashboardId],
  );
  return parseRows(rows);
}

function normalizeRequestIds(values: readonly unknown[]): string[] {
  if (values.length === 0) throw adminError("INVALID_USER_IDS");
  if (values.length > MAX_REQUEST_IDS) throw adminError("TOO_MANY_USER_IDS");
  const normalized = values.map(normalizeAbbottAdminUserId);
  if (normalized.some((value) => value === null)) throw adminError("INVALID_USER_IDS");
  return [...new Set(normalized as string[])];
}

export async function listAbbottAdminUserIdsWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<string[]> {
  try {
    await requireAbbottDashboard(executor, dashboardId);
    return await readConfiguredIds(executor, dashboardId);
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function addAbbottAdminUserIdsWithExecutor(
  executor: AbbottAdminUsersMutationExecutor,
  dashboardId: number,
  values: readonly unknown[],
): Promise<string[]> {
  const normalized = normalizeRequestIds(values);
  try {
    await requireAbbottDashboard(executor, dashboardId);
    const existing = await readConfiguredIds(executor, dashboardId, true);
    const existingSet = new Set(existing);
    const newCount = normalized.filter((value) => !existingSet.has(value)).length;
    if (existing.length + newCount > MAX_DASHBOARD_IDS) {
      throw adminError("TOO_MANY_USER_IDS");
    }
    const placeholders = normalized.map(() => "(?, ?)").join(", ");
    const params = normalized.flatMap((value) => [dashboardId, value]);
    await executor.execute(
      `INSERT IGNORE INTO \`report_bd_private\`.\`portal_abbott_admin_user_exclusions\`
         (dashboard_id, raw_user_id)
       VALUES ${placeholders}`,
      params,
    );
    return await readConfiguredIds(executor, dashboardId);
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function removeAbbottAdminUserIdWithExecutor(
  executor: AbbottAdminUsersMutationExecutor,
  dashboardId: number,
  value: unknown,
): Promise<string[]> {
  const normalized = normalizeAbbottAdminUserId(value);
  if (normalized === null) throw adminError("INVALID_USER_IDS");
  try {
    await requireAbbottDashboard(executor, dashboardId);
    await executor.execute(
      `DELETE FROM \`report_bd_private\`.\`portal_abbott_admin_user_exclusions\`
       WHERE dashboard_id = ? AND raw_user_id = ?`,
      [dashboardId, normalized],
    );
    return await readConfiguredIds(executor, dashboardId);
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function listAbbottAdminUserIds(dashboardId: number): Promise<string[]> {
  return withReadOnlyAbbottExecutor("manager", (executor) =>
    listAbbottAdminUserIdsWithExecutor(executor, dashboardId));
}

export async function addAbbottAdminUserIds(
  dashboardId: number,
  values: readonly unknown[],
): Promise<string[]> {
  return withAbbottPrivateMutationExecutor((executor: AbbottPrivateMutationExecutor) =>
    addAbbottAdminUserIdsWithExecutor(executor, dashboardId, values));
}

export async function removeAbbottAdminUserId(
  dashboardId: number,
  value: unknown,
): Promise<string[]> {
  return withAbbottPrivateMutationExecutor((executor: AbbottPrivateMutationExecutor) =>
    removeAbbottAdminUserIdWithExecutor(executor, dashboardId, value));
}
