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

test("dashboard source config preserves its account label and campaign id filter", async () => {
  let received: { accountIds: string[]; campaignFilter?: { filter_type: string; filter_value: string | null } } | undefined;
  const result = await loadCampaigns(0, "", "", [{
    source_key: "between",
    account_ids: ["gidrofuril"],
    account_display_name: "Hudeu Prosto",
    filters: [{ filter_type: "id_list", filter_value: "25072,25073" }],
  }], {
    getCampaignCatalog: async (_sourceKey, options) => {
      received = options;
      return [{
        canonicalCampaignId: 35391,
        sourceKey: "between",
        platformAccountId: "gidrofuril",
        accountName: "Between account gidrofuril",
        platformCampaignId: "25072",
        campaignName: "hudeu_prosto_programmatic",
      }];
    },
  });
  assert.deepEqual(received, {
    accountIds: ["gidrofuril"],
    campaignFilter: { filter_type: "id_list", filter_value: "25072,25073" },
  });
  assert.equal(result.campaigns[0].account_name, "Hudeu Prosto");
});

test("same source key keeps separate account labels and filters", async () => {
  const calls: Array<{ accountIds: string[]; campaignFilter?: { filter_type: string; filter_value: string | null } }> = [];
  const result = await loadCampaigns(0, "", "", [
    { source_key: "between", account_ids: ["gidrofuril"], account_display_name: "Hudeu Prosto", filters: [{ filter_type: "id_list", filter_value: "25072" }] },
    { source_key: "between", account_ids: ["other"], account_display_name: "Other Cabinet", filters: [{ filter_type: "id_list", filter_value: "35000" }] },
  ], {
    getCampaignCatalog: async (_sourceKey, options) => {
      calls.push(options);
      const accountId = options.accountIds[0];
      return [{ canonicalCampaignId: accountId === "gidrofuril" ? 1 : 2, sourceKey: "between", platformAccountId: accountId, accountName: accountId, platformCampaignId: options.campaignFilter?.filter_value ?? "", campaignName: "campaign" }];
    },
  });
  assert.deepEqual(calls, [
    { accountIds: ["gidrofuril"], campaignFilter: { filter_type: "id_list", filter_value: "25072" } },
    { accountIds: ["other"], campaignFilter: { filter_type: "id_list", filter_value: "35000" } },
  ]);
  assert.deepEqual(result.campaigns.map((item) => item.account_name), ["Hudeu Prosto", "Other Cabinet"]);
});
