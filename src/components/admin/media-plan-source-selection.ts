import { resolveSourceKey } from "@/lib/source-mapping";

type MediaPlanSourceRow = {
  instrument?: unknown;
  platform?: unknown;
  source_keys?: unknown;
};

const PLATFORM_ALIASES: Record<string, string> = {
  "вк": "vk_ads_v2",
  "вконтакте": "vk_ads_v2",
  "vk": "vk_ads_v2",
  "vk ads": "vk_ads_v2",
  "hybrid": "hybrid",
};

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function uniqueAvailableSourceKeys(sourceKeys: unknown[], availableSourceKeys: string[]): string[] {
  const available = new Set(availableSourceKeys);
  const result: string[] = [];
  for (const raw of sourceKeys) {
    const sourceKey = String(raw ?? "").trim();
    if (!sourceKey || !available.has(sourceKey) || result.includes(sourceKey)) continue;
    result.push(sourceKey);
  }
  return result;
}

function isCrossPlatformInstrument(value: unknown): boolean {
  const normalized = normalizeToken(value);
  return !normalized || normalized === "все" || normalized === "all";
}

function resolveInstrumentSourceKey(value: unknown): string {
  const normalized = normalizeToken(value);
  return PLATFORM_ALIASES[normalized] ?? resolveSourceKey(normalized);
}

export function resolveMediaPlanRowSourceKeys(
  row: MediaPlanSourceRow,
  availableSourceKeys: string[],
): string[] {
  const saved = Array.isArray(row.source_keys)
    ? uniqueAvailableSourceKeys(row.source_keys, availableSourceKeys)
    : [];
  if (saved.length) return saved;

  const instrument = row.instrument ?? row.platform ?? "";
  if (isCrossPlatformInstrument(instrument)) {
    return [...availableSourceKeys];
  }

  const resolved = resolveInstrumentSourceKey(instrument);
  return availableSourceKeys.includes(resolved) ? [resolved] : [];
}

export function toggleMediaPlanRowSourceKey(
  currentSourceKeys: string[],
  sourceKey: string,
  checked: boolean,
  availableSourceKeys: string[],
): string[] {
  const current = uniqueAvailableSourceKeys(currentSourceKeys, availableSourceKeys);
  if (!availableSourceKeys.includes(sourceKey)) return current;
  if (!checked) return current.filter((item) => item !== sourceKey);
  return current.includes(sourceKey) ? current : [...current, sourceKey];
}
