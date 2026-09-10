import crypto from "node:crypto";
import mysql from "mysql2/promise";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";

type CredentialRow = Readonly<{ password_hash: string; credential_version: number | string }>;
type LoginDependencies = Readonly<{
  loadRegistration: () => Promise<SiteRegistration>;
  verifyPassword: (registration: SiteRegistration, password: string) => Promise<{ credentialVersion: number } | null>;
  secret?: string;
}>;

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function signedViewerToken(dashboardId: number, credentialVersion: number, secret: string): string {
  const payload = base64Url(JSON.stringify({
    type: "viewer",
    dashboard_id: dashboardId,
    audience: "manager",
    credential_version: credentialVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  }));
  return `${payload}.${base64Url(crypto.createHmac("sha256", secret).update(payload).digest())}`;
}

function verifyScrypt(password: string, stored: string): boolean {
  const [scheme, salt, expected] = String(stored).split(":");
  if (scheme !== "scrypt" || !salt || !expected || !/^[a-f0-9]+$/i.test(expected)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = crypto.scryptSync(password, salt, expectedBytes.length);
  return expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes);
}

let pool: mysql.Pool | null = null;
function database(): mysql.Pool {
  pool ??= mysql.createPool({
    host: process.env.DB_HOST ?? process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.DB_USER ?? process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd",
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
  });
  return pool;
}

export async function verifyCanonicalSitePassword(registration: SiteRegistration, password: string): Promise<{ credentialVersion: number } | null> {
  const [rows] = await database().execute<mysql.RowDataPacket[]>(
    `SELECT s.password_hash, s.credential_version
       FROM dashboards d
       JOIN dashboard_shared_access_settings s ON s.dashboard_id = d.id
      WHERE d.id = ? AND d.client_id = ? AND d.dashboard_type = 'site_seo'
        AND d.is_active = TRUE
      LIMIT 1`,
    [registration.profile.dashboardId, registration.profile.clientId],
  );
  const row = rows[0] as CredentialRow | undefined;
  const credentialVersion = Number(row?.credential_version);
  if (!row || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1 || !verifyScrypt(password, row.password_hash)) return null;
  return { credentialVersion };
}

export function createSiteLoginHandler(dependencies: LoginDependencies) {
  return async (request: Request): Promise<Response> => {
    const body = await request.json().catch(() => null) as { dashboard_id?: unknown; password?: unknown } | null;
    const registration = await dependencies.loadRegistration();
    const dashboardId = Number(body?.dashboard_id);
    const password = typeof body?.password === "string" ? body.password : "";
    if (dashboardId !== registration.profile.dashboardId || !password) {
      return Response.json({ error: "Invalid credentials" }, { status: 401, headers: { "cache-control": "private, no-store" } });
    }
    let credential;
    try { credential = await dependencies.verifyPassword(registration, password); }
    catch { return Response.json({ error: "Authentication unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
    if (!credential) return Response.json({ error: "Invalid credentials" }, { status: 401, headers: { "cache-control": "private, no-store" } });
    const secret = dependencies.secret ?? process.env.DASHBOARD_AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dashboard-dev-secret");
    if (!secret) return Response.json({ error: "Authentication unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
    const token = signedViewerToken(dashboardId, credential.credentialVersion, secret);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json({ ok: true }, { headers: {
      "cache-control": "private, no-store",
      "set-cookie": `dashboard_viewer_${dashboardId}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`,
    } });
  };
}
