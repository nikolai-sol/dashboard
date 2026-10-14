type FrequencyOverride = {
  source_key: string;
  platform_campaign_id: string;
  month_key: string;
  frequency: number;
};

/** Use the same monthly frequency overrides as the plan/fact advertising rows. */
export function buildPostClickReachSql(items: FrequencyOverride[]): {
  expression: string;
  params: (string | number)[];
} {
  const overrides = new Map<string, FrequencyOverride>();
  for (const item of items) {
    overrides.set(JSON.stringify([item.source_key, item.platform_campaign_id, item.month_key]), item);
  }
  if (!overrides.size) return { expression: "COALESCE(f.reach, 0)", params: [] };

  const params: (string | number)[] = [];
  const clauses = Array.from(overrides.values(), (item) => {
    params.push(item.source_key, item.platform_campaign_id, item.month_key, item.frequency);
    return "WHEN f.source_key = ? AND f.platform_campaign_id = ? AND DATE_FORMAT(f.report_date, '%Y-%m') = ? THEN COALESCE(f.impressions, 0) / ?";
  });
  return { expression: `CASE ${clauses.join(" ")} ELSE COALESCE(f.reach, 0) END`, params };
}
