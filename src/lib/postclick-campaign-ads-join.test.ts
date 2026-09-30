import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  POSTCLICK_CAMPAIGN_ADS_JOIN_SQL,
  matchesBoundPostClickCampaignFact,
} from "./postclick-campaign-ads-join";

const binding = {
  source_key: "hybrid",
  platform_account_id: "account-a",
  platform_campaign_id: "campaign-a",
};

const fact = {
  ...binding,
  platform_delivery_entity_id: "delivery-a",
  platform_creative_id: "creative-a",
};

test("campaign ads SQL scopes entity matches to the exact bound account and campaign", () => {
  const loader = readFileSync(path.resolve("src/lib/dashboard-data-loader.ts"), "utf8");

  assert.match(loader, /ON \$\{POSTCLICK_CAMPAIGN_ADS_JOIN_SQL\}/);
  assert.match(
    POSTCLICK_CAMPAIGN_ADS_JOIN_SQL,
    /f\.platform_account_id[\s\S]*?= mp\.platform_account_id/,
  );
  assert.match(
    POSTCLICK_CAMPAIGN_ADS_JOIN_SQL,
    /f\.platform_campaign_id[\s\S]*?= mp\.platform_campaign_id/,
  );
  assert.match(POSTCLICK_CAMPAIGN_ADS_JOIN_SQL, /f\.platform_delivery_entity_id/);
  assert.match(POSTCLICK_CAMPAIGN_ADS_JOIN_SQL, /f\.platform_creative_id/);

  assert.equal(matchesBoundPostClickCampaignFact(binding, fact, "campaign-a"), true);
  assert.equal(matchesBoundPostClickCampaignFact(binding, fact, "delivery-a"), true);
  assert.equal(matchesBoundPostClickCampaignFact(binding, fact, "creative-a"), true);
  assert.equal(
    matchesBoundPostClickCampaignFact(
      binding,
      { ...fact, platform_account_id: "account-b" },
      "delivery-a",
    ),
    false,
  );
  assert.equal(
    matchesBoundPostClickCampaignFact(
      binding,
      { ...fact, platform_campaign_id: "campaign-b" },
      "delivery-a",
    ),
    false,
  );
  assert.equal(
    matchesBoundPostClickCampaignFact(
      binding,
      { ...fact, source_key: "getintent" },
      "delivery-a",
    ),
    false,
  );

  const facts = [
    { ...fact, spend: 10 },
    { ...fact, platform_delivery_entity_id: "delivery-b", spend: 20 },
    { ...fact, platform_creative_id: "creative-b", spend: 30 },
    { ...fact, platform_account_id: "account-b", spend: 1000 },
    { ...fact, platform_campaign_id: "campaign-b", spend: 2000 },
  ];
  const utmCampaigns = ["campaign-a", "delivery-b", "creative-b"];
  const spend = facts
    .filter((candidate) => utmCampaigns.some((utmCampaign) =>
      matchesBoundPostClickCampaignFact(binding, candidate, utmCampaign)))
    .reduce((sum, candidate) => sum + candidate.spend, 0);

  assert.equal(spend, 60);
});
