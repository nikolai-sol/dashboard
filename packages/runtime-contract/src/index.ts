export type DashboardRuntimeScope = "combined" | "advertising" | "zaruku" | "abbott";
export type DashboardFamily = Exclude<DashboardRuntimeScope, "combined">;
export type DashboardIdentity = { clientId: string; dashboardType: string };

export { RUNTIME_MANIFESTS } from "./manifest.mjs";

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
  if (pathname === "/dashboard/zaruku" || pathname.startsWith("/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/api/dashboard/zaruku" || pathname.startsWith("/api/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/dashboard/abbott" || pathname.startsWith("/dashboard/abbott/")) return scope === "abbott";
  if (pathname === "/api/dashboard/abbott" || pathname.startsWith("/api/dashboard/abbott/")) return scope === "abbott";
  return scope === "advertising";
}
