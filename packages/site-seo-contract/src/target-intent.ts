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
  versionId: string;
  label: string;
  state: "ready" | "unavailable";
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
