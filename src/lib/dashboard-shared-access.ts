import crypto from "crypto";
import pool from "./db";
import { hashPassword, verifyPassword } from "./access-auth";
import { isSharedPasswordClient } from "./shared-password-policy";

export type SharedPasswordCredential = {
  source: "database" | "abbott_env_fallback" | "missing";
  password_hash: string | null;
  legacy_password: string | null;
  credential_version: number;
};

export type SharedPasswordAdminState = {
  supported: boolean;
  configured: boolean;
  client_id: string | null;
  credential_version: number;
  updated_at: string | null;
};

export type SharedPasswordRotationErrorCode =
  | "DASHBOARD_NOT_FOUND"
  | "UNSUPPORTED_DASHBOARD";

export class SharedPasswordRotationError extends Error {
  readonly code: SharedPasswordRotationErrorCode;

  constructor(code: SharedPasswordRotationErrorCode) {
    super("Shared dashboard password rotation rejected");
    this.name = "SharedPasswordRotationError";
    this.code = code;
  }
}

type QueryExecutor = {
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
};

type SharedAccessConnection = QueryExecutor & {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
};

type SharedAccessDatabase = QueryExecutor & {
  getConnection(): Promise<SharedAccessConnection>;
};

type SharedAccessSettingsRow = {
  password_hash: string;
  credential_version: number | string;
  updated_at?: string | Date | null;
};

type DashboardCredentialRow = {
  client_id: string;
  password_hash: string | null;
  credential_version: number | string | null;
  updated_at: string | Date | null;
};

function normalizeClientId(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function assertDashboardId(dashboardId: number) {
  if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0) {
    throw new Error("Invalid dashboard ID");
  }
}

function parseDatabaseCredentialVersion(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Invalid shared credential version");
  }
  return parsed;
}

function asTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? null : String(value);
}

function safeEqualText(left: string, right: string) {
  const leftDigest = crypto.createHash("sha256").update(left, "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function firstRow<T>(result: unknown): T | null {
  return Array.isArray(result) && result.length ? (result[0] as T) : null;
}

export function createDashboardSharedAccessStore(
  database: SharedAccessDatabase = pool as unknown as SharedAccessDatabase,
  options = {
    abbottLegacyPassword: process.env.ABBOTT_DASHBOARD_PASSWORD?.trim() || null,
  },
) {
  async function loadSharedPasswordCredential(
    dashboardId: number,
    clientId: string,
  ): Promise<SharedPasswordCredential> {
    assertDashboardId(dashboardId);

    let row: DashboardCredentialRow | null;
    try {
      const [rows] = await database.execute(
        `SELECT
           d.client_id,
           s.password_hash,
           s.credential_version,
           s.updated_at
         FROM dashboards d
         LEFT JOIN dashboard_shared_access_settings s ON s.dashboard_id = d.id
         WHERE d.id = ?
         LIMIT 1`,
        [dashboardId],
      );
      row = firstRow<DashboardCredentialRow>(rows);
    } catch {
      throw new Error("Unable to load shared dashboard credential");
    }

    if (!row) {
      return {
        source: "missing",
        password_hash: null,
        legacy_password: null,
        credential_version: 0,
      };
    }

    const requestedClientId = normalizeClientId(clientId);
    const authoritativeClientId = normalizeClientId(row.client_id);
    if (
      !isSharedPasswordClient(authoritativeClientId) ||
      authoritativeClientId !== requestedClientId
    ) {
      return {
        source: "missing",
        password_hash: null,
        legacy_password: null,
        credential_version: 0,
      };
    }

    if (row.password_hash !== null) {
      let credentialVersion: number;
      try {
        credentialVersion = parseDatabaseCredentialVersion(row.credential_version);
      } catch {
        throw new Error("Unable to load shared dashboard credential");
      }
      return {
        source: "database",
        password_hash: row.password_hash,
        legacy_password: null,
        credential_version: credentialVersion,
      };
    }

    if (authoritativeClientId === "abbott" && options.abbottLegacyPassword) {
      return {
        source: "abbott_env_fallback",
        password_hash: null,
        legacy_password: options.abbottLegacyPassword,
        credential_version: 0,
      };
    }

    return {
      source: "missing",
      password_hash: null,
      legacy_password: null,
      credential_version: 0,
    };
  }

  async function getSharedPasswordAdminState(
    dashboardId: number,
  ): Promise<SharedPasswordAdminState> {
    assertDashboardId(dashboardId);

    let row: DashboardCredentialRow | null;
    try {
      const [rows] = await database.execute(
        `SELECT
           d.client_id,
           s.password_hash,
           s.credential_version,
           s.updated_at
         FROM dashboards d
         LEFT JOIN dashboard_shared_access_settings s ON s.dashboard_id = d.id
         WHERE d.id = ?
         LIMIT 1`,
        [dashboardId],
      );
      row = firstRow<DashboardCredentialRow>(rows);
    } catch {
      throw new Error("Unable to load shared dashboard password state");
    }

    if (!row) {
      return {
        supported: false,
        configured: false,
        client_id: null,
        credential_version: 0,
        updated_at: null,
      };
    }

    const clientId = normalizeClientId(row.client_id);
    const supported = isSharedPasswordClient(clientId);
    const hasDatabaseSetting = row.password_hash !== null;
    const databaseConfigured = supported && hasDatabaseSetting;
    const fallbackConfigured =
      supported && !hasDatabaseSetting && clientId === "abbott" && Boolean(options.abbottLegacyPassword);
    let credentialVersion = 0;
    if (databaseConfigured) {
      try {
        credentialVersion = parseDatabaseCredentialVersion(row.credential_version);
      } catch {
        throw new Error("Unable to load shared dashboard password state");
      }
    }

    return {
      supported,
      configured: databaseConfigured || (!databaseConfigured && fallbackConfigured),
      client_id: clientId,
      credential_version: credentialVersion,
      updated_at: databaseConfigured ? asTimestamp(row.updated_at) : null,
    };
  }

  async function rotateSharedDashboardPassword(
    dashboardId: number,
    password: string,
    updatedBy: string,
    expectedClientId?: string,
  ): Promise<SharedPasswordAdminState> {
    assertDashboardId(dashboardId);
    const connection = await database.getConnection();

    try {
      await connection.beginTransaction();

      const [dashboardRows] = await connection.execute(
        `SELECT client_id
         FROM dashboards
         WHERE id = ?
           AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [dashboardId],
      );
      const dashboard = firstRow<{ client_id: string }>(dashboardRows);
      if (!dashboard) {
        throw new SharedPasswordRotationError("DASHBOARD_NOT_FOUND");
      }

      const clientId = normalizeClientId(dashboard.client_id);
      if (
        !isSharedPasswordClient(clientId) ||
        (expectedClientId !== undefined && expectedClientId !== clientId)
      ) {
        throw new SharedPasswordRotationError("UNSUPPORTED_DASHBOARD");
      }

      const [settingRows] = await connection.execute(
        `SELECT credential_version
         FROM dashboard_shared_access_settings
         WHERE dashboard_id = ?
         LIMIT 1
         FOR UPDATE`,
        [dashboardId],
      );
      const existingSetting = firstRow<SharedAccessSettingsRow>(settingRows);
      const existingCredentialVersion = existingSetting
        ? parseDatabaseCredentialVersion(existingSetting.credential_version)
        : 0;
      if (existingCredentialVersion === Number.MAX_SAFE_INTEGER) {
        throw new Error("Shared credential version overflow");
      }
      const credentialVersion = existingCredentialVersion + 1;
      const passwordHash = hashPassword(password);

      await connection.execute(
        `INSERT INTO dashboard_shared_access_settings (
           dashboard_id,
           password_hash,
           credential_version,
           updated_by
         ) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           credential_version = VALUES(credential_version),
           updated_by = VALUES(updated_by),
           updated_at = CURRENT_TIMESTAMP`,
        [dashboardId, passwordHash, credentialVersion, updatedBy],
      );

      const [updatedRows] = await connection.execute(
        `SELECT updated_at
         FROM dashboard_shared_access_settings
         WHERE dashboard_id = ?
         LIMIT 1`,
        [dashboardId],
      );
      const updatedSetting = firstRow<SharedAccessSettingsRow>(updatedRows);

      await connection.commit();
      return {
        supported: true,
        configured: true,
        client_id: clientId,
        credential_version: credentialVersion,
        updated_at: asTimestamp(updatedSetting?.updated_at),
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // The caller still receives a fixed error with no query or credential material.
      }
      if (error instanceof SharedPasswordRotationError) {
        throw error;
      }
      throw new Error("Unable to rotate shared dashboard password");
    } finally {
      connection.release();
    }
  }

  async function verifySharedDashboardPassword(
    dashboardId: number,
    clientId: string,
    password: string,
  ): Promise<{ credentialVersion: number } | null> {
    if (!isSharedPasswordClient(clientId)) return null;

    const credential = await loadSharedPasswordCredential(dashboardId, clientId);
    const matches = credential.password_hash
      ? verifyPassword(password, credential.password_hash)
      : credential.legacy_password !== null && safeEqualText(password, credential.legacy_password);

    return matches ? { credentialVersion: credential.credential_version } : null;
  }

  return {
    loadSharedPasswordCredential,
    getSharedPasswordAdminState,
    rotateSharedDashboardPassword,
    verifySharedDashboardPassword,
  };
}

const defaultStore = createDashboardSharedAccessStore();

export const loadSharedPasswordCredential = defaultStore.loadSharedPasswordCredential;
export const getSharedPasswordAdminState = defaultStore.getSharedPasswordAdminState;
export const rotateSharedDashboardPassword = defaultStore.rotateSharedDashboardPassword;
export const verifySharedDashboardPassword = defaultStore.verifySharedDashboardPassword;
