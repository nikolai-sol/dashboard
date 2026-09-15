/** One canonical normalization for source rules, observed queries and integrity checks. */
export function normalizeIntentKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export type TargetIntentMatchType = "exact" | "phrase";

export type TargetIntentRule = Readonly<{
  key: string;
  normalizedKey: string;
  group: string | null;
  matchType: TargetIntentMatchType;
}>;

export type TargetIntentProvenance = Readonly<{
  importId: string;
  publicationId: string;
  sourceTransport: "upload" | "google_sheet";
  sourceIdentity: string;
  contentSha256: string;
  publishedAt: string;
  publishedBy: string;
  comment: string | null;
}>;

export type TargetIntentRuleSet = Readonly<{
  siteId: string;
  dashboardId: number;
  versionId: string | null;
  label: string;
  state: "ready" | "not_configured" | "unavailable";
  rules: readonly TargetIntentRule[];
  provenance: TargetIntentProvenance | null;
}>;

export type TargetIntentObservedQuery = Readonly<{
  query: string;
  source: "google" | "yandex";
  impressions: number;
  clicks: number;
}>;

export type TargetIntentClassification = Readonly<{
  category: "target" | "other";
  group: string | null;
  matchedRule: string | null;
  matchType: TargetIntentMatchType | null;
}>;

export function classifyTargetIntentQuery(query: string, rules: readonly TargetIntentRule[]): TargetIntentClassification {
  const normalized = normalizeIntentKey(query);
  const matches = normalized ? rules.filter(rule => rule.matchType === "exact"
    ? rule.normalizedKey === normalized
    : ` ${normalized} `.includes(` ${rule.normalizedKey} `)) : [];
  const textOrder = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  matches.sort((a, b) => (a.matchType === b.matchType ? 0 : a.matchType === "exact" ? -1 : 1)
    || b.normalizedKey.split(" ").length - a.normalizedKey.split(" ").length
    || textOrder(a.normalizedKey, b.normalizedKey) || textOrder(a.key, b.key) || textOrder(a.group ?? "", b.group ?? ""));
  const match = matches[0];
  return match ? { category: "target", group: match.group, matchedRule: match.key, matchType: match.matchType }
    : { category: "other", group: null, matchedRule: null, matchType: null };
}

/** Admin-only bounded examples, with each source's actual canonical period. */
export type TargetIntentObservedSample = Readonly<{
  source: "google" | "yandex";
  state: "ready" | "empty" | "unavailable";
  periodFrom: string | null;
  periodTo: string | null;
  sampledQueryCount: number;
  matches: readonly TargetIntentClassifiedQuery[];
}>;

export type TargetIntentClassifiedQuery = TargetIntentObservedQuery &
  TargetIntentClassification;

export type TargetIntentCard = Readonly<{
  label: string;
  impressions: number | null;
  clicks: number | null;
  sharePct: number | null;
  queryCount: number | null;
}>;

export type TargetIntentView = Readonly<{
  siteId: string;
  dashboardId: number;
  versionId: string | null;
  label: string;
  state: "ready" | "not_configured" | "unavailable";
  provenance: TargetIntentProvenance | null;
  target: TargetIntentCard;
  other: TargetIntentCard;
  queries: readonly TargetIntentClassifiedQuery[];
}>;
