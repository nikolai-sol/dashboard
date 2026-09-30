type BoundCampaignIdentity = {
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
};

type CampaignAdFact = BoundCampaignIdentity & {
  platform_delivery_entity_id: string;
  platform_creative_id: string;
};

export const POSTCLICK_CAMPAIGN_ADS_JOIN_SQL = `
f.source_key COLLATE utf8mb4_unicode_ci = mp.source_key
AND f.platform_account_id COLLATE utf8mb4_unicode_ci = mp.platform_account_id COLLATE utf8mb4_unicode_ci
AND f.platform_campaign_id COLLATE utf8mb4_unicode_ci = mp.platform_campaign_id COLLATE utf8mb4_unicode_ci
AND f.report_date = m.report_date
AND (
  f.platform_campaign_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
  OR f.platform_delivery_entity_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
  OR f.platform_creative_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
)
`.trim();

export function matchesBoundPostClickCampaignFact(
  binding: BoundCampaignIdentity,
  fact: CampaignAdFact,
  utmCampaign: string,
): boolean {
  return fact.source_key === binding.source_key
    && fact.platform_account_id === binding.platform_account_id
    && fact.platform_campaign_id === binding.platform_campaign_id
    && [
      fact.platform_campaign_id,
      fact.platform_delivery_entity_id,
      fact.platform_creative_id,
    ].includes(utmCampaign);
}
