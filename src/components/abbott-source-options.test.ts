import test from "node:test";
import assert from "node:assert/strict";
import * as sources from "./abbott-localization";
import { selectAbbottSummaryRows } from "./abbott-summary";
import { ABBOTT_WITHOUT_ADMINS } from "./abbott/abbott-admin-user-filter";
import type { AbbottBiUserSummaryRow } from "@/lib/types";

function row(traffic_source: string, visits = 10): AbbottBiUserSummaryRow {
  return { traffic_source, visits, user_id: "", has_user_id: false, traffic_segment: "all",
    direction: null, users: 5, new_users: 0, page_depth: 2, avg_duration: 30, bounce_rate: 0 };
}

test("native options come only from the selected manager or embed population", () => {
  assert.equal(typeof sources.abbottTrafficSourceOptions, "function");
  const trafficRows = [row("Direct traffic", 40), row("Ad traffic", 20)];
  const behaviorRows = [row("direct", 30), row("ad", 15), row("undefined", 2)];
  const before = JSON.stringify({ trafficRows, behaviorRows });
  for (const manager of [true, false]) {
    const selected = selectAbbottSummaryRows({ trafficRows, behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" }, showUserIdAnalytics: manager });
    const options = sources.abbottTrafficSourceOptions(selected);
    assert.deepEqual(new Set(options.map(o => o.value)),
      new Set(manager ? ["direct", "ad", "undefined"] : ["Direct traffic", "Ad traffic"]));
    assert.ok(options.every(o => o.label === o.value));
    assert.equal(selected.reduce((n, r) => n + r.visits, 0), manager ? 47 : 60);
  }
  assert.equal(JSON.stringify({ trafficRows, behaviorRows }), before);
});

test("admin-free and period changes drop unavailable sources without aliases", () => {
  assert.equal(typeof sources.abbottTrafficSourceOptions, "function");
  assert.equal(typeof sources.availableAbbottTrafficSource, "function");
  const selected = selectAbbottSummaryRows({ trafficRows: [row("Direct traffic")],
    behaviorRows: [row("direct"), row("ad")], behaviorRowsWithoutAdmins: [row("direct")],
    filters: { user_id: ABBOTT_WITHOUT_ADMINS, user_id_traffic: "", direction: "" }, showUserIdAnalytics: true });
  const options = sources.abbottTrafficSourceOptions(selected);
  assert.equal(sources.availableAbbottTrafficSource("direct", options), "direct");
  assert.equal(sources.availableAbbottTrafficSource("ad", options), "");
  assert.equal(sources.availableAbbottTrafficSource("Direct traffic", options), "");
  assert.equal(sources.availableAbbottTrafficSource("direct", []), "");
});

test("native option identity preserves rare values and excludes empty placeholders", () => {
  assert.equal(typeof sources.abbottTrafficSourceOptions, "function");
  const options = sources.abbottTrafficSourceOptions(
    [row("direct"), row("direct"), row("undefined"), row("Unknown traffic"), row("custom-native"), row("")]);
  assert.equal(options.length, 4);
  assert.deepEqual(new Set(options.map(o => o.value)), new Set(["direct", "undefined", "Unknown traffic", "custom-native"]));
  assert.ok(options.every(o => o.value === o.label));
});
