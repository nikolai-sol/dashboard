import crypto from "crypto";
import type { DashboardAudience } from "./dashboard-access-policy";

export type { DashboardAudience } from "./dashboard-access-policy";

export const ADMIN_SESSION_COOKIE = "dashboard_admin_session";
export const VIEWER_SESSION_COOKIE_PREFIX = "dashboard_viewer_";
export const VIEWER_PORTAL_SESSION_COOKIE = "dashboard_viewer_portal_session";

type SessionType = "admin" | "viewer" | "viewer_export";

type SessionPayload = {
  type: SessionType;
  email?: string;
  dashboard_id?: number;
  dashboard_ids?: number[];
  audience?: DashboardAudience;
  exp: number;
};

export type ViewerSessionPayload = SessionPayload & {
  type: "viewer" | "viewer_export";
  dashboard_id: number;
  audience: DashboardAudience;
};

function getAuthSecret() {
  const configured = process.env.DASHBOARD_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  return "dashboard-dev-secret";
}

function toBase64Url(input: Buffer | string) {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function signPart(payloadPart: string) {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("DASHBOARD_AUTH_SECRET is required in production");
  }
  return toBase64Url(crypto.createHmac("sha256", secret).update(payloadPart).digest());
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function parseCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function viewerCookieName(dashboardId: number) {
  return `${VIEWER_SESSION_COOKIE_PREFIX}${dashboardId}`;
}

export function createSignedSession(payload: SessionPayload) {
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = signPart(payloadPart);
  return `${payloadPart}.${signature}`;
}

export function verifySignedSession(token: string | null | undefined): SessionPayload | null {
  if (!getAuthSecret()) return null;
  if (!token || !token.includes(".")) return null;
  const [payloadPart, signature] = token.split(".", 2);
  if (!payloadPart || !signature) return null;
  const expected = signPart(payloadPart);
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(payloadPart).toString("utf8")) as SessionPayload;
    if (!payload?.type || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAdminSession(email: string) {
  return createSignedSession({
    type: "admin",
    email: normalizeEmail(email),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
}

export function verifyAdminSession(token: string | null | undefined) {
  const payload = verifySignedSession(token);
  if (!payload || payload.type !== "admin" || !payload.email) return null;
  return payload as SessionPayload & { type: "admin"; email: string };
}

export function createViewerSession(
  dashboardId: number,
  email: string,
  audience: DashboardAudience,
) {
  return createSignedSession({
    type: "viewer",
    dashboard_id: dashboardId,
    email: normalizeEmail(email),
    audience,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
}

export function createViewerExportToken(dashboardId: number, audience: DashboardAudience) {
  return createSignedSession({
    type: "viewer_export",
    dashboard_id: dashboardId,
    audience,
    exp: Math.floor(Date.now() / 1000) + 60 * 10,
  });
}

export function createViewerPortalSession(email: string, dashboardIds: number[]) {
  return createSignedSession({
    type: "viewer",
    email: normalizeEmail(email),
    dashboard_ids: dashboardIds,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
}

export function verifyViewerPortalSession(token: string | null | undefined) {
  const payload = verifySignedSession(token);
  if (!payload || payload.type !== "viewer" || !payload.email || !Array.isArray(payload.dashboard_ids)) {
    return null;
  }
  return payload as SessionPayload & { type: "viewer"; email: string; dashboard_ids: number[] };
}

export function verifyViewerSession(
  token: string | null | undefined,
  dashboardId: number,
) {
  const payload = verifySignedSession(token);
  if (!payload) return null;
  if (payload.type !== "viewer" && payload.type !== "viewer_export") return null;
  if (payload.dashboard_id !== dashboardId) return null;
  if (payload.audience !== "manager" && payload.audience !== "embed") return null;
  return payload as ViewerSessionPayload;
}

export function getAdminEmail() {
  return normalizeEmail(process.env.DASHBOARD_ADMIN_EMAIL || "");
}

export function isAuthSecretConfigured() {
  return Boolean(getAuthSecret());
}

export function isValidAdminCredentials(email: string, password: string) {
  const configuredEmail = getAdminEmail();
  const configuredPassword = process.env.DASHBOARD_ADMIN_PASSWORD || "";
  if (!configuredEmail || !configuredPassword) return false;
  return normalizeEmail(email) === configuredEmail && safeEqual(password, configuredPassword);
}

export function cookieOptions(maxAgeSeconds: number, sameSite: "lax" | "none" = "lax") {
  return {
    httpOnly: true,
    sameSite,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, expectedHash] = String(storedHash ?? "").split(":");
  if (scheme !== "scrypt" || !salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return safeEqual(actualHash, expectedHash);
}
