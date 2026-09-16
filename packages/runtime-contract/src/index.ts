export type DashboardRuntimeScope = "combined" | "advertising" | "zaruku" | "abbott" | "site_seo";
export type DashboardFamily = Exclude<DashboardRuntimeScope, "combined">;
export type DashboardIdentity = { clientId: string; dashboardType: string; siteSlug?: string };

export { RUNTIME_MANIFESTS } from "./manifest.mjs";

export function resolveDashboardFamily(identity: DashboardIdentity): DashboardFamily {
  const clientId = identity.clientId.trim().toLowerCase();
  if (clientId === "zaruku" || identity.dashboardType === "zaruku_bi") return "zaruku";
  if (clientId === "abbott" || identity.dashboardType === "abbott_bi") return "abbott";
  if (identity.dashboardType === "site_seo") return "site_seo";
  return "advertising";
}

export function runtimeOwnsDashboard(scope: DashboardRuntimeScope, identity: DashboardIdentity, siteSlug?: string): boolean {
  if (scope === "combined") return true;
  if (scope !== resolveDashboardFamily(identity)) return false;
  return scope !== "site_seo" || (Boolean(siteSlug) && identity.siteSlug === siteSlug);
}

export function runtimeOwnsPath(scope: DashboardRuntimeScope, pathname: string, siteSlug?: string): boolean {
  if (scope === "combined") return true;
  if (scope === "site_seo") {
    if (!siteSlug || !/^[a-z0-9][a-z0-9-]*$/.test(siteSlug)) return false;
    return pathname === `/dashboard/${siteSlug}` || pathname.startsWith(`/dashboard/${siteSlug}/`)
      || pathname === `/api/dashboard/${siteSlug}` || pathname.startsWith(`/api/dashboard/${siteSlug}/`)
      || pathname === `/_next-${siteSlug}` || pathname.startsWith(`/_next-${siteSlug}/`)
      || pathname === "/api/health";
  }
  if (pathname === "/dashboard/zaruku" || pathname.startsWith("/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/api/dashboard/zaruku" || pathname.startsWith("/api/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/dashboard/abbott" || pathname.startsWith("/dashboard/abbott/")) return scope === "abbott";
  if (pathname === "/api/dashboard/abbott" || pathname.startsWith("/api/dashboard/abbott/")) return scope === "abbott";
  return scope === "advertising";
}
