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

const cache = new Map<string, { data: ManualDataRow[]; ts: number }>();
const TTL = 5 * 60 * 1000;

function parsePercent(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).replace(/%/g, "").trim();
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
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

export async function fetchManualData(sheetUrl: string): Promise<ManualDataRow[]> {
  if (!sheetUrl) return [];

  const fetchUrl = normalizeSheetUrl(sheetUrl);
  if (!fetchUrl) return [];

  const cached = cache.get(fetchUrl);
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

  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const data = (parsed.data ?? [])
    .filter((r) => r.date && r.platform)
    .map((r) => ({
      date: String(r.date).trim().slice(0, 10),
      platform: String(r.platform).trim().toLowerCase(),
      channel: String(r.channel ?? r.platform ?? "").trim(),
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

  cache.set(fetchUrl, { data, ts: Date.now() });
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
