import crypto from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  parseCookieValue,
  hashPassword,
  verifyPassword,
  verifyViewerSession,
  viewerCookieName,
} from "@/lib/access-auth";
import {
  resolveDashboardAudience,
  resolveDashboardAuthMode,
} from "@/lib/dashboard-access-policy";
import type { DashboardAudience, DashboardAuthMode } from "@/lib/dashboard-access-policy";
import {
  loadSharedPasswordCredential,
  verifySharedDashboardPassword,
} from "@/lib/dashboard-shared-access";
import { isSharedPasswordClient } from "@/lib/shared-password-policy";

export type { DashboardAuthMode } from "@/lib/dashboard-access-policy";

type DashboardAccessContextRow = RowDataPacket & {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  is_active: number | boolean;
  access_users_count: number;
};

type DashboardAccessUserRow = RowDataPacket & {
  id: number;
  dashboard_id: number;
  email: string;
  password_hash: string;
  is_active: number | boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

export type DashboardAccessContext = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  is_active: boolean;
  access_users_count: number;
  auth_mode: DashboardAuthMode;
};

type VerifiedDashboardAccessContext = DashboardAccessContext & {
  credentialVersion?: number;
};

export type DashboardAccessUser = {
  id: number;
  email: string;
  created_at: string | null;
  updated_at: string | null;
};

export type DashboardAccessUserInput = {
  email: string;
  password?: string;
};

export type ViewerPortalDashboard = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  url: string;
};

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function safeEqualText(a: string, b: string) {
  const aBuffer = Buffer.from(String(a ?? ""));
  const bBuffer = Buffer.from(String(b ?? ""));
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getSharedDashboardPassword(clientId: string) {
  if (String(clientId).trim().toLowerCase() === "abbott") {
    return process.env.ABBOTT_DASHBOARD_PASSWORD?.trim() || null;
  }
  return null;
}

function getSharedDashboardEmbedKey(clientId: string) {
  if (String(clientId).trim().toLowerCase() === "abbott") {
    return process.env.ABBOTT_DASHBOARD_EMBED_KEY?.trim() || null;
  }
  return null;
}

function resolveAuthMode(clientId: string, accessUsersCount: number): DashboardAuthMode {
  return resolveDashboardAuthMode(
    clientId,
    accessUsersCount,
    Boolean(getSharedDashboardPassword(clientId)),
  );
}

function rowToContext(row: DashboardAccessContextRow): DashboardAccessContext {
  const clientId = String(row.client_id);
  const accessUsersCount = Number(row.access_users_count ?? 0);
  return {
    id: Number(row.id),
    client_id: clientId,
    client_name: String(row.client_name),
    dashboard_name: String(row.dashboard_name),
    is_active: Boolean(row.is_active),
    access_users_count: accessUsersCount,
    auth_mode: resolveAuthMode(clientId, accessUsersCount),
  };
}

function rowToUser(row: DashboardAccessUserRow): DashboardAccessUser {
  return {
    id: Number(row.id),
    email: String(row.email),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getDashboardAccessContext(identifier: string | number) {
  const lookup = String(identifier ?? "").trim();
  const dashboardId = Number(lookup);
  const [rows] = await pool.execute<DashboardAccessContextRow[]>(
    `SELECT
       d.id,
       d.client_id,
       d.client_name,
       d.dashboard_name,
       d.is_active,
       COUNT(dau.id) AS access_users_count
     FROM dashboards d
     LEFT JOIN dashboard_access_users dau
       ON dau.dashboard_id = d.id
      AND dau.is_active = TRUE
     WHERE d.is_active = TRUE
       AND (d.id = ? OR d.client_id = ?)
     GROUP BY d.id
     LIMIT 1`,
    [Number.isFinite(dashboardId) ? dashboardId : 0, lookup.toLowerCase()],
  );
  if (!rows[0]) return null;
  return rowToContext(rows[0]);
}

export async function listDashboardAccessUsers(dashboardId: number) {
  const [rows] = await pool.execute<DashboardAccessUserRow[]>(
    `SELECT id, dashboard_id, email, password_hash, is_active, created_at, updated_at
     FROM dashboard_access_users
     WHERE dashboard_id = ? AND is_active = TRUE
     ORDER BY email ASC`,
    [dashboardId],
  );
  return rows.map(rowToUser);
}

async function loadDashboardAccessUsersWithHashes(conn: PoolConnection, dashboardId: number) {
  const [rows] = await conn.execute<DashboardAccessUserRow[]>(
    `SELECT id, dashboard_id, email, password_hash, is_active, created_at, updated_at
     FROM dashboard_access_users
     WHERE dashboard_id = ? AND is_active = TRUE`,
    [dashboardId],
  );
  return rows;
}

export async function replaceDashboardAccessUsers(dashboardId: number, rawUsers: DashboardAccessUserInput[]) {
  const normalizedUsers = rawUsers
    .map((item) => ({
      email: normalizeEmail(item.email),
      password: String(item.password ?? ""),
    }))
    .filter((item) => item.email);

  const deduped = new Map<string, { email: string; password: string }>();
  for (const user of normalizedUsers) {
    deduped.set(user.email, user);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dashboardRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM dashboards WHERE id = ? LIMIT 1",
      [dashboardId],
    );
    if (!dashboardRows[0]) {
      throw new Error("Dashboard not found");
    }

    const existingRows = await loadDashboardAccessUsersWithHashes(conn, dashboardId);
    const existingByEmail = new Map(existingRows.map((row) => [normalizeEmail(row.email), row]));

    const nextUsers = Array.from(deduped.values()).map((user) => {
      const existing = existingByEmail.get(user.email);
      if (user.password) {
        return {
          email: user.email,
          password_hash: hashPassword(user.password),
        };
      }
      if (existing) {
        return {
          email: user.email,
          password_hash: existing.password_hash,
        };
      }
      throw new Error(`Password is required for new user ${user.email}`);
    });

    await conn.execute("DELETE FROM dashboard_access_users WHERE dashboard_id = ?", [dashboardId]);

    for (const user of nextUsers) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO dashboard_access_users (dashboard_id, email, password_hash, is_active)
         VALUES (?, ?, ?, TRUE)`,
        [dashboardId, user.email, user.password_hash],
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function verifyDashboardAccessCredentials(
  identifier: string | number,
  email: string,
  password: string,
): Promise<VerifiedDashboardAccessContext | null> {
  const context = await getDashboardAccessContext(identifier);
  if (!context) return null;
  return verifyDashboardAccessContextCredentials(context, email, password);
}

export async function verifyDashboardAccessContextCredentials(
  context: DashboardAccessContext,
  email: string,
  password: string,
): Promise<VerifiedDashboardAccessContext | null> {
  if (context.auth_mode === "public") return context;
  if (context.auth_mode === "password_only") {
    if (isSharedPasswordClient(context.client_id)) {
      const verified = await verifySharedDashboardPassword(
        context.id,
        context.client_id,
        password,
      );
      return verified
        ? { ...context, credentialVersion: verified.credentialVersion }
        : null;
    }
    const expectedPassword = getSharedDashboardPassword(context.client_id);
    return expectedPassword && safeEqualText(password, expectedPassword) ? context : null;
  }

  const normalizedEmail = normalizeEmail(email);
  const [rows] = await pool.execute<DashboardAccessUserRow[]>(
    `SELECT id, dashboard_id, email, password_hash, is_active, created_at, updated_at
     FROM dashboard_access_users
     WHERE dashboard_id = ? AND email = ? AND is_active = TRUE
     LIMIT 1`,
    [context.id, normalizedEmail],
  );
  const user = rows[0];
  if (!user) return null;
  return verifyPassword(password, user.password_hash) ? context : null;
}

export function sharedCredentialVersionMatches(
  payload: { audience: DashboardAudience; credential_version?: number },
  currentVersion: number,
) {
  return payload.audience === "manager" && payload.credential_version === currentVersion;
}

export async function listAccessibleDashboardsByCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const [rows] = await pool.execute<(DashboardAccessUserRow & DashboardAccessContextRow)[]>(
    `SELECT
       dau.id,
       dau.dashboard_id,
       dau.email,
       dau.password_hash,
       dau.is_active,
       dau.created_at,
       dau.updated_at,
       d.client_id,
       d.client_name,
       d.dashboard_name
     FROM dashboard_access_users dau
     INNER JOIN dashboards d ON d.id = dau.dashboard_id
     WHERE dau.email = ? AND dau.is_active = TRUE AND d.is_active = TRUE
     ORDER BY d.client_name ASC, d.dashboard_name ASC`,
    [normalizedEmail],
  );

  return rows
    .filter((row) => verifyPassword(password, row.password_hash))
    .map((row) => ({
      id: Number(row.dashboard_id),
      client_id: String(row.client_id),
      client_name: String(row.client_name),
      dashboard_name: String(row.dashboard_name),
      url: `/dashboard/${row.client_id}`,
    }));
}

export async function listViewerPortalDashboards(dashboardIds: number[]) {
  if (!dashboardIds.length) return [];
  const ids = [...new Set(dashboardIds.filter((id) => Number.isFinite(id)))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, client_id, client_name, dashboard_name
     FROM dashboards
     WHERE is_active = TRUE AND id IN (${placeholders})
     ORDER BY client_name ASC, dashboard_name ASC`,
    ids,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    client_id: String(row.client_id),
    client_name: String(row.client_name),
    dashboard_name: String(row.dashboard_name),
    url: `/dashboard/${row.client_id}`,
  })) as ViewerPortalDashboard[];
}

const defaultDashboardAccessAuthorizationDependencies = {
  getDashboardAccessContext,
  loadSharedPasswordCredential,
};

type DashboardAccessAuthorizationDependencies =
  typeof defaultDashboardAccessAuthorizationDependencies;

export function createDashboardAccessAuthorizer(
  overrides: Partial<DashboardAccessAuthorizationDependencies> = {},
) {
  const dependencies = {
    ...defaultDashboardAccessAuthorizationDependencies,
    ...overrides,
  };

  return async function authorizeDashboardAccess(
    request: Request,
    identifier: string | number,
  ) {
    const context = await dependencies.getDashboardAccessContext(identifier);
    if (!context) {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    if (context.auth_mode === "public") {
      return {
        context,
        authorized: true as const,
        reason: "public" as const,
        audience: "manager" as const,
        credentialVersion: undefined,
      };
    }

    const url = new URL(request.url);
    const embedKey = url.searchParams.get("embed_key");
    const expectedEmbedKey = getSharedDashboardEmbedKey(context.client_id);
    if (expectedEmbedKey && embedKey && safeEqualText(embedKey, expectedEmbedKey)) {
      return {
        context,
        authorized: true as const,
        reason: "embed_key" as const,
        audience: resolveDashboardAudience("embed_key"),
        credentialVersion: undefined,
      };
    }
    const queryToken = url.searchParams.get("access_token");
    const cookieToken = parseCookieValue(request.headers.get("cookie"), viewerCookieName(context.id));
    const token = queryToken || cookieToken;
    const payload = verifyViewerSession(token, context.id);
    if (!payload) {
      return { context, authorized: false as const, reason: "auth_required" as const };
    }
    let credentialVersion: number | undefined;
    if (isSharedPasswordClient(context.client_id) && payload.audience === "manager") {
      const credential = await dependencies.loadSharedPasswordCredential(
        context.id,
        context.client_id,
      );
      if (
        credential.source === "missing" ||
        !sharedCredentialVersionMatches(payload, credential.credential_version)
      ) {
        return { context, authorized: false as const, reason: "auth_required" as const };
      }
      credentialVersion = credential.credential_version;
    }
    return {
      context,
      authorized: true as const,
      reason: "authorized" as const,
      audience: resolveDashboardAudience("authorized", payload),
      payload,
      credentialVersion,
    };
  };
}

export const isDashboardAccessAuthorized = createDashboardAccessAuthorizer();
