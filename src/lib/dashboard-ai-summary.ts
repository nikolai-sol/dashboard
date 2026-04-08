import type {
  ChannelPerformanceItem,
  ComparisonData,
  ComparisonMetricDelta,
  DashboardAiSummary,
  DashboardAiSummaryReason,
  DashboardData,
  PlatformStats,
} from "@/lib/types";

type GenerateDashboardAiSummaryOptions = {
  cacheKey?: string;
};

export type DashboardAiSummaryAuthoring = {
  override_text: string;
  updated_at?: string;
  updated_by?: string | null;
};

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  cacheTtlMs: number;
};

type SummaryPromptPayload = {
  context: {
    client_name: string;
    dashboard_name: string;
    dashboard_type: DashboardData["dashboard"]["type"];
    language: DashboardData["dashboard"]["language"];
    currency: string;
    period: DashboardData["dashboard"]["period"];
    active_brand?: string;
    compare_period?: ComparisonData["period_b"];
  };
  display_rules: {
    show_spend: boolean;
    visible_metrics: string[];
  };
  kpi_snapshot: Record<string, number>;
  comparison?: Array<{
    metric: string;
    value_a: number;
    value_b: number;
    delta: number;
    delta_pct: number;
    direction: ComparisonMetricDelta["direction"];
  }>;
  top_platforms: Array<Record<string, string | number>>;
  channel_watchouts: Array<{
    channel: string;
    instrument: string;
    metric: string;
    completion_pct: number | null;
    status: "green" | "yellow" | "red" | null | undefined;
    fact: number;
    plan: number;
  }>;
  promopages?: {
    impressions: number;
    clicks: number;
    budget: number;
    clickouts: number;
    full_reads: number;
    metrica_visits: number;
  };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

const MONEY_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
const DEFAULT_TIMEOUT_MS = 1_800;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_TOP_PLATFORMS = 5;
const MAX_CHANNEL_WATCHOUTS = 3;
const summaryCache = new Map<string, { expiresAt: number; value: DashboardAiSummary }>();

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function getProviderConfig(): ProviderConfig | null {
  const apiKey = process.env.AI_SUMMARY_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.AI_SUMMARY_MODEL?.trim() || "gemini-2.5-flash",
    baseUrl: (
      process.env.AI_SUMMARY_BASE_URL?.trim() ||
      "https://generativelanguage.googleapis.com/v1beta/openai"
    ).replace(/\/+$/, ""),
    timeoutMs: toPositiveInt(process.env.AI_SUMMARY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    cacheTtlMs: toPositiveInt(process.env.AI_SUMMARY_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
  };
}

function buildFallback(
  status: Exclude<DashboardAiSummary["status"], "ready">,
  reason: DashboardAiSummaryReason,
): DashboardAiSummary {
  return {
    status,
    reason,
    generated_at: new Date().toISOString(),
  };
}

function normalizeTextLine(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+/, "")
    .trim();
}

function stripFieldLabel(value: string, label: string): string {
  if (value.toLowerCase().startsWith(label.toLowerCase())) {
    return value.slice(label.length).trim();
  }
  return value;
}

function getActiveBrandLabel(data: DashboardData): string | undefined {
  const multibrand = data.dashboard.multibrand;
  if (!multibrand?.active_brand_id) return undefined;
  return multibrand.brands.find((brand) => brand.id === multibrand.active_brand_id)?.label;
}

function getVisibleMetrics(data: DashboardData): string[] {
  const candidates = (data.visible_metrics?.length ? data.visible_metrics : data.kpi_config)
    .filter((metric): metric is string => Boolean(metric))
    .filter((metric) => data.dashboard.show_spend || !MONEY_METRICS.has(metric));

  if (candidates.length > 0) {
    return Array.from(new Set(candidates));
  }

  return data.dashboard.show_spend
    ? ["impressions", "clicks", "ctr", "spend", "conversions"]
    : ["impressions", "clicks", "ctr", "conversions"];
}

function hasMeaningfulData(data: DashboardData): boolean {
  const totals = [
    data.kpi.total_impressions,
    data.kpi.total_clicks,
    data.kpi.total_conversions,
    data.dashboard.show_spend ? data.kpi.total_spend : 0,
  ];

  return (
    totals.some((value) => value > 0) ||
    data.platforms.some((platform) => platform.impressions > 0 || platform.clicks > 0 || platform.conversions > 0) ||
    data.plan_vs_fact.some((row) => row.impressions_fact > 0 || row.clicks_fact > 0 || row.conversions_fact > 0) ||
    Boolean(data.channel_performance?.length) ||
    Boolean(data.promopages?.campaigns.length) ||
    Boolean(data.analytics?.timeseries.length)
  );
}

function pickKpiSnapshot(data: DashboardData, visibleMetrics: string[]): Record<string, number> {
  const visible = new Set(visibleMetrics);
  const snapshot: Record<string, number> = {};
  const candidates: Array<[string, number]> = [
    ["impressions", data.kpi.total_impressions],
    ["clicks", data.kpi.total_clicks],
    ["ctr", data.kpi.avg_ctr],
    ["conversions", data.kpi.total_conversions],
    ["spend", data.kpi.total_spend],
    ["cpm", data.kpi.avg_cpm],
  ];

  for (const [metric, value] of candidates) {
    if (!visible.has(metric)) continue;
    if (!data.dashboard.show_spend && MONEY_METRICS.has(metric)) continue;
    snapshot[metric] = value;
  }

  return snapshot;
}

function sortPlatformsForSummary(platforms: PlatformStats[], showSpend: boolean): PlatformStats[] {
  const sorted = [...platforms].sort((left, right) => {
    const leftScore = showSpend ? left.spend : left.impressions;
    const rightScore = showSpend ? right.spend : right.impressions;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return right.clicks - left.clicks;
  });

  return sorted.slice(0, MAX_TOP_PLATFORMS);
}

function pickTopPlatforms(data: DashboardData, visibleMetrics: string[]): Array<Record<string, string | number>> {
  const visible = new Set(visibleMetrics);

  return sortPlatformsForSummary(data.platforms, data.dashboard.show_spend).map((platform) => {
    const summary: Record<string, string | number> = {
      platform: platform.name,
      impressions: platform.impressions,
      clicks: platform.clicks,
      conversions: platform.conversions,
    };

    if (visible.has("ctr")) summary.ctr = platform.ctr;
    if (data.dashboard.show_spend && visible.has("spend")) summary.spend = platform.spend;
    if (data.dashboard.show_spend && visible.has("cpm")) summary.cpm = platform.cpm;
    if (visible.has("views")) summary.views = platform.views;
    if (visible.has("reach")) summary.reach = platform.reach;

    return summary;
  });
}

function pickComparisonSummary(data: DashboardData, visibleMetrics: string[]): SummaryPromptPayload["comparison"] {
  if (!data.comparison) return undefined;

  const visible = new Set(visibleMetrics);
  return Object.entries(data.comparison.kpi_comparison)
    .filter(([metric]) => visible.has(metric))
    .map(([metric, delta]) => ({
      metric,
      value_a: delta.value_a,
      value_b: delta.value_b,
      delta: delta.delta,
      delta_pct: delta.delta_pct,
      direction: delta.direction,
    }))
    .sort((left, right) => Math.abs(right.delta_pct) - Math.abs(left.delta_pct))
    .slice(0, 5);
}

function pickChannelWatchouts(data: DashboardData, visibleMetrics: string[]): SummaryPromptPayload["channel_watchouts"] {
  const visible = new Set(visibleMetrics);
  const watchouts: SummaryPromptPayload["channel_watchouts"] = [];

  for (const row of data.channel_performance ?? []) {
    for (const metric of visibleMetrics) {
      const summary = row.metrics[metric as keyof ChannelPerformanceItem["metrics"]];
      if (!summary) continue;
      if (!data.dashboard.show_spend && MONEY_METRICS.has(metric)) continue;
      if (summary.status !== "red" && summary.status !== "yellow") continue;

      watchouts.push({
        channel: row.channel,
        instrument: row.instrument,
        metric,
        completion_pct: summary.completion_pct,
        status: summary.status,
        fact: summary.fact,
        plan: summary.plan,
      });
    }
  }

  return watchouts
    .sort((left, right) => {
      const leftSeverity = left.status === "red" ? 2 : 1;
      const rightSeverity = right.status === "red" ? 2 : 1;
      if (rightSeverity !== leftSeverity) return rightSeverity - leftSeverity;
      return (left.completion_pct ?? 100) - (right.completion_pct ?? 100);
    })
    .slice(0, MAX_CHANNEL_WATCHOUTS)
    .filter((row) => visible.has(row.metric));
}

function buildPromptPayload(data: DashboardData): SummaryPromptPayload {
  const visibleMetrics = getVisibleMetrics(data);

  return {
    context: {
      client_name: data.dashboard.client_name,
      dashboard_name: data.dashboard.dashboard_name,
      dashboard_type: data.dashboard.type,
      language: data.dashboard.language,
      currency: data.dashboard.currency,
      period: data.dashboard.period,
      active_brand: getActiveBrandLabel(data),
      compare_period: data.comparison?.period_b,
    },
    display_rules: {
      show_spend: data.dashboard.show_spend,
      visible_metrics: visibleMetrics,
    },
    kpi_snapshot: pickKpiSnapshot(data, visibleMetrics),
    comparison: pickComparisonSummary(data, visibleMetrics),
    top_platforms: pickTopPlatforms(data, visibleMetrics),
    channel_watchouts: pickChannelWatchouts(data, visibleMetrics),
    promopages: data.promopages
      ? {
          impressions: data.promopages.kpi.total_impressions,
          clicks: data.promopages.kpi.total_clicks,
          budget: data.promopages.kpi.total_budget,
          clickouts: data.promopages.kpi.total_clickouts,
          full_reads: data.promopages.kpi.total_full_reads,
          metrica_visits: data.promopages.kpi.total_metrica_visits,
        }
      : undefined,
  };
}

function buildSystemPrompt(language: DashboardData["dashboard"]["language"]): string {
  const outputLanguage =
    language === "ru"
      ? "Write the response in Russian."
      : "Write the response in English.";

  return [
    "You are writing a concise dashboard narrative for a paid media report.",
    outputLanguage,
    "Use only the provided JSON payload. Do not infer missing metrics or mention unavailable comparisons.",
    "Return valid JSON with this exact shape: {\"headline\": string, \"bullets\": string[], \"watchout\": string | null}.",
    "Constraints:",
    "- headline must be one short sentence.",
    "- bullets must contain 1 to 3 grounded insights.",
    "- watchout is optional and should only be set when there is a clear decline, pacing risk, or missing comparison context.",
    "- If comparison data is absent, comment only on the current period.",
    "- Respect show_spend: never reference spend-derived metrics when show_spend is false.",
    "- Every statement must be traceable to the payload.",
    "- Do not include markdown, numbering, or extra keys.",
  ].join("\n");
}

function buildUserPrompt(payload: SummaryPromptPayload): string {
  return JSON.stringify(payload, null, 2);
}

function extractMessageText(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("").trim();
  }
  return "";
}

function extractJsonObject(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  return trimmed.slice(start, end + 1);
}

function normalizeModelOutput(rawText: string): DashboardAiSummary {
  const json = extractJsonObject(rawText);
  if (!json) {
    throw new Error("response_empty");
  }

  const parsed = JSON.parse(json) as {
    headline?: unknown;
    bullets?: unknown;
    watchout?: unknown;
  };

  const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const watchout =
    typeof parsed.watchout === "string" && parsed.watchout.trim()
      ? parsed.watchout.trim()
      : null;

  if (!headline || bullets.length === 0) {
    throw new Error("invalid_response");
  }

  return {
    status: "ready",
    headline,
    bullets,
    watchout,
    generated_at: new Date().toISOString(),
  };
}

async function requestSummaryFromProvider(
  payload: SummaryPromptPayload,
  config: ProviderConfig,
  signal: AbortSignal,
): Promise<DashboardAiSummary> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt(payload.context.language) },
        { role: "user", content: buildUserPrompt(payload) },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`request_failed:${response.status}`);
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const content = extractMessageText(body);
  return normalizeModelOutput(content);
}

function getCachedSummary(cacheKey: string): DashboardAiSummary | null {
  const cached = summaryCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    summaryCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedSummary(cacheKey: string, summary: DashboardAiSummary, ttlMs: number) {
  summaryCache.set(cacheKey, {
    value: summary,
    expiresAt: Date.now() + ttlMs,
  });
}

function mapErrorToFallback(error: unknown): DashboardAiSummary {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return buildFallback("timeout", "timeout");
    }
    if (error.message === "response_empty") {
      return buildFallback("error", "response_empty");
    }
    if (error.message === "invalid_response") {
      return buildFallback("error", "invalid_response");
    }
  }
  return buildFallback("error", "request_failed");
}

export function buildDashboardAiSummaryCacheKey(request: Request, dashboardId: string): string {
  const url = new URL(request.url);
  const params = ["from", "to", "compare_from", "compare_to", "brand"]
    .map((key) => `${key}=${url.searchParams.get(key) ?? ""}`)
    .join("&");
  return `${dashboardId}:${params}`;
}

export function normalizeDashboardAiSummaryAuthoring(value: unknown): DashboardAiSummaryAuthoring | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const overrideText = typeof candidate.override_text === "string" ? candidate.override_text.trim() : "";
  if (!overrideText) {
    return null;
  }

  return {
    override_text: overrideText,
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : undefined,
    updated_by:
      typeof candidate.updated_by === "string"
        ? candidate.updated_by
        : candidate.updated_by === null
          ? null
          : undefined,
  };
}

export function buildDashboardAiSummaryFromOverrideText(
  overrideText: string,
  updatedAt?: string,
): DashboardAiSummary | null {
  const lines = overrideText
    .split(/\r?\n/)
    .map((line) => normalizeTextLine(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  let headline = "";
  const bullets: string[] = [];
  let watchout: string | null = null;

  for (const rawLine of lines) {
    const line = stripFieldLabel(stripFieldLabel(rawLine, "headline:"), "title:");
    if (!headline) {
      headline = line;
      continue;
    }

    const watchoutText = stripFieldLabel(stripFieldLabel(rawLine, "watchout:"), "risk:");
    if (watchoutText !== rawLine && watchoutText) {
      watchout = watchoutText;
      continue;
    }

    bullets.push(line);
  }

  if (!headline) {
    return null;
  }

  return {
    status: "ready",
    headline,
    bullets: bullets.length > 0 ? bullets : undefined,
    watchout,
    generated_at: updatedAt ?? new Date().toISOString(),
  };
}

export async function generateDashboardAiSummary(
  data: DashboardData,
  options: GenerateDashboardAiSummaryOptions = {},
): Promise<DashboardAiSummary> {
  const cacheKey = options.cacheKey;
  if (cacheKey) {
    const cached = getCachedSummary(cacheKey);
    if (cached) return cached;
  }

  if (!hasMeaningfulData(data)) {
    const fallback = buildFallback("unavailable", "insufficient_data");
    if (cacheKey) setCachedSummary(cacheKey, fallback, DEFAULT_CACHE_TTL_MS);
    return fallback;
  }

  const provider = getProviderConfig();
  if (!provider) {
    const fallback = buildFallback("unavailable", "provider_not_configured");
    if (cacheKey) setCachedSummary(cacheKey, fallback, DEFAULT_CACHE_TTL_MS);
    return fallback;
  }

  const payload = buildPromptPayload(data);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), provider.timeoutMs);

  try {
    const summary = await requestSummaryFromProvider(payload, provider, controller.signal);
    if (cacheKey) {
      setCachedSummary(cacheKey, summary, provider.cacheTtlMs);
    }
    return summary;
  } catch (error) {
    console.warn("AI summary generation failed:", error);
    return mapErrorToFallback(error);
  } finally {
    clearTimeout(timeoutId);
  }
}
