import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  parseCookieValue,
  hashPassword,
  verifyPassword,
  verifyViewerSession,
  viewerCookieName,
} from "@/lib/access-auth";

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

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function rowToContext(row: DashboardAccessContextRow): DashboardAccessContext {
  return {
    id: Number(row.id),
    client_id: String(row.client_id),
    client_name: String(row.client_name),
    dashboard_name: String(row.dashboard_name),
    is_active: Boolean(row.is_active),
    access_users_count: Number(row.access_users_count ?? 0),
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
) {
  const context = await getDashboardAccessContext(identifier);
  if (!context) return null;
  if (context.access_users_count === 0) return context;

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

export async function isDashboardAccessAuthorized(request: Request, identifier: string | number) {
  const context = await getDashboardAccessContext(identifier);
  if (!context) {
    return { context: null, authorized: false, reason: "not_found" as const };
  }
  if (context.access_users_count === 0) {
    return { context, authorized: true, reason: "public" as const };
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("access_token");
  const cookieToken = parseCookieValue(request.headers.get("cookie"), viewerCookieName(context.id));
  const token = queryToken || cookieToken;
  const payload = verifyViewerSession(token, context.id);
  if (!payload) {
    return { context, authorized: false, reason: "auth_required" as const };
  }
  return { context, authorized: true, reason: "authorized" as const, payload };
}

