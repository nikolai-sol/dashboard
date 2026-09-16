export type SiteSeoSession = Readonly<{
  audience: "viewer" | "manager";
  family: "site_seo";
  dashboardId: number;
  siteId: string;
  credentialVersion: number;
  expiresAt: string;
}>;

export type RequiredSiteAccess = Readonly<{
  dashboardId: number;
  siteId: string;
  credentialVersion: number;
}>;

export function assertAuthorizedSiteSession(
  session: SiteSeoSession | null,
  access: RequiredSiteAccess,
  now = Date.now(),
): SiteSeoSession {
  if (!session || session.family !== "site_seo") throw new Error("Authentication required");
  if (session.dashboardId !== access.dashboardId) throw new Error("Session dashboard does not match");
  if (session.siteId !== access.siteId) throw new Error("Session site does not match");
  if (session.credentialVersion !== access.credentialVersion) throw new Error("Session credential version is stale");
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) {
    throw new Error("Session is expired");
  }
  return session;
}
