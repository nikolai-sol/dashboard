import Papa from "papaparse";

export interface MediaPlanRow {
  platform: string;
  channel: string;
  format: string;
  buy_type: "CPM" | "CPC" | "CPV" | "CPA";
  units_plan: number;
  unit_price: number;
  budget_plan: number;
  impressions_plan: number;
  reach_plan: number;
  frequency_plan: number;
  views_plan: number;
  clicks_plan: number;
  conversions_plan: number;
  ctr_plan: number;
  cpm_plan: number;
  cpc_plan: number;
  cpv_plan: number;
  cpa_plan: number;
  [key: string]: string | number;
}

export interface ChannelPlanAggregate {
  channel: string;
  buy_type: string;
  platforms: string[];
  budget_plan: number;
  impressions_plan: number;
  clicks_plan: number;
  views_plan: number;
  conversions_plan: number;
  reach_plan: number;
  cpm_plan: number;
  cpc_plan: number;
  cpv_plan: number;
  cpa_plan: number;
  lines: MediaPlanRow[];
}

export interface PlatformPlanAggregate {
  budget_plan: number;
  impressions_plan: number;
  clicks_plan: number;
  views_plan: number;
  conversions_plan: number;
}

const cacheByUrl = new Map<string, { data: MediaPlanRow[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseNumeric(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const cleaned = raw
    .replace(/[€$£₽\s]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{1,3}(\D|$))/g, ".")
    .replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function normalizeBuyType(raw: unknown): MediaPlanRow["buy_type"] {
  const value = String(raw ?? "CPM").trim().toUpperCase();
  if (value === "CPC" || value === "CPV" || value === "CPA") {
    return value;
  }
  return "CPM";
}

function normalizeRow(raw: Record<string, unknown>): MediaPlanRow {
  return {
    platform: String(raw.platform ?? "").trim().toLowerCase(),
    channel: String(raw.channel ?? "").trim(),
    format: String(raw.format ?? "").trim(),
    buy_type: normalizeBuyType(raw.buy_type),
    units_plan: parseNumeric(raw.units_plan),
    unit_price: parseNumeric(raw.unit_price),
    budget_plan: parseNumeric(raw.budget_plan),
    impressions_plan: parseNumeric(raw.impressions_plan),
    reach_plan: parseNumeric(raw.reach_plan),
    frequency_plan: parseNumeric(raw.frequency_plan),
    views_plan: parseNumeric(raw.views_plan),
    clicks_plan: parseNumeric(raw.clicks_plan),
    conversions_plan: parseNumeric(raw.conversions_plan),
    ctr_plan: parseNumeric(raw.ctr_plan),
    cpm_plan: parseNumeric(raw.cpm_plan),
    cpc_plan: parseNumeric(raw.cpc_plan),
    cpv_plan: parseNumeric(raw.cpv_plan),
    cpa_plan: parseNumeric(raw.cpa_plan),
  };
}

export async function fetchMediaPlan(sheetUrl: string): Promise<MediaPlanRow[]> {
  if (!sheetUrl) return [];

  const cached = cacheByUrl.get(sheetUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(sheetUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Media plan fetch failed with status ${response.status}`);
    }

    const csvText = await response.text();
    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: normalizeHeader,
    });

    const data = parsed.data
      .map((row) => normalizeRow(row))
      .filter((row) => Boolean(row.platform));

    cacheByUrl.set(sheetUrl, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error("Failed to fetch media plan:", error);
    return cached?.data ?? [];
  }
}

function dominantBuyType(rows: MediaPlanRow[]): string {
  if (!rows.length) return "CPM";
  const score = new Map<string, number>();
  for (const row of rows) {
    score.set(row.buy_type, (score.get(row.buy_type) ?? 0) + (row.budget_plan || 0));
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? rows[0].buy_type;
}

export function aggregatePlanByChannel(rows: MediaPlanRow[]): ChannelPlanAggregate[] {
  const byChannel = new Map<
    string,
    {
      platforms: Set<string>;
      budget_plan: number;
      impressions_plan: number;
      clicks_plan: number;
      views_plan: number;
      conversions_plan: number;
      reach_plan: number;
      lines: MediaPlanRow[];
    }
  >();

  for (const row of rows) {
    const channel = row.channel?.trim();
    if (!channel) continue;

    if (!byChannel.has(channel)) {
      byChannel.set(channel, {
        platforms: new Set<string>(),
        budget_plan: 0,
        impressions_plan: 0,
        clicks_plan: 0,
        views_plan: 0,
        conversions_plan: 0,
        reach_plan: 0,
        lines: [],
      });
    }

    const agg = byChannel.get(channel)!;
    if (row.platform) agg.platforms.add(row.platform.toLowerCase());
    agg.budget_plan += row.budget_plan || 0;
    agg.impressions_plan += row.impressions_plan || 0;
    agg.clicks_plan += row.clicks_plan || 0;
    agg.views_plan += row.views_plan || 0;
    agg.conversions_plan += row.conversions_plan || 0;
    agg.reach_plan += row.reach_plan || 0;
    agg.lines.push(row);
  }

  const result: ChannelPlanAggregate[] = [];
  for (const [channel, agg] of byChannel.entries()) {
    const cpm_plan = agg.impressions_plan > 0 ? (agg.budget_plan / agg.impressions_plan) * 1000 : 0;
    const cpc_plan = agg.clicks_plan > 0 ? agg.budget_plan / agg.clicks_plan : 0;
    const cpv_plan = agg.views_plan > 0 ? agg.budget_plan / agg.views_plan : 0;
    const cpa_plan = agg.conversions_plan > 0 ? agg.budget_plan / agg.conversions_plan : 0;

    result.push({
      channel,
      buy_type: dominantBuyType(agg.lines),
      platforms: Array.from(agg.platforms),
      budget_plan: Number(agg.budget_plan.toFixed(2)),
      impressions_plan: Math.round(agg.impressions_plan),
      clicks_plan: Math.round(agg.clicks_plan),
      views_plan: Math.round(agg.views_plan),
      conversions_plan: Math.round(agg.conversions_plan),
      reach_plan: Math.round(agg.reach_plan),
      cpm_plan: Number(cpm_plan.toFixed(4)),
      cpc_plan: Number(cpc_plan.toFixed(4)),
      cpv_plan: Number(cpv_plan.toFixed(4)),
      cpa_plan: Number(cpa_plan.toFixed(4)),
      lines: agg.lines,
    });
  }

  return result;
}

export function aggregatePlanByPlatform(rows: MediaPlanRow[]): Map<string, PlatformPlanAggregate> {
  const byPlatform = new Map<string, PlatformPlanAggregate>();

  for (const row of rows) {
    const platform = row.platform?.toLowerCase();
    if (!platform) continue;

    if (!byPlatform.has(platform)) {
      byPlatform.set(platform, {
        budget_plan: 0,
        impressions_plan: 0,
        clicks_plan: 0,
        views_plan: 0,
        conversions_plan: 0,
      });
    }

    const agg = byPlatform.get(platform)!;
    agg.budget_plan += row.budget_plan || 0;
    agg.impressions_plan += row.impressions_plan || 0;
    agg.clicks_plan += row.clicks_plan || 0;
    agg.views_plan += row.views_plan || 0;
    agg.conversions_plan += row.conversions_plan || 0;
  }

  return byPlatform;
}
