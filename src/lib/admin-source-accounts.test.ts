import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLatestDueDate,
  discoveryModeForSource,
  mapSourceAccountCollectionRows,
} from "./admin-source-accounts";

const NOW = new Date("2026-08-19T05:30:00.000Z");

function account(overrides: Record<string, unknown> = {}) {
  return {
    source_key: "hybrid",
    platform_account_id: "6a6c4c50585ccf551c94d0b4",
    account_name: "Gidrofuril",
    base_is_active: 1,
    settings_is_active: null,
    settings_cron_enabled: null,
    settings_collection_mode: null,
    settings_exists: 0,
    last_run_status: "success",
    last_run_at: "2026-08-19T05:10:00.000Z",
    latest_data_date: "2026-08-17",
    timezone_name: "Europe/Vienna",
    expected_hour_local: 7,
    source_delay_days: 1,
    allowed_lag_days: 0,
    lookback_days: 3,
    latest_published_date: "2026-08-17",
    unbound_campaign_count: 0,
    ...overrides,
  };
}

test("Hybrid API-discovered accounts default active and expose discovery mode", () => {
  const [row] = mapSourceAccountCollectionRows(
    [account()],
    new Map([
      ["hybrid\u00006a6c4c50585ccf551c94d0b4\u00002026-08-18", {
        source_key: "hybrid",
        platform_account_id: "6a6c4c50585ccf551c94d0b4",
        report_date: "2026-08-18",
        coverage_state: "complete_with_data",
        rows_received: 10,
        rows_rejected: 0,
        rows_published: 10,
        validation_error_count: 0,
      }],
    ]),
    NOW,
    new Map([["hybrid", "Hybrid"]]),
  );

  assert.equal(row.is_active, true);
  assert.equal(row.cron_enabled, true);
  assert.equal(row.discovery_mode, "api_discovery");
  assert.equal(row.health_status, "OK");
});

test("VK accounts identify credential registry discovery", () => {
  assert.equal(discoveryModeForSource("vk_ads_v2"), "credential_registry");
});

test("successful process with no due coverage is critical", () => {
  const [row] = mapSourceAccountCollectionRows(
    [account()],
    new Map(),
    NOW,
    new Map([["hybrid", "Hybrid"]]),
  );

  assert.equal(row.latest_due_date, "2026-08-18");
  assert.equal(row.last_run_status, "success");
  assert.equal(row.health_status, "CRITICAL");
  assert.equal(row.health_reason, "missing_due_coverage");
});

test("due date uses local expected hour and source delay", () => {
  assert.equal(
    calculateLatestDueDate(NOW, {
      timezone_name: "Europe/Vienna",
      expected_hour_local: 7,
      source_delay_days: 1,
      allowed_lag_days: 0,
    }),
    "2026-08-18",
  );
  assert.equal(
    calculateLatestDueDate(new Date("2026-08-19T04:59:00.000Z"), {
      timezone_name: "Europe/Vienna",
      expected_hour_local: 7,
      source_delay_days: 1,
      allowed_lag_days: 0,
    }),
    "2026-08-17",
  );
});
