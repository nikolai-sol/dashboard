export type DashboardFilterType = "all" | "name_pattern" | "id_list";

export type MultibrandSourceFilter = {
  platform: string;
  filter_type: DashboardFilterType;
  filter_value: string | null;
};

export type MultibrandBrandConfig = {
  id: string;
  label: string;
  color: string;
  description?: string;
  channel_patterns: string[];
  source_filters: MultibrandSourceFilter[];
};

export type MultibrandConfig = {
  enabled: boolean;
  executive_title?: string;
  executive_subtitle?: string;
  brands: MultibrandBrandConfig[];
};

const DEFAULT_BRAND_COLORS = [
  "#2563eb",
  "#e11d48",
  "#059669",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
];

function normalizeFilterType(value: unknown): DashboardFilterType {
  if (value === "name_pattern" || value === "id_list") {
    return value;
  }
  return "all";
}

function normalizeChannelPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeSourceFilters(value: unknown): MultibrandSourceFilter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const platform = String(row.platform ?? "").trim().toLowerCase();
      if (!platform) return null;
      return {
        platform,
        filter_type: normalizeFilterType(row.filter_type),
        filter_value: row.filter_value ? String(row.filter_value) : null,
      } satisfies MultibrandSourceFilter;
    })
    .filter((item): item is MultibrandSourceFilter => Boolean(item));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildDefaultBrandId(label: string, fallbackIndex: number): string {
  return slugify(label) || `brand_${fallbackIndex + 1}`;
}

export function normalizeMultibrandConfig(value: unknown): MultibrandConfig | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const enabled = Boolean(raw.enabled);
  const brandsInput = Array.isArray(raw.brands) ? raw.brands : [];
  const brands: MultibrandBrandConfig[] = brandsInput
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const label = String(row.label ?? "").trim();
      const id = String(row.id ?? "").trim() || buildDefaultBrandId(label, index);
      if (!label && !id) return null;
      return {
        id,
        label: label || id,
        color:
          String(row.color ?? "").trim() || DEFAULT_BRAND_COLORS[index % DEFAULT_BRAND_COLORS.length],
        description: String(row.description ?? "").trim() || undefined,
        channel_patterns: normalizeChannelPatterns(row.channel_patterns),
        source_filters: normalizeSourceFilters(row.source_filters),
      } satisfies MultibrandBrandConfig;
    })
    .filter(Boolean) as MultibrandBrandConfig[];

  return {
    enabled,
    executive_title: String(raw.executive_title ?? "").trim() || undefined,
    executive_subtitle: String(raw.executive_subtitle ?? "").trim() || undefined,
    brands,
  };
}

export function findMultibrandBrand(
  config: MultibrandConfig | null | undefined,
  brandId: string | null | undefined,
): MultibrandBrandConfig | null {
  if (!config?.enabled || !brandId) return null;
  return config.brands.find((brand) => brand.id === brandId) ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesMultibrandPattern(value: string, pattern: string): boolean {
  const text = value.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!text || !normalizedPattern) return false;

  if (normalizedPattern.includes("%") || normalizedPattern.includes("_")) {
    const regex = new RegExp(
      `^${normalizedPattern
        .split("")
        .map((char) => {
          if (char === "%") return ".*";
          if (char === "_") return ".";
          return escapeRegExp(char);
        })
        .join("")}$`,
      "i",
    );
    return regex.test(value);
  }

  return text.includes(normalizedPattern);
}

export function matchesAnyMultibrandPattern(value: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  return patterns.some((pattern) => matchesMultibrandPattern(value, pattern));
}
