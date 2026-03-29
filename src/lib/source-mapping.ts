export const PLATFORM_TO_SOURCE_KEY: Record<string, string> = {
  linkedin: "linkedin",
  reddit: "reddit",
  vk: "vk_ads_v2",
  hybrid: "hybrid",
  git: "getintent",
  getintent: "getintent",
  yandex: "yandex_direct",
  yandex_direct: "yandex_direct",
  yandex_promopages: "yandex_promopages",
  yandex_metrika: "yandex_metrika",
  meta: "meta",
  x: "x",
  google: "google",
  dv360: "dv360",
  media_plan: "media_plan",
  manual_data: "manual_data",
  leads: "leads",
};

export const SOURCE_KEY_TO_PLATFORM: Record<string, string> = {
  linkedin: 'linkedin',
  reddit: 'reddit',
  vk_ads_v2: 'vk',
  manual_data: 'manual',
  hybrid: 'hybrid',
  getintent: 'git',
  yandex_direct: 'yandex',
  yandex_promopages: 'yandex_promopages',
  yandex_metrika: 'yandex_metrika',
  meta: 'meta',
  x: 'x',
  google: 'google',
  dv360: 'dv360',
  media_plan: 'media_plan',
  leads: 'leads',
};

export const SOURCE_TYPE: Record<string, "ads" | "analytics" | "gsheet" | "manual" | "leads" | "promopages"> = {
  linkedin: "ads",
  reddit: "ads",
  vk_ads_v2: "ads",
  hybrid: "ads",
  getintent: "ads",
  yandex_direct: "ads",
  yandex_promopages: "promopages",
  yandex_metrika: "analytics",
  meta: "ads",
  x: "ads",
  google: "ads",
  dv360: "ads",
  media_plan: "gsheet",
  manual_data: "manual",
  leads: "leads",
};

export const ADS_AUTHORITY_FACT_SCOPE: Record<string, 'campaign' | 'delivery_entity'> = {
  linkedin: 'delivery_entity',
  reddit: 'campaign',
  vk_ads_v2: 'delivery_entity',
  hybrid: 'delivery_entity',
  getintent: 'delivery_entity',
  yandex_direct: 'delivery_entity',
  meta: 'campaign',
  x: 'campaign',
  google: 'campaign',
  dv360: 'campaign',
};

export function resolveSourceKey(platform: string): string {
  const normalized = String(platform ?? '').trim().toLowerCase();
  return PLATFORM_TO_SOURCE_KEY[normalized] ?? normalized;
}

export function resolveSourceType(
  platformOrSourceKey: string,
): "ads" | "analytics" | "gsheet" | "manual" | "leads" | "promopages" {
  const normalized = String(platformOrSourceKey ?? "").trim().toLowerCase();
  const t = SOURCE_TYPE[normalized];
  if (t) return t;
  return "ads";
}

export function resolvePlatformIdFromSourceKey(sourceKey: string): string {
  const normalized = String(sourceKey ?? '').trim().toLowerCase();
  return SOURCE_KEY_TO_PLATFORM[normalized] ?? normalized;
}
