import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  ABBOTT_PARITY_PERIOD,
  buildAuthorizedRequest,
  compareRedactedValues,
  createPrivateReportDirectory,
  parseCredentialLines,
  summarizeAbbottPayload,
  summarizeWorkbook,
  writeParityReport,
} from "./compare-abbott-runtime.mjs";

function fixture() {
  return {
    dashboard: {
      client_name: "Abbott",
      dashboard_name: "Analytics",
      type: "abbott_bi",
      period: { ...ABBOTT_PARITY_PERIOD },
      currency: "RUB",
      language: "ru",
      show_spend: false,
      filter_scope: "both",
      section_order: [],
      generated_at: "2099-01-01T00:00:00.000Z",
      logo_url: null,
    },
    kpi: { total_clicks: 12, total_conversions: 3, avg_ctr: 1.5 },
    access_token: "[fixture]",
    cookie: "[fixture]",
    abbott_bi: {
      data_quality: {
        status: "complete",
        release_id: 8,
        requested_scopes: ["other", "traffic", "page", "user_behavior", "returning"],
        requested_from: "2026-09-01",
        requested_to: "2026-09-13",
        blocking_gaps: [],
      },
      users_summary: [{ raw_user_id: "[fixture]", visits: 2, users: 1 }],
      users_summary_without_admins: [{ raw_user_id: "[fixture]", visits: 2, users: 1 }],
      traffic_summary: [{ traffic_source: "Direct", visits: 2, users: 1 }],
      user_actions: [{ visit_id: "[fixture]", start_url: "[fixture]", end_url: "[fixture]", visits: 2 }],
      page_stats: [{ page_title: "Article", url: "[fixture]", pageviews: 4 }],
      bitrix_pages: [],
      session_journeys: { report_date: "", schema: null, summary: null, rows: [] },
      external_events: [],
      external_clicks: [],
      time_buckets: { overall: [], materials: [], by_page: [] },
      returning: [{ url: "[fixture]", visits: 2, returning_1_day: 1 }],
      return_frequency: {
        available: false,
        period_local: true,
        identified_visitors: 0,
        unidentified_visits: 0,
        groups: [],
        user_directions: [],
        return_pages: [],
      },
      general_materials: [{ material_name: "Article", url: "[fixture]", pageviews: 4 }],
      admin_user_filter: { available: true },
    },
  };
}

test("parity summary excludes secrets and volatile timestamps", () => {
  const summary = summarizeAbbottPayload(fixture(), { administratorExclusionCount: 2 });
  const text = JSON.stringify(summary);

  assert.doesNotMatch(text, /access_token|cookie|raw_user_id|visit_id|start_url|end_url/i);
  assert.doesNotMatch(text, /2099-01-01|\[fixture\]/);
  assert.deepEqual(summary.period, { from: "2026-09-01", to: "2026-09-13" });
  assert.deepEqual(summary.tabs, ["users_summary", "user_actions", "page_stats", "returning", "general_materials"]);
  assert.equal(summary.administrator_exclusion_count, 2);
  assert.equal(summary.tab_rows.users_summary.count, 1);
  assert.match(summary.tab_rows.users_summary.stable_identifier_hashes[0], /^[a-f0-9]{64}$/);
  assert.deepEqual(summary.tab_rows.users_summary.numeric_aggregates, { users: 1, visits: 2 });
});

test("summary is deterministic across object-key and row ordering", () => {
  const first = fixture();
  first.abbott_bi.page_stats.push({ page_title: "Second", url: "[fixture]", pageviews: 5 });
  const second = structuredClone(first);
  second.abbott_bi.page_stats.reverse();
  second.kpi = { avg_ctr: 1.5, total_conversions: 3, total_clicks: 12 };

  assert.deepEqual(summarizeAbbottPayload(first), summarizeAbbottPayload(second));
});

test("conditional time tab visibility matches the dashboard's positive-user rule", () => {
  const payload = fixture();
  payload.abbott_bi.time_buckets.overall = [{ bucket_id: "none", users: 0 }];
  assert.equal(summarizeAbbottPayload(payload).tabs.includes("time_buckets"), false);
  payload.abbott_bi.time_buckets.overall[0].users = 1;
  assert.equal(summarizeAbbottPayload(payload).tabs.includes("time_buckets"), true);
});

test("redacted comparison returns field paths without differing values", () => {
  const left = summarizeAbbottPayload(fixture(), { administratorExclusionCount: 2 });
  const changed = fixture();
  changed.abbott_bi.users_summary[0].visits = 7;
  const right = summarizeAbbottPayload(changed, { administratorExclusionCount: 3 });
  const mismatches = compareRedactedValues(left, right);
  const text = JSON.stringify(mismatches);

  assert.deepEqual(mismatches, [
    "administrator_exclusion_count",
    "tab_rows.users_summary.numeric_aggregates.visits",
  ]);
  assert.doesNotMatch(text, /\b[237]\b|\[fixture\]/);
});

test("workbook summary compares sheet names, row counts, cell types, and formula hashes", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2099-01-01T00:00:00.000Z");
  const sheet = workbook.addWorksheet("Summary");
  sheet.addRow(["Metric", "Value", "Derived"]);
  sheet.addRow(["Sessions", 4, { formula: "B2*2", result: 8 }]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const summary = await summarizeWorkbook(bytes);
  const text = JSON.stringify(summary);

  assert.deepEqual(summary.sheets.map(({ name, row_count }) => ({ name, row_count })), [
    { name: "Summary", row_count: 2 },
  ]);
  assert.deepEqual(summary.sheets[0].cell_types, { formula: 1, number: 1, string: 4 });
  assert.equal(summary.sheets[0].formula_hashes.length, 1);
  assert.match(summary.semantic_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(text, /B2\*2|2099-01-01/);
});

test("credential input is bounded, positional, and never included in report output", async () => {
  assert.deepEqual(parseCredentialLines("manager-fixture\nembed-fixture\n"), {
    managerPassword: "manager-fixture",
    embedKey: "embed-fixture",
  });
  assert.throws(() => parseCredentialLines("only-one-line\n"), /two non-empty lines/);
  assert.throws(() => parseCredentialLines("x".repeat(70_000)), /too large/);

  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-parity-test-"));
  const directory = await createPrivateReportDirectory(parent);
  const reportPath = await writeParityReport(directory, {
    status: "match",
    period: ABBOTT_PARITY_PERIOD,
    audiences: { manager: { mismatch_paths: [] }, embed: { mismatch_paths: [] } },
  });
  const report = await readFile(reportPath, "utf8");

  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(report, /manager-fixture|embed-fixture/);
});

test("manager authorization uses an in-memory cookie instead of a query URL", () => {
  const request = buildAuthorizedRequest(
    "http://127.0.0.1:3004",
    "/api/dashboard/18",
    { kind: "manager", value: "manager-fixture" },
  );

  assert.doesNotMatch(request.url.href, /manager-fixture|access_token|cookie/i);
  assert.equal(request.options.headers.cookie, "dashboard_viewer_18=manager-fixture");
});
