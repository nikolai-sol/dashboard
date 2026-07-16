import type { DashboardData } from "@/lib/types";

type DashboardAudience = "manager" | "embed";

const EMBED_FORBIDDEN_KEYS = new Set(["user_id", "session_id", "user_actions"]);

function stripAbsoluteUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function stripUrlQueryAndFragment(value: string): string {
  const withoutAbsoluteSecrets = value.replace(
    /https?:\/\/[^\s<>"']+/gi,
    stripAbsoluteUrlSecrets,
  );

  return withoutAbsoluteSecrets.replace(
    /\/(?!\/)[^\s<>"']*[?#][^\s<>"']*/g,
    (urlPath) => urlPath.split(/[?#]/, 1)[0] ?? urlPath,
  );
}

function cloneAndSanitizeUrls<T>(value: T): T {
  if (typeof value === "string") {
    return stripUrlQueryAndFragment(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneAndSanitizeUrls(item)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneAndSanitizeUrls(nested)]),
  ) as T;
}

function removeForbiddenEmbedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeForbiddenEmbedKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !EMBED_FORBIDDEN_KEYS.has(key))
      .map(([key, nested]) => [key, removeForbiddenEmbedKeys(nested)]),
  );
}

export function projectAbbottDashboardData(
  data: DashboardData,
  audience: DashboardAudience,
): DashboardData {
  if (data.dashboard.type !== "abbott_bi" || !data.abbott_bi) {
    return data;
  }

  const projected = cloneAndSanitizeUrls(data);
  if (audience === "manager") {
    return projected;
  }

  const sanitizedAbbott = projected.abbott_bi;
  if (!sanitizedAbbott) return projected;
  const aggregateAbbott = Object.fromEntries(
    Object.entries(sanitizedAbbott).filter(([key]) => key !== "users_summary"),
  ) as unknown as NonNullable<DashboardData["abbott_bi"]>;
  aggregateAbbott.session_journeys = {
    ...aggregateAbbott.session_journeys,
    rows: [],
  };

  return removeForbiddenEmbedKeys({
    ...projected,
    abbott_bi: aggregateAbbott,
  }) as DashboardData;
}
