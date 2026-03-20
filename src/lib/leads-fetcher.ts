export interface LeadRow {
  date: string;
  platform: string;
  channel: string;
  source: string;
  leads: number;
  qualified_leads: number;
  revenue: number;
  notes: string;
}

type LeadPlatformAggregate = {
  platform: string;
  leads: number;
  qualified_leads: number;
  revenue: number;
};

type LeadChannelPlatformAggregate = {
  channel: string;
  platform: string;
  leads: number;
  qualified_leads: number;
  revenue: number;
};

const PLATFORM_ALIASES: Record<string, string> = {
  linkedin: "linkedin",
  "linked in": "linkedin",
  reddit: "reddit",
  meta: "meta",
  facebook: "meta",
  instagram: "meta",
  x: "x",
  twitter: "x",
  google: "google",
  "google ads": "google",
  google_ads: "google",
  yandex: "yandex",
  "yandex direct": "yandex",
  yandex_direct: "yandex",
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
  hybrid: "hybrid",
  telegram: "telegram",
  brevo: "brevo",
  "google ads brand": "google_brand",
  "google ads competion": "google_competition",
  "google ads competition": "google_competition",
  "google brand": "google_brand",
  "google competition": "google_competition",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizePlatform(raw: unknown): string {
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

function toNum(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLeadHeaders(headers: string[]): boolean {
  const set = new Set(headers.map(normalizeHeader));
  return set.has("date") && set.has("platform") && set.has("channel") && set.has("leads");
}

function isLegacyLeadHeaders(headers: string[]): boolean {
  const set = new Set(headers.map(normalizeHeader));
  return set.has("source") && set.has("leads");
}

function normalizeLegacyLeadChannel(source: string): string {
  const value = normalizeToken(source);
  if (!value) return "";
  if (value === "linkedin") return "Linkedin";
  if (value === "reddit") return "Reddit";
  if (value === "vk" || value === "vk ads" || value === "vkontakte" || value === "вконтакте") return "VK";
  if (value === "facebook" || value === "meta") return "Facebook";
  if (value === "yandex direct" || value === "yandex") return "Yandex search";
  if (value === "google ads brand" || value === "google brand") return "Google Brand";
  if (value === "google ads competion" || value === "google ads competition" || value === "google competition") {
    return "Google Competition";
  }
  return source.trim();
}

export function parseLeadRows(headers: string[], rows: string[][]): LeadRow[] {
  const normalizedHeaders = headers.map(normalizeHeader);
  const modernFormat = isLeadHeaders(normalizedHeaders);
  const legacyFormat = isLegacyLeadHeaders(normalizedHeaders);
  if (!modernFormat && !legacyFormat) {
    return [];
  }

  return rows
    .map((row) => {
      const get = (key: string) => {
        const idx = normalizedHeaders.indexOf(key);
        return idx >= 0 ? row[idx] ?? "" : "";
      };

      const legacySource = String(get("source") || "").trim();
      const modernPlatform = normalizePlatform(get("platform"));
      const modernChannel = String(get("channel") || "").trim();
      const platform = modernFormat ? modernPlatform : normalizePlatform(legacySource);
      const channel = modernFormat ? modernChannel : normalizeLegacyLeadChannel(legacySource);

      return {
        date: modernFormat ? normalizeDate(get("date")) : "",
        platform,
        channel,
        source: legacySource || String(get("source") || "").trim(),
        leads: toNum(get("leads")),
        qualified_leads: toNum(get("qualified_leads")),
        revenue: toNum(get("revenue")),
        notes: String(get("notes") || "").trim(),
      };
    })
    .filter((row) => row.platform && row.channel);
}

export function filterLeadsByDateRange(rows: LeadRow[], from: string, to: string): LeadRow[] {
  return rows.filter((row) => !row.date || (row.date >= from && row.date <= to));
}

export function aggregateLeadsByPlatform(rows: LeadRow[]): LeadPlatformAggregate[] {
  const grouped = new Map<string, LeadPlatformAggregate>();
  for (const row of rows) {
    if (!grouped.has(row.platform)) {
      grouped.set(row.platform, {
        platform: row.platform,
        leads: 0,
        qualified_leads: 0,
        revenue: 0,
      });
    }
    const item = grouped.get(row.platform)!;
    item.leads += row.leads;
    item.qualified_leads += row.qualified_leads;
    item.revenue += row.revenue;
  }
  return Array.from(grouped.values());
}

export function aggregateLeadsByChannelPlatform(rows: LeadRow[]): LeadChannelPlatformAggregate[] {
  const grouped = new Map<string, LeadChannelPlatformAggregate>();
  for (const row of rows) {
    const key = `${row.channel}||${row.platform}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        channel: row.channel,
        platform: row.platform,
        leads: 0,
        qualified_leads: 0,
        revenue: 0,
      });
    }
    const item = grouped.get(key)!;
    item.leads += row.leads;
    item.qualified_leads += row.qualified_leads;
    item.revenue += row.revenue;
  }
  return Array.from(grouped.values());
}
