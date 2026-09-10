import crypto from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { calendarMonthPeriod, createPeriodSelection, isoWeekPeriod } from "./period-selection.ts";
import type { DashboardReadRequest } from "./route-handlers.ts";
import type { SiteSeoSession } from "./auth.ts";
import { canonicalReadExecutor, loadCurrentCredentialVersion } from "./db.ts";

type RuntimeFileDependencies = Readonly<{ registrationPath: string; readFile: (path: string, encoding: "utf8") => Promise<string>; validateRegistrations: (value: unknown) => readonly SiteRegistration[] }>;
type ViewerCookiePayload = Readonly<{ dashboardId: number; credentialVersion: number | undefined; expiresAt: string }>;
type SessionDependencies = Readonly<{
  verifyViewerCookie: (token: string | null, dashboardId: number) => Promise<ViewerCookiePayload | null>;
  loadCredentialVersion: (dashboardId: number) => Promise<number | null>;
}>;

export async function loadRuntimeRegistration(dependencies: RuntimeFileDependencies): Promise<SiteRegistration> {
  const parsed: unknown = JSON.parse(await dependencies.readFile(dependencies.registrationPath, "utf8"));
  const registrations = dependencies.validateRegistrations(Array.isArray(parsed) ? parsed : [parsed]);
  if (registrations.length !== 1) throw new Error("SITE_SEO_REGISTRATION_PATH must contain exactly one registration");
  return registrations[0]!;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function createSiteSeoSessionResolver(dependencies: SessionDependencies) {
  return async (cookieHeader: string | null, registration: SiteRegistration): Promise<SiteSeoSession | null> => {
    const dashboardId = registration.profile.dashboardId;
    const payload = await dependencies.verifyViewerCookie(cookieValue(cookieHeader, `dashboard_viewer_${dashboardId}`), dashboardId);
    if (!payload) return null;
    if (payload.dashboardId !== dashboardId) throw new Error("Session dashboard does not match");
    const credentialVersion = await dependencies.loadCredentialVersion(dashboardId);
    if (credentialVersion === null) return null;
    if (payload.credentialVersion !== credentialVersion) throw new Error("Session credential version is stale");
    return { audience: "manager", family: "site_seo", dashboardId, siteId: registration.profile.siteId, credentialVersion, expiresAt: payload.expiresAt };
  };
}

function parseWeekOrMonth(value: string, timezone: string) {
  return /^\d{4}-W\d{2}$/.test(value) ? isoWeekPeriod(value, timezone) : calendarMonthPeriod(value, timezone);
}

export function parseDashboardReadRequest(url: URL, slug: string, timezone: string): DashboardReadRequest {
  const trafficWeek = url.searchParams.get("traffic_week");
  const gscPeriod = url.searchParams.get("gsc_period");
  const aliceMonth = url.searchParams.get("alice_month");
  if (!trafficWeek || !gscPeriod || !aliceMonth) throw new Error("Reporting periods are required");
  const filters: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith("filter_") && key.length > "filter_".length) filters[key.slice("filter_".length)] = value;
  }
  return {
    slug,
    selection: createPeriodSelection({ primaryWeek: trafficWeek, comparisonWeek: url.searchParams.get("traffic_compare") ?? undefined, aliceMonth, gsc: parseWeekOrMonth(gscPeriod, timezone) }, timezone),
    publicationId: url.searchParams.get("publication"),
    filters,
  };
}

export function defaultPeriodSelection(timezone: string, now = new Date()) {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thursday = new Date(utc);
  thursday.setUTCDate(utc.getUTCDate() + 3 - ((utc.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  const month = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}`;
  return createPeriodSelection({ primaryWeek: `${year}-W${String(week).padStart(2, "0")}`, aliceMonth: month, gsc: calendarMonthPeriod(month, timezone) }, timezone);
}

function base64Url(value: Buffer): string { return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function fromBase64Url(value: string): Buffer { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="), "base64"); }

/** Matches the existing dashboard_viewer_<id> HMAC format without accepting another dashboard's cookie. */
export function createSignedViewerCookieVerifier(secret: string | undefined = process.env.DASHBOARD_AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : "dashboard-dev-secret")) {
  return async (token: string | null, dashboardId: number): Promise<ViewerCookiePayload | null> => {
    if (!secret || !token) return null;
    const [payloadPart, signature] = token.split(".", 2);
    if (!payloadPart || !signature) return null;
    const expected = base64Url(crypto.createHmac("sha256", secret).update(payloadPart).digest());
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const payload = JSON.parse(fromBase64Url(payloadPart).toString("utf8")) as { type?: string; dashboard_id?: number; audience?: string; credential_version?: number; exp?: number };
      if ((payload.type !== "viewer" && payload.type !== "viewer_export") || payload.audience !== "manager" || payload.dashboard_id !== dashboardId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
      return { dashboardId, credentialVersion: payload.credential_version, expiresAt: new Date(payload.exp * 1000).toISOString() };
    } catch { return null; }
  };
}

export async function loadRegistrationFromEnvironment(): Promise<SiteRegistration> {
  const registrationPath = process.env.SITE_SEO_REGISTRATION_PATH?.trim();
  if (!registrationPath) throw new Error("SITE_SEO_REGISTRATION_PATH is required");
  const { assertSiteRegistry } = await import("@reportingdash/site-seo-contract");
  return loadRuntimeRegistration({ registrationPath, readFile: readFileFromDisk, validateRegistrations: assertSiteRegistry });
}

export async function getSiteSeoRuntime() {
  const registration = await loadRegistrationFromEnvironment();
  return {
    registration,
    resolveSession: createSiteSeoSessionResolver({ verifyViewerCookie: createSignedViewerCookieVerifier(), loadCredentialVersion: loadCurrentCredentialVersion }),
    execute: canonicalReadExecutor,
  } as const;
}
