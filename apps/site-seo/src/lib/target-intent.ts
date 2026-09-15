import type {
  TargetIntentCard,
  TargetIntentClassification,
  TargetIntentClassifiedQuery,
  TargetIntentObservedQuery,
  TargetIntentProvenance,
  TargetIntentRule,
  TargetIntentRuleSet,
  TargetIntentView,
} from "@reportingdash/site-seo-contract";

const DEFAULT_TARGET_LABEL = "Целевой интент";
const OTHER_LABEL = "Остальные запросы";

export function normalizeIntentKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function rulePriority(left: TargetIntentRule, right: TargetIntentRule): number {
  if (left.matchType !== right.matchType) {
    return left.matchType === "exact" ? -1 : 1;
  }
  const leftTokens = left.normalizedKey.split(" ").length;
  const rightTokens = right.normalizedKey.split(" ").length;
  return (
    rightTokens - leftTokens ||
    compareText(left.normalizedKey, right.normalizedKey) ||
    compareText(left.key, right.key) ||
    compareText(left.group ?? "", right.group ?? "")
  );
}

function phraseMatches(query: string, phrase: string): boolean {
  return ` ${query} `.includes(` ${phrase} `);
}

export function classifyTargetIntentQuery(
  query: string,
  rules: readonly TargetIntentRule[],
): TargetIntentClassification {
  const normalizedQuery = normalizeIntentKey(query);
  if (normalizedQuery === "") {
    return {
      category: "other",
      group: null,
      matchedRule: null,
      matchType: null,
    };
  }

  const match = rules
    .filter((candidate) =>
      candidate.matchType === "exact"
        ? candidate.normalizedKey === normalizedQuery
        : phraseMatches(normalizedQuery, candidate.normalizedKey),
    )
    .toSorted(rulePriority)[0];

  if (!match) {
    return {
      category: "other",
      group: null,
      matchedRule: null,
      matchType: null,
    };
  }

  return {
    category: "target",
    group: match.group,
    matchedRule: match.key,
    matchType: match.matchType,
  };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasValidProvenance(
  provenance: TargetIntentProvenance | null,
): provenance is TargetIntentProvenance {
  return Boolean(
    provenance &&
      isNonEmptyText(provenance.importId) &&
      isNonEmptyText(provenance.publicationId) &&
      ["upload", "google_sheet"].includes(provenance.sourceTransport) &&
      isNonEmptyText(provenance.sourceIdentity) &&
      /^[a-f0-9]{64}$/i.test(provenance.contentSha256) &&
      isNonEmptyText(provenance.publishedAt) &&
      !Number.isNaN(Date.parse(provenance.publishedAt)) &&
      isNonEmptyText(provenance.publishedBy) &&
      (provenance.comment === null || typeof provenance.comment === "string"),
  );
}

function hasValidRuleIntegrity(
  ruleSet: TargetIntentRuleSet,
  siteId: string,
  dashboardId: number,
): boolean {
  if (
    ruleSet.state !== "ready" ||
    ruleSet.siteId !== siteId ||
    ruleSet.dashboardId !== dashboardId ||
    !isNonEmptyText(ruleSet.versionId) ||
    !isNonEmptyText(ruleSet.label) ||
    !hasValidProvenance(ruleSet.provenance) ||
    !Array.isArray(ruleSet.rules) ||
    ruleSet.rules.length === 0
  ) {
    return false;
  }

  const normalizedKeys = new Set<string>();
  for (const candidate of ruleSet.rules) {
    if (
      !isNonEmptyText(candidate.key) ||
      !isNonEmptyText(candidate.normalizedKey) ||
      candidate.normalizedKey !== normalizeIntentKey(candidate.key) ||
      !["exact", "phrase"].includes(candidate.matchType) ||
      (candidate.group !== null && !isNonEmptyText(candidate.group)) ||
      normalizedKeys.has(candidate.normalizedKey)
    ) {
      return false;
    }
    normalizedKeys.add(candidate.normalizedKey);
  }
  return true;
}

function hasValidQueryMetrics(query: TargetIntentObservedQuery): boolean {
  return (
    isNonEmptyText(query.query) &&
    ["google", "yandex"].includes(query.source) &&
    Number.isFinite(query.impressions) &&
    query.impressions >= 0 &&
    Number.isFinite(query.clicks) &&
    query.clicks >= 0
  );
}

function unavailableCard(label: string): TargetIntentCard {
  return {
    label,
    impressions: null,
    clicks: null,
    sharePct: null,
    queryCount: null,
  };
}

function unavailableView(
  input: BuildTargetIntentViewInput,
  state: "not_configured" | "unavailable",
  discloseRuleSet = true,
): TargetIntentView {
  const visibleRuleSet = discloseRuleSet ? input.ruleSet : null;
  const configuredLabel = isNonEmptyText(visibleRuleSet?.label)
    ? visibleRuleSet.label.trim()
    : "";
  const requestedLabel = isNonEmptyText(input.label) ? input.label.trim() : "";
  const label = configuredLabel || requestedLabel || DEFAULT_TARGET_LABEL;
  return {
    siteId: input.siteId,
    dashboardId: input.dashboardId,
    versionId: isNonEmptyText(visibleRuleSet?.versionId)
      ? visibleRuleSet.versionId
      : null,
    label,
    state,
    provenance: hasValidProvenance(visibleRuleSet?.provenance ?? null)
      ? visibleRuleSet!.provenance
      : null,
    target: unavailableCard(label),
    other: unavailableCard(OTHER_LABEL),
    queries: [],
  };
}

export type BuildTargetIntentViewInput = Readonly<{
  siteId: string;
  dashboardId: number;
  label: string;
  ruleSet: TargetIntentRuleSet | null;
  queries: readonly TargetIntentObservedQuery[];
}>;

export function buildTargetIntentView(
  input: BuildTargetIntentViewInput,
): TargetIntentView {
  if (input.ruleSet === null) return unavailableView(input, "not_configured");
  if (input.ruleSet.state === "not_configured") return unavailableView(input, "not_configured");
  if (
    input.ruleSet.siteId !== input.siteId ||
    input.ruleSet.dashboardId !== input.dashboardId
  ) {
    return unavailableView(input, "unavailable", false);
  }
  if (
    !hasValidRuleIntegrity(input.ruleSet, input.siteId, input.dashboardId) ||
    input.queries.some((query) => !hasValidQueryMetrics(query))
  ) {
    return unavailableView(input, "unavailable");
  }

  const classified: TargetIntentClassifiedQuery[] = input.queries
    .filter(({ impressions }) => impressions > 0)
    .map((query) => ({
      ...query,
      ...classifyTargetIntentQuery(query.query, input.ruleSet!.rules),
    }))
    .toSorted(
      (left, right) =>
        right.impressions - left.impressions ||
        right.clicks - left.clicks ||
        compareText(left.query, right.query) ||
        compareText(left.source, right.source),
    );

  const totalImpressions = classified.reduce(
    (sum, query) => sum + query.impressions,
    0,
  );
  const card = (
    category: TargetIntentClassification["category"],
    label: string,
  ): TargetIntentCard => {
    const rows = classified.filter((query) => query.category === category);
    const impressions = rows.reduce((sum, query) => sum + query.impressions, 0);
    return {
      label,
      impressions,
      clicks: rows.reduce((sum, query) => sum + query.clicks, 0),
      sharePct:
        totalImpressions > 0
          ? Math.round((impressions / totalImpressions) * 100_000_000) /
            1_000_000
          : null,
      queryCount: rows.length,
    };
  };

  return {
    siteId: input.siteId,
    dashboardId: input.dashboardId,
    versionId: input.ruleSet.versionId,
    label: input.ruleSet.label,
    state: "ready",
    provenance: input.ruleSet.provenance,
    target: card("target", input.ruleSet.label),
    other: card("other", OTHER_LABEL),
    queries: classified,
  };
}
