import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaigns } from "./route";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("campaign route contains no external manual file or Sheet read", () => {
  assert.doesNotMatch(source, /manual-data-fetcher/);
  assert.doesNotMatch(source, /fetchManualDataFromSourceConfig|aggregateByChannel/);
  assert.doesNotMatch(source, /sheet_url|upload_file/);
});

test("campaign route returns canonical account-aware snake case identity", async () => {
  const result = await loadCampaigns(0, "", "", [{
    source_key: "between",
    account_ids: ["1113"],
  }], {
    getCampaignCatalog: async () => [{
      canonicalCampaignId: 501,
      sourceKey: "between",
      platformAccountId: "1113",
      accountName: "Cabinet 1113",
      platformCampaignId: "24932",
      campaignName: "OLV Serials",
    }],
  });

  assert.deepEqual(result, {
    campaigns: [{
      canonical_campaign_id: 501,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet 1113",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
      display_label: "OLV Serials \u00b7 24932 \u00b7 Cabinet 1113",
    }],
    total: 1,
  });
});

test("source without selected accounts exposes no campaigns", async () => {
  let calls = 0;
  const result = await loadCampaigns(0, "", "", [{ source_key: "between" }], {
    getCampaignCatalog: async () => {
      calls += 1;
      return [];
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { campaigns: [], total: 0 });
});
