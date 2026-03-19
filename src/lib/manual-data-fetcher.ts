import Papa from "papaparse";

export interface ManualDataRow {
  date: string;
  platform: string;
  channel: string;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  views: number | null;
  conversions: number | null;
  reach: number | null;
  sessions: number | null;
  cr: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpv: number | null;
}

export interface ManualDataFetchOptions {
  defaultPlatform?: string;
  defaultChannel?: string;
}

const cache = new Map<string, { data: ManualDataRow[]; ts: number }>();
const TTL = 5 * 60 * 1000;

const PLATFORM_ALIASES: Record<string, string> = {
  linkedin: "linkedin",
  "linked in": "linkedin",
  reddit: "reddit",
  meta: "meta",
  facebook: "meta",
  instagram: "meta",
  x: "x",
  twitter: "x",
  "x twitter": "x",
  google: "google",
  "google ads": "google",
  google_ads: "google",
  yandex: "yandex",
  "yandex direct": "yandex",
  "yandex_direct": "yandex",
  "яндекс": "yandex",
  "яндекс директ": "yandex",
  "яндекс.директ": "yandex",
  vk: "vk",
  vkontakte: "vk",
  "vk ads": "vk",
  "вконтакте": "vk",
  getintent: "git",
  git: "git",
  dv360: "dv360",
  "display video 360": "dv360",
  hybrid: "hybrid",
  brevo: "brevo",
  telegram: "telegram",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeManualPlatformId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const normalized = normalizeToken(value);
  return PLATFORM_ALIASES[normalized] ?? normalized.replace(/\s+/g, "_");
}

function normalizeDate(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const dmY = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmY) {
    const day = Number(dmY[1]);
    const month = Number(dmY[2]);
    let year = Number(dmY[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parsePercent(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  return toNum(String(val).replace(/%/g, "").trim());
}

function normalizeSheetUrl(sheetUrl: string): string {
  const trimmed = sheetUrl.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.pathname.includes("/spreadsheets/d/")) {
      const idMatch = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (idMatch) {
        return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
      }
    }
    if (!url.searchParams.get("format") && !url.searchParams.get("output")) {
      url.searchParams.set("format", "csv");
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

export async function fetchManualData(
  sheetUrl: string,
  options: ManualDataFetchOptions = {},
): Promise<ManualDataRow[]> {
  if (!sheetUrl) return [];

  const fetchUrl = normalizeSheetUrl(sheetUrl);
  if (!fetchUrl) return [];

  const cacheKey = `${fetchUrl}::${options.defaultPlatform ?? ""}::${options.defaultChannel ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const res = await fetch(fetchUrl, { cache: "no-store", redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Manual data fetch failed with status ${res.status}`);
  }

  const csv = await res.text();

  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const data = (parsed.data ?? [])
    .map((r) => {
      const date = normalizeDate(r.date ?? r.report_date ?? r.day);
      const platform = normalizeManualPlatformId(r.platform ?? r.source_platform ?? options.defaultPlatform);
      const channel = String(
        r.channel ??
          r.campaign ??
          r.campaign_name ??
          r.campaign_title ??
          r.source ??
          options.defaultChannel ??
          r.platform ??
          "",
      ).trim();

      return {
        date,
        platform,
        channel,
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        spend: toNum(r.spend),
        views: toNum(r.views),
        conversions: toNum(r.conversions),
        reach: toNum(r.reach),
        sessions: toNum(r.sessions),
        cr: parsePercent(r.cr),
        ctr: parsePercent(r.ctr),
        cpc: toNum(r.cpc),
        cpm: toNum(r.cpm),
        cpv: toNum(r.cpv),
      };
    })
    .filter((r) => r.date && r.platform && r.channel)
    .map((r) => ({
      date: r.date,
      platform: r.platform,
      channel: r.channel,
      impressions: toNum(r.impressions),
      clicks: toNum(r.clicks),
      spend: toNum(r.spend),
      views: toNum(r.views),
      conversions: toNum(r.conversions),
      reach: toNum(r.reach),
      sessions: toNum(r.sessions),
      cr: parsePercent(r.cr),
      ctr: parsePercent(r.ctr),
      cpc: toNum(r.cpc),
      cpm: toNum(r.cpm),
      cpv: toNum(r.cpv),
    })) as ManualDataRow[];

  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export function filterByDateRange(rows: ManualDataRow[], from: string, to: string): ManualDataRow[] {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

export function aggregateByPlatform(
  rows: ManualDataRow[],
): Array<{
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  reach: number;
  sessions: number;
}> {
  const map = new Map<
    string,
    { platform: string; impressions: number; clicks: number; spend: number; views: number; conversions: number; reach: number; sessions: number }
  >();
  for (const r of rows) {
    if (!map.has(r.platform)) {
      map.set(r.platform, {
        platform: r.platform,
        impressions: 0,
        clicks: 0,
        spend: 0,
        views: 0,
        conversions: 0,
        reach: 0,
        sessions: 0,
      });
    }
    const a = map.get(r.platform)!;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.spend += r.spend ?? 0;
    a.views += r.views ?? 0;
    a.conversions += r.conversions ?? 0;
    a.reach += r.reach ?? 0;
    a.sessions += r.sessions ?? 0;
  }
  return Array.from(map.values());
}

export function aggregateByChannel(
  rows: ManualDataRow[],
): Array<{
  platform: string;
  channel: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  sessions: number;
}> {
  const key = (r: ManualDataRow) => `${r.platform}|${r.channel}`;
  const map = new Map<
    string,
    { platform: string; channel: string; impressions: number; clicks: number; spend: number; views: number; conversions: number; sessions: number }
  >();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) {
      map.set(k, {
        platform: r.platform,
        channel: r.channel,
        impressions: 0,
        clicks: 0,
        spend: 0,
        views: 0,
        conversions: 0,
        sessions: 0,
      });
    }
    const a = map.get(k)!;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.spend += r.spend ?? 0;
    a.views += r.views ?? 0;
    a.conversions += r.conversions ?? 0;
    a.sessions += r.sessions ?? 0;
  }
  return Array.from(map.values());
}

export function getTimeseries(
  rows: ManualDataRow[],
): Array<{ date: string; impressions: number; clicks: number; spend: number; views: number }> {
  const map = new Map<
    string,
    { date: string; impressions: number; clicks: number; spend: number; views: number }
  >();
  for (const r of rows) {
    if (!map.has(r.date)) {
      map.set(r.date, { date: r.date, impressions: 0, clicks: 0, spend: 0, views: 0 });
    }
    const a = map.get(r.date)!;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.spend += r.spend ?? 0;
    a.views += r.views ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function getTimeseriesByPlatform(
  rows: ManualDataRow[],
): Array<{ date: string; platform: string; impressions: number; clicks: number; spend: number; views: number }> {
  const map = new Map<
    string,
    { date: string; platform: string; impressions: number; clicks: number; spend: number; views: number }
  >();
  for (const r of rows) {
    const key = `${r.platform}|${r.date}`;
    if (!map.has(key)) {
      map.set(key, { date: r.date, platform: r.platform, impressions: 0, clicks: 0, spend: 0, views: 0 });
    }
    const a = map.get(key)!;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.spend += r.spend ?? 0;
    a.views += r.views ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
}
