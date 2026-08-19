import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvertisingBindingDiagnostics } from "./advertising-binding-diagnostics";
import type { AdvertisingBindingReadModel } from "./advertising-binding-read-model";

test("diagnostics keep unbound identity and report exact missing coverage dates", () => {
  const readModel: AdvertisingBindingReadModel = {
    daily: [],
    lineDaily: [],
    lines: new Map(),
    selectedAccounts: [{ sourceKey: "between", platformAccountId: "1113" }],
    unresolvedLegacyBindings: [{
      lineKey: "legacy",
      channel: "Legacy",
      sourceKey: "between",
      platformCampaignId: "old-id",
    }],
    unboundFacts: [{
      date: "2026-08-17",
      canonicalCampaignId: 777,
      sourceKey: "between",
      platformAccountId: "1113",
      platformCampaignId: "24999",
      campaignName: "Unbound",
      impressions: 10,
      clicks: 1,
      spend: 2,
      views: 3,
      conversions: 0,
      reach: 4,
    }],
  };

  const result = buildAdvertisingBindingDiagnostics(
    readModel,
    [{ source_key: "between", platform_account_id: "1113", report_date: "2026-08-17", coverage_state: "complete_with_data" }],
    "2026-08-17",
    "2026-08-20",
    "2026-08-19",
  );

  assert.equal(result.unresolved_legacy_bindings.length, 1);
  assert.deepEqual(result.unbound_campaigns[0], {
    canonical_campaign_id: 777,
    source_key: "between",
    platform_account_id: "1113",
    platform_campaign_id: "24999",
    campaign_name: "Unbound",
    first_date: "2026-08-17",
    last_date: "2026-08-17",
    fact_totals: { impressions: 10, clicks: 1, spend: 2, views: 3, conversions: 0, reach: 4 },
  });
  assert.deepEqual(result.missing_coverage_dates, [{
    source_key: "between",
    platform_account_id: "1113",
    report_date: "2026-08-18",
    coverage_state: "missing",
  }]);
});
