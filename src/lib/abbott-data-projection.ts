import type { DashboardData } from "@/lib/types";

type DashboardAudience = "manager" | "embed";

function stripUrlQueryAndFragment(value: string): string {
  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  return indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value;
}

function stripPathSummarySecrets(value: string): string {
  return value
    .split(/(\s*(?:->|→)\s*)/)
    .map((part) => {
      if (/^(?:\s*(?:->|→)\s*)$/.test(part)) return part;

      const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!match) return part;
      const [, leading, body, trailing] = match;
      const punctuation = body.match(/[,.;:)]*$/)?.[0] ?? "";
      const url = punctuation ? body.slice(0, -punctuation.length) : body;
      return `${leading}${stripUrlQueryAndFragment(url)}${punctuation}${trailing}`;
    })
    .join("");
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]),
  ) as T;
}

function sanitizeKnownAbbottUrlFields(data: NonNullable<DashboardData["abbott_bi"]>) {
  data.user_actions.forEach((row) => {
    row.start_url = stripUrlQueryAndFragment(row.start_url);
    row.end_url = stripUrlQueryAndFragment(row.end_url);
  });
  data.page_stats.forEach((row) => {
    row.url = stripUrlQueryAndFragment(row.url);
  });
  data.bitrix_pages.forEach((row) => {
    row.url = stripUrlQueryAndFragment(row.url);
    row.path = stripUrlQueryAndFragment(row.path);
  });
  data.session_journeys.rows.forEach((row) => {
    row.entry_url_day = stripUrlQueryAndFragment(row.entry_url_day);
    row.exit_url_day = stripUrlQueryAndFragment(row.exit_url_day);
    row.entry_url_session = stripUrlQueryAndFragment(row.entry_url_session);
    row.exit_url_session = stripUrlQueryAndFragment(row.exit_url_session);
    row.content_path = row.content_path.map(stripUrlQueryAndFragment);
    row.content_path_summary = stripPathSummarySecrets(row.content_path_summary);
    row.all_path_summary = stripPathSummarySecrets(row.all_path_summary);
  });
  data.external_events.forEach((row) => {
    row.registration_url = stripUrlQueryAndFragment(row.registration_url);
  });
  data.external_clicks.forEach((row) => {
    row.external_url = stripUrlQueryAndFragment(row.external_url);
  });
  data.time_buckets.by_page.forEach((row) => {
    row.url = stripUrlQueryAndFragment(row.url);
  });
  data.returning.forEach((row) => {
    row.url = stripUrlQueryAndFragment(row.url);
  });
  data.general_materials.forEach((row) => {
    row.url = stripUrlQueryAndFragment(row.url);
  });
}

function normalizeIdentifierKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isForbiddenEmbedKey(key: string): boolean {
  const normalized = normalizeIdentifierKey(key);
  if (normalized === "user_actions") return true;
  if (/^(?:has|is)_/.test(normalized)) return false;
  if (/^(?:sessions|users|visits)(?:_|$)/.test(normalized)) return false;
  return /(?:^|_)(?:raw_)?(?:user|session|visit)_(?:id|identifier)s?$/.test(normalized);
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
      .filter(([key]) => !isForbiddenEmbedKey(key))
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

  const projected = cloneValue(data);
  const sanitizedAbbott = projected.abbott_bi;
  if (!sanitizedAbbott) return projected;
  sanitizeKnownAbbottUrlFields(sanitizedAbbott);
  if (audience === "manager") {
    return projected;
  }

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
