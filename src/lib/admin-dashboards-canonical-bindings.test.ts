import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDashboardPayload } from "./admin-dashboards";

test("dashboard payload preserves canonical binding identity and effective dates", () => {
  const payload = normalizeDashboardPayload({
    client_id: "canonical-client",
    client_name: "Canonical Client",
    dashboard_name: "Canonical Dashboard",
    dashboard_type: "awareness",
    config: {},
    sources: [],
    media_plan_bindings: [{
      line_key: "olv-serials",
      channel: "OLV Serials",
      canonical_campaign_id: 501,
      effective_from: "2026-08-01",
      effective_to: null,
      source_key: "untrusted-source",
      platform_account_id: "untrusted-account",
      platform_campaign_id: "untrusted-campaign",
    }],
  });

  assert.deepEqual(payload.media_plan_bindings, [{
    line_key: "olv-serials",
    channel: "OLV Serials",
    canonical_campaign_id: 501,
    effective_from: "2026-08-01",
    effective_to: null,
  }]);
});
