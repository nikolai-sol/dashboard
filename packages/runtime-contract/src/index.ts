export type DashboardRuntimeScope = "combined" | "advertising" | "zaruku" | "abbott";
export type DashboardFamily = Exclude<DashboardRuntimeScope, "combined">;
export type DashboardIdentity = { clientId: string; dashboardType: string };

export { RUNTIME_MANIFESTS } from "./manifest.mjs";

const ABBOTT_PATHS = new Set([
  "/dashboard/18", "/dashboard/18/", "/dashboard/abbott", "/dashboard/abbott/",
  "/api/dashboard/18", "/api/dashboard/18/pdf", "/api/dashboard/18/excel",
  "/api/dashboard/18/abbott-admin-users", "/api/dashboard/abbott",
  "/api/dashboard/abbott/pdf", "/api/dashboard/abbott/excel",
  "/api/dashboard/abbott/abbott-admin-users",
]);

export function normalizeAbbottIdentifier(identifier: string): "abbott" | null {
  const value = identifier.trim().toLowerCase();
  return value === "18" || value === "abbott" ? "abbott" : null;
}

export function resolveDashboardFamily(identity: DashboardIdentity): DashboardFamily {
  const clientId = identity.clientId.trim().toLowerCase();
  if (clientId === "zaruku" || identity.dashboardType === "zaruku_bi") return "zaruku";
  if (clientId === "abbott" || identity.dashboardType === "abbott_bi") return "abbott";
  return "advertising";
}

export function runtimeOwnsDashboard(scope: DashboardRuntimeScope, identity: DashboardIdentity): boolean {
  return scope === "combined" || scope === resolveDashboardFamily(identity);
}

export function runtimeOwnsPath(scope: DashboardRuntimeScope, pathname: string): boolean {
  if (scope === "combined") return true;
  if (ABBOTT_PATHS.has(pathname)) return scope === "abbott";
  if (pathname === "/dashboard/zaruku" || pathname.startsWith("/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/api/dashboard/zaruku" || pathname.startsWith("/api/dashboard/zaruku/")) return scope === "zaruku";
  return scope === "advertising";
}
