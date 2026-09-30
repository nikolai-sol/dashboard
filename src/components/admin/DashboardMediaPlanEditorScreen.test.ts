import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFormData } from "@/lib/admin-ui-types";
import { buildMediaPlanSavePayload } from "./DashboardMediaPlanEditorScreen";

function dashboardForm(): DashboardFormData {
  return {
    client_id: "hudeem",
    client_name: "Hudeem",
    dashboard_name: "Hudeem Media",
    dashboard_type: "awareness",
    config: {
      currency: "RUB",
      period_from: "2026-09-01",
      period_to: "2026-09-30",
      visible_metrics: [],
      show_spend: true,
      show_ai_summary: false,
      kpi_cards: [],
    },
    sources: [{
      platform: "google_sheets",
      schema_file: "media_plan",
      role: "plan",
      source_config: {
        inline_rows: [
          { line_key: "programmati-old", channel: "программати", platform: "Hybrid" },
          { line_key: "third-party", channel: "программатик 3rd party", platform: "Hybrid" },
        ],
      },
      filters: [],
    }],
    media_plan_bindings: [
      {
        line_key: "programmati-old",
        channel: "программати",
        source_key: "hybrid",
        canonical_campaign_id: 860,
        platform_account_id: "hudeem",
        platform_campaign_id: "f860",
        effective_from: "2026-09-01",
        effective_to: "2026-09-30",
      },
      {
        line_key: "third-party",
        channel: "программатик 3rd party",
        source_key: "between",
        canonical_campaign_id: 25073,
        platform_account_id: "gidrofuril",
        platform_campaign_id: "25073",
        effective_from: "2026-09-01",
        effective_to: "2026-09-30",
      },
    ],
  };
}

test("save payload moves bindings with a renamed row and preserves unrelated bindings", () => {
  const form = dashboardForm();
  const thirdPartyBinding = form.media_plan_bindings[1];

  const payload = buildMediaPlanSavePayload(form, [{
    __saved_line_key: "programmati-old",
    line_key: "programmatik-new",
    channel: "программатик",
    platform: "Hybrid",
  }, {
    __saved_line_key: "third-party",
    line_key: "third-party",
    channel: "программатик 3rd party",
    platform: "Hybrid",
  }], 0);

  assert.equal(payload.media_plan_bindings.length, 2);
  assert.deepEqual(payload.media_plan_bindings[0], {
    ...form.media_plan_bindings[0],
    line_key: "programmatik-new",
    channel: "программатик",
  });
  assert.strictEqual(payload.media_plan_bindings[1], thirdPartyBinding);
  assert.deepEqual(
    (payload.sources[0].source_config?.inline_rows as Array<Record<string, unknown>>)
      .map((row) => ({ line_key: row.line_key, channel: row.channel })),
    [
      { line_key: "programmatik-new", channel: "программатик" },
      { line_key: "third-party", channel: "программатик 3rd party" },
    ],
  );
});

test("save payload rejects a renamed row key already owned by another row", () => {
  const form = dashboardForm();

  assert.throws(
    () => buildMediaPlanSavePayload(form, [{
      __saved_line_key: "programmati-old",
      line_key: "third-party",
      channel: "программатик",
      platform: "Hybrid",
    }, {
      __saved_line_key: "third-party",
      line_key: "third-party",
      channel: "программатик 3rd party",
      platform: "Hybrid",
    }], 0),
    /line_key.*third-party.*already used/i,
  );
});

test("save payload rejects a renamed row key owned only by a stale binding", () => {
  const form = dashboardForm();
  form.media_plan_bindings.push({
    ...form.media_plan_bindings[1],
    line_key: "orphan-key",
    canonical_campaign_id: 861,
    platform_campaign_id: "f861",
  });

  assert.throws(
    () => buildMediaPlanSavePayload(form, [{
      __saved_line_key: "programmati-old",
      line_key: "orphan-key",
      channel: "программатик",
      platform: "Hybrid",
    }, {
      __saved_line_key: "third-party",
      line_key: "third-party",
      channel: "программатик 3rd party",
      platform: "Hybrid",
    }], 0),
    /line_key.*orphan-key.*binding/i,
  );
});

test("save payload rejects two editor rows that claim the same saved key", () => {
  const form = dashboardForm();

  assert.throws(
    () => buildMediaPlanSavePayload(form, [{
      __saved_line_key: "programmati-old",
      line_key: "programmatik-new",
      channel: "программатик",
      platform: "Hybrid",
    }, {
      __saved_line_key: "programmati-old",
      line_key: "third-party",
      channel: "программатик 3rd party",
      platform: "Hybrid",
    }], 0),
    /saved line_key.*programmati-old.*more than one/i,
  );
});
