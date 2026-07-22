import { isSharedPasswordClient } from "./shared-password-policy";

export type DashboardAuthMode = "public" | "email_password" | "password_only";
export type DashboardAudience = "manager" | "embed";

export function isProtectedClient(clientId: string) {
  return String(clientId ?? "").trim().toLowerCase() === "abbott";
}

export function resolveDashboardAuthMode(
  clientId: string,
  activeUsers: number,
  hasSharedPassword: boolean,
): DashboardAuthMode {
  if (isSharedPasswordClient(clientId)) return "password_only";
  if (activeUsers > 0) return "email_password";
  if (isProtectedClient(clientId) || hasSharedPassword) return "password_only";
  return "public";
}

export function resolveDashboardAudience(
  reason: "authorized" | "embed_key",
  payload?: { audience: DashboardAudience },
): DashboardAudience {
  if (reason === "embed_key") return "embed";
  return payload?.audience ?? "manager";
}
