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

function copyAbbottUrlContainers(data: NonNullable<DashboardData["abbott_bi"]>) {
  const rows = <T extends object>(items: T[]): T[] => items.map(row => ({ ...row }));
  return {
    ...data,
    user_actions: rows(data.user_actions),
    page_stats: rows(data.page_stats),
    bitrix_pages: rows(data.bitrix_pages),
    session_journeys: { ...data.session_journeys, rows: rows(data.session_journeys.rows) },
    external_events: rows(data.external_events),
    external_clicks: rows(data.external_clicks),
    time_buckets: { ...data.time_buckets, by_page: rows(data.time_buckets.by_page) },
    returning: rows(data.returning),
    return_frequency: { ...data.return_frequency, return_pages: rows(data.return_frequency.return_pages) },
    general_materials: rows(data.general_materials),
  };
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
  data.return_frequency.return_pages.forEach((row) => {
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
  if (normalized === "raw_user_ids_json" || normalized === "raw_user_ids") return true;
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

  if (audience === "manager") {
    const sanitizedAbbott = copyAbbottUrlContainers(data.abbott_bi);
    sanitizeKnownAbbottUrlFields(sanitizedAbbott);
    return { ...data, abbott_bi: sanitizedAbbott };
  }

  const aggregateAbbott = Object.fromEntries(
    Object.entries(data.abbott_bi).filter(([key]) => ![
      "users_summary",
      "users_summary_without_admins",
      "user_actions",
      "admin_user_filter",
    ].includes(key)),
  ) as unknown as NonNullable<DashboardData["abbott_bi"]>;
  aggregateAbbott.session_journeys = {
    ...aggregateAbbott.session_journeys,
    rows: [],
  };
  aggregateAbbott.return_frequency = {
    available: false,
    period_local: true,
    identified_visitors: 0,
    unidentified_visits: 0,
    groups: [],
    user_directions: [],
    return_pages: [],
  };
  // Drop private branches before copying/sanitizing retained URL-bearing rows.
  const sanitizedAbbott = copyAbbottUrlContainers({ ...aggregateAbbott, user_actions: [] });
  sanitizeKnownAbbottUrlFields(sanitizedAbbott);

  return removeForbiddenEmbedKeys({
    ...data,
    abbott_bi: sanitizedAbbott,
  }) as DashboardData;
}
