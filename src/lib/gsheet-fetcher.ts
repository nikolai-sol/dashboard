import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface MediaPlanRow {
  platform: string; // instrument/channel from the media plan, not necessarily a DSP source
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
  monthly: Record<string, number>;
  // allow additional raw fields from parsing
  [key: string]: string | number | Record<string, number>;
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

export type MediaPlanFormat = "canonical_template" | "campaign_budget_sheet" | "unknown";

export interface MediaPlanParseResult {
  input_url: string;
  fetch_url: string;
  headers: string[];
  format: MediaPlanFormat;
  raw_rows: number;
  rows: MediaPlanRow[];
}

export type MediaPlanUploadPayload = {
  filename: string;
  mime_type?: string;
  content_base64: string;
};

export type MediaPlanSourceConfig = {
  sheet_url?: string;
  inline_rows?: unknown;
  upload_file?: unknown;
};

export interface ChannelGroup {
  channel: string;
  instrument: string;
  format: string;
  buy_type: string;
  budget_plan: number;
  impressions_plan: number;
  clicks_plan: number;
  views_plan: number;
  conversions_plan: number;
  units_plan: number;
  monthly: Record<string, number>;
  monthly_breakdown: Record<
    string,
    {
      units: number;
      budget: number;
      impressions: number;
      clicks: number;
      views: number;
      conversions: number;
      reach: number;
      ctr: number;
    }
  >;
  bindings: Array<{ source_key: string; platform_campaign_id: string }>;
}

export const MONTH_COLUMNS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

const KNOWN_SOURCE_IDS = new Set([
  "linkedin",
  "reddit",
  "vk",
  "git",
  "hybrid",
  "yandex",
  "google",
  "meta",
  "x",
  "dv360",
]);

const cacheByUrl = new Map<string, { data: MediaPlanRow[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function toObjectsFromWorksheet(worksheet: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: true,
  }).map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = value;
    }
    return normalized;
  });
}

function detectMediaPlanFormat(headers: string[]): MediaPlanFormat {
  const set = new Set(headers);
  if (set.has("platform") && set.has("channel") && set.has("buy_type") && set.has("budget_plan")) {
    return "canonical_template";
  }
  if (set.has("platform") && set.has("campaign_name") && set.has("planned_budget")) {
    return "campaign_budget_sheet";
  }
  return "unknown";
}

function normalizePlatformId(raw: unknown): string {
  const rawValue = String(raw ?? "").trim().toLowerCase();
  if (!rawValue) return "";
  const value = rawValue
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "");

  const aliases: Record<string, string> = {
    linkedin: "linkedin",
    linkedin_ads: "linkedin",
    reddit: "reddit",
    reddit_ads: "reddit",
    vk: "vk",
    vk_ads: "vk",
    vk_ads_v2: "vk",
    "вконтакте": "vk",
    "вк": "vk",
    git: "git",
    getintent: "git",
    hybrid: "hybrid",
    yandex: "yandex",
    yandex_direct: "yandex",
    "яндекс": "yandex",
    "яндекс_директ": "yandex",
    google: "google",
    google_ads: "google",
    meta: "meta",
    meta_ads: "meta",
    x_twitter: "x",
    x_twitter_ads: "x",
    x: "x",
    dv360: "dv360",
  };

  return aliases[value] ?? aliases[rawValue] ?? value;
}

function normalizeMediaPlanPlatform(raw: unknown): string {
  const rawValue = String(raw ?? "").trim();
  if (!rawValue) return "";
  const normalizedSource = normalizePlatformId(rawValue);
  if (KNOWN_SOURCE_IDS.has(normalizedSource)) {
    return normalizedSource;
  }
  return rawValue;
}

function parseMonthly(raw: Record<string, unknown>): Record<string, number> {
  const monthly: Record<string, number> = {};
  for (const month of MONTH_COLUMNS) {
    const value = firstPresent(raw, [month]);
    if (value === undefined) continue;
    monthly[month] = parseNumeric(value);
  }
  return monthly;
}

export function collectMonthsFound(rows: MediaPlanRow[]): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    for (const month of Object.keys(row.monthly ?? {})) {
      if ((row.monthly?.[month] ?? 0) > 0) {
        found.add(month);
      }
    }
  }
  return MONTH_COLUMNS.filter((month) => found.has(month));
}

function parseUploadPayload(value: unknown): MediaPlanUploadPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<MediaPlanUploadPayload>;
  const filename = String(input.filename ?? "").trim();
  const contentBase64 = String(input.content_base64 ?? "").trim();
  if (!filename || !contentBase64) return null;
  return {
    filename,
    mime_type: input.mime_type ? String(input.mime_type) : undefined,
    content_base64: contentBase64,
  };
}

function parseInlineRows(value: unknown): MediaPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => normalizeRow((row ?? {}) as Record<string, unknown>))
    .filter((row) => Boolean(row.platform));
}

function parseNumeric(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const cleaned = raw.replace(/[€$£₽%\s]/g, "").trim();
  if (!cleaned) return 0;

  let normalized = cleaned;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+(,\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else if (/^-?\d+(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else if (/^-?\d+(,\d+)?$/.test(cleaned) && cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function normalizeBuyType(raw: unknown): MediaPlanRow["buy_type"] {
  const value = String(raw ?? "CPM").trim().toUpperCase();
  if (value === "CPC" || value === "CPV" || value === "CPA") {
    return value;
  }
  return "CPM";
}

function firstPresent(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== "") {
      return raw[key];
    }
  }
  return undefined;
}

function normalizeRow(raw: Record<string, unknown>): MediaPlanRow {
  const buyType = normalizeBuyType(firstPresent(raw, ["buy_type", "report_type"]));
  const budgetPlan = parseNumeric(firstPresent(raw, ["budget_plan", "planned_budget", "budget"]));
  const cpmPlan = parseNumeric(firstPresent(raw, ["cpm_plan", "planned_cpm"]));
  const cpcPlan = parseNumeric(firstPresent(raw, ["cpc_plan", "planned_cpc"]));
  const cpvPlan = parseNumeric(firstPresent(raw, ["cpv_plan", "planned_cpv"]));
  const cpaPlan = parseNumeric(firstPresent(raw, ["cpa_plan", "planned_cpa"]));

  let impressionsPlan = parseNumeric(firstPresent(raw, ["impressions_plan", "planned_impressions"]));
  let clicksPlan = parseNumeric(firstPresent(raw, ["clicks_plan", "planned_clicks"]));
  let viewsPlan = parseNumeric(firstPresent(raw, ["views_plan", "planned_views"]));
  let conversionsPlan = parseNumeric(firstPresent(raw, ["conversions_plan", "planned_conversions"]));

  if (buyType === "CPM" && impressionsPlan === 0 && budgetPlan > 0 && cpmPlan > 0) {
    impressionsPlan = (budgetPlan / cpmPlan) * 1000;
  }
  if (buyType === "CPC" && clicksPlan === 0 && budgetPlan > 0 && cpcPlan > 0) {
    clicksPlan = budgetPlan / cpcPlan;
  }
  if (buyType === "CPV" && viewsPlan === 0 && budgetPlan > 0 && cpvPlan > 0) {
    viewsPlan = budgetPlan / cpvPlan;
  }
  if (buyType === "CPA" && conversionsPlan === 0 && budgetPlan > 0 && cpaPlan > 0) {
    conversionsPlan = budgetPlan / cpaPlan;
  }

  const monthly = parseMonthly(raw);

  return {
    platform: normalizeMediaPlanPlatform(firstPresent(raw, ["platform"])),
    channel: String(firstPresent(raw, ["channel", "campaign_name", "format"]) ?? "").trim(),
    format: String(firstPresent(raw, ["format", "campaign_name"]) ?? "").trim(),
    buy_type: buyType,
    units_plan: parseNumeric(firstPresent(raw, ["units_plan", "planned_units"])),
    unit_price: parseNumeric(firstPresent(raw, ["unit_price"])),
    budget_plan: budgetPlan,
    impressions_plan: impressionsPlan,
    reach_plan: parseNumeric(firstPresent(raw, ["reach_plan", "planned_reach"])),
    frequency_plan: parseNumeric(firstPresent(raw, ["frequency_plan", "planned_frequency"])),
    views_plan: viewsPlan,
    clicks_plan: clicksPlan,
    conversions_plan: conversionsPlan,
    ctr_plan: parseNumeric(firstPresent(raw, ["ctr_plan", "planned_ctr"])),
    cpm_plan: cpmPlan,
    cpc_plan: cpcPlan,
    cpv_plan: cpvPlan,
    cpa_plan: cpaPlan,
    monthly,
  };
}

function primaryPlanValue(row: MediaPlanRow): number {
  const buyType = row.buy_type.toUpperCase();
  if (buyType === "CPA") return Number(row.conversions_plan) || Number(row.units_plan) || 0;
  if (buyType === "CPC") return Number(row.clicks_plan) || Number(row.units_plan) || 0;
  if (buyType === "CPV") return Number(row.views_plan) || Number(row.units_plan) || 0;
  return Number(row.impressions_plan) || Number(row.units_plan) || 0;
}

function deriveMonthlyBreakdown(row: MediaPlanRow) {
  const totalPrimary = primaryPlanValue(row);
  const totalBudget = Number(row.budget_plan) || 0;
  const totalImpressions = Number(row.impressions_plan) || 0;
  const totalClicks = Number(row.clicks_plan) || 0;
  const totalViews = Number(row.views_plan) || 0;
  const totalConversions = Number(row.conversions_plan) || 0;
  const totalReach = Number(row.reach_plan) || 0;

  const breakdown: ChannelGroup["monthly_breakdown"] = {};
  for (const [month, rawUnits] of Object.entries(row.monthly ?? {})) {
    const units = Number(rawUnits) || 0;
    const share = totalPrimary > 0 ? units / totalPrimary : 0;
    const impressions = totalImpressions * share;
    const clicks = totalClicks * share;
    breakdown[month] = {
      units,
      budget: totalBudget * share,
      impressions,
      clicks,
      views: totalViews * share,
      conversions: totalConversions * share,
      reach: totalReach * share,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    };
  }
  return breakdown;
}

export function normalizeMediaPlanSheetUrl(sheetUrl: string): string {
  const trimmed = sheetUrl.trim();
  if (!trimmed) return "";

  if (trimmed.includes("/pubhtml")) {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace("/pubhtml", "/pub");
    if (!url.searchParams.get("output")) {
      url.searchParams.set("output", "csv");
    }
    return url.toString();
  }

  if (trimmed.includes("/pub?")) {
    const url = new URL(trimmed);
    if (!url.searchParams.get("output")) {
      url.searchParams.set("output", "csv");
    }
    return url.toString();
  }

  return trimmed;
}

function parseCsvText(csvText: string): {
  headers: string[];
  raw_rows: number;
  rows: MediaPlanRow[];
} {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: normalizeHeader,
  });

  const headers = Array.isArray(parsed.meta.fields) ? parsed.meta.fields : [];
  const rows = parsed.data
    .map((row) => normalizeRow(row))
    .filter((row) => Boolean(row.platform));

  return {
    headers,
    raw_rows: parsed.data.length,
    rows,
  };
}

function parseXlsxBuffer(buffer: Buffer): {
  headers: string[];
  raw_rows: number;
  rows: MediaPlanRow[];
} {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], raw_rows: 0, rows: [] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const objects = toObjectsFromWorksheet(worksheet);
  const headers = objects[0] ? Object.keys(objects[0]) : [];
  const rows = objects
    .map((row) => normalizeRow(row))
    .filter((row) => Boolean(row.platform));

  return {
    headers,
    raw_rows: objects.length,
    rows,
  };
}

function parseUploadFile(upload: MediaPlanUploadPayload): {
  headers: string[];
  raw_rows: number;
  rows: MediaPlanRow[];
} {
  const filename = upload.filename.toLowerCase();
  const mimeType = String(upload.mime_type ?? "").toLowerCase();
  const buffer = Buffer.from(upload.content_base64, "base64");

  if (
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel")
  ) {
    return parseXlsxBuffer(buffer);
  }

  return parseCsvText(buffer.toString("utf8"));
}

export async function parseMediaPlan(sheetUrl: string): Promise<MediaPlanParseResult> {
  const inputUrl = String(sheetUrl ?? "").trim();
  const fetchUrl = normalizeMediaPlanSheetUrl(inputUrl);
  if (!fetchUrl) {
    return {
      input_url: inputUrl,
      fetch_url: fetchUrl,
      headers: [],
      format: "unknown",
      raw_rows: 0,
      rows: [],
    };
  }

  const response = await fetch(fetchUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Media plan fetch failed with status ${response.status}`);
  }

  const csvText = await response.text();
  const parsed = parseCsvText(csvText);

  return {
    input_url: inputUrl,
    fetch_url: fetchUrl,
    headers: parsed.headers,
    format: detectMediaPlanFormat(parsed.headers),
    raw_rows: parsed.raw_rows,
    rows: parsed.rows,
  };
}

export async function parseMediaPlanSource(
  sourceConfig: MediaPlanSourceConfig | null | undefined,
): Promise<MediaPlanParseResult> {
  const config = sourceConfig ?? {};
  const inlineRows = parseInlineRows(config.inline_rows);
  if (inlineRows.length) {
    const headers = Object.keys((config.inline_rows as Record<string, unknown>[])[0] ?? {}).map(normalizeHeader);
    return {
      input_url: "",
      fetch_url: "inline_rows",
      headers,
      format: detectMediaPlanFormat(headers),
      raw_rows: inlineRows.length,
      rows: inlineRows,
    };
  }

  const upload = parseUploadPayload(config.upload_file);
  if (upload) {
    const parsed = parseUploadFile(upload);
    return {
      input_url: upload.filename,
      fetch_url: `upload:${upload.filename}`,
      headers: parsed.headers,
      format: detectMediaPlanFormat(parsed.headers),
      raw_rows: parsed.raw_rows,
      rows: parsed.rows,
    };
  }

  return parseMediaPlan(String(config.sheet_url ?? ""));
}

export async function fetchMediaPlan(sheetUrl: string): Promise<MediaPlanRow[]> {
  if (!sheetUrl) return [];

  const normalizedUrl = normalizeMediaPlanSheetUrl(sheetUrl);
  if (!normalizedUrl) return [];

  const cached = cacheByUrl.get(normalizedUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const result = await parseMediaPlan(sheetUrl);
    const data = result.rows;

    cacheByUrl.set(normalizedUrl, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error("Failed to fetch media plan:", error);
    return cached?.data ?? [];
  }
}

export async function fetchMediaPlanFromSourceConfig(
  sourceConfig: MediaPlanSourceConfig | null | undefined,
): Promise<MediaPlanRow[]> {
  try {
    const result = await parseMediaPlanSource(sourceConfig);
    return result.rows;
  } catch (error) {
    console.error("Failed to fetch media plan from source config:", error);
    return [];
  }
}

// Group media plan rows by channel, summing plans and collecting campaign_ids
export function groupByChannel(rows: MediaPlanRow[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>();

  for (const row of rows) {
    const ch = row.channel?.trim();
    if (!ch) continue;

    if (!map.has(ch)) {
      map.set(ch, {
        channel: ch,
        instrument: row.platform,
        format: row.format || "",
        buy_type: (row.buy_type || "CPM").toUpperCase(),
        budget_plan: 0,
        impressions_plan: 0,
        clicks_plan: 0,
        views_plan: 0,
        conversions_plan: 0,
        units_plan: 0,
        monthly: {},
        monthly_breakdown: {},
        bindings: [],
      });
    }

    const group = map.get(ch)!;
    group.budget_plan += Number(row.budget_plan) || 0;
    group.impressions_plan += Number(row.impressions_plan) || 0;
    group.clicks_plan += Number(row.clicks_plan) || 0;
    group.views_plan += Number(row.views_plan) || 0;
    group.conversions_plan += Number(row.conversions_plan) || 0;
    group.units_plan += Number(row.units_plan) || 0;
    for (const month of Object.keys(row.monthly ?? {})) {
      group.monthly[month] = (group.monthly[month] ?? 0) + (Number(row.monthly[month]) || 0);
    }
    const rowMonthlyBreakdown = deriveMonthlyBreakdown(row);
    for (const [month, item] of Object.entries(rowMonthlyBreakdown)) {
      if (!group.monthly_breakdown[month]) {
        group.monthly_breakdown[month] = {
          units: 0,
          budget: 0,
          impressions: 0,
          clicks: 0,
          views: 0,
          conversions: 0,
          reach: 0,
          ctr: 0,
        };
      }
      const existing = group.monthly_breakdown[month];
      existing.units += item.units;
      existing.budget += item.budget;
      existing.impressions += item.impressions;
      existing.clicks += item.clicks;
      existing.views += item.views;
      existing.conversions += item.conversions;
      existing.reach += item.reach;
      existing.ctr = existing.impressions > 0 ? (existing.clicks / existing.impressions) * 100 : 0;
    }
  }

  return Array.from(map.values());
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
    const platform = normalizePlatformId(row.platform);
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
