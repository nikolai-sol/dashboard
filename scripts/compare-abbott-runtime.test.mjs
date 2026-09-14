import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";
import * as parityTool from "./compare-abbott-runtime.mjs";

import {
  ABBOTT_PARITY_PERIOD,
  SafeStageError,
  buildAuthorizedRequest,
  compareRedactedValues,
  createPrivateReportDirectory,
  fetchNoRedirect,
  formatSafeCliFailure,
  parseCredentialLines,
  runSafeStage,
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
      counters: ["90602537"],
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

test("payload contract rejects identically wrong periods and missing required sections", () => {
  const wrongLeft = fixture();
  const wrongRight = fixture();
  wrongLeft.dashboard.period.to = "2026-09-12";
  wrongRight.dashboard.period.to = "2026-09-12";
  assert.throws(() => summarizeAbbottPayload(wrongLeft, { audience: "manager" }), /PAYLOAD_CONTRACT/);
  assert.throws(() => summarizeAbbottPayload(wrongRight, { audience: "manager" }), /PAYLOAD_CONTRACT/);

  const missing = fixture();
  delete missing.abbott_bi.page_stats;
  assert.throws(() => summarizeAbbottPayload(missing, { audience: "manager" }), /PAYLOAD_CONTRACT/);
});

test("return-frequency displayed totals participate in parity", () => {
  const left = summarizeAbbottPayload(fixture(), { audience: "manager" });
  const changed = fixture();
  changed.abbott_bi.return_frequency.identified_visitors = 1;
  changed.abbott_bi.return_frequency.unidentified_visits = 2;
  const mismatch = compareRedactedValues(left, summarizeAbbottPayload(changed, { audience: "manager" }));

  assert.deepEqual(mismatch, [
    "supplemental_totals.identified_visitors",
    "supplemental_totals.unidentified_visits",
  ]);

  const returningChanged = fixture();
  returningChanged.abbott_bi.returning[0].returning_1_day = 2;
  assert.deepEqual(compareRedactedValues(left, summarizeAbbottPayload(returningChanged, { audience: "manager" })), [
    "tab_rows.returning.numeric_aggregates.returning_1_day",
  ]);
  const wrongTotalType = fixture();
  wrongTotalType.abbott_bi.return_frequency.identified_visitors = "0";
  assert.throws(() => summarizeAbbottPayload(wrongTotalType, { audience: "manager" }), /PAYLOAD_CONTRACT/);
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
  assert.deepEqual(summary.sheets[0].cells.map(({ coordinate, type }) => ({ coordinate, type })), [
    { coordinate: "A1", type: "string" },
    { coordinate: "B1", type: "string" },
    { coordinate: "C1", type: "string" },
    { coordinate: "A2", type: "string" },
    { coordinate: "B2", type: "number" },
    { coordinate: "C2", type: "formula" },
  ]);
  assert.match(summary.semantic_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(text, /B2\*2|2099-01-01/);
});

test("workbook semantics detect changed values and moved cells or formulas", async () => {
  const bytes = async (configure) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    configure(sheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };
  const original = await summarizeWorkbook(await bytes((sheet) => {
    sheet.getCell("A1").value = 1;
    sheet.getCell("B1").value = { formula: "A1+1", result: 2 };
  }));
  const changedValue = await summarizeWorkbook(await bytes((sheet) => {
    sheet.getCell("A1").value = 99;
    sheet.getCell("B1").value = { formula: "A1+1", result: 100 };
  }));
  const moved = await summarizeWorkbook(await bytes((sheet) => {
    sheet.getCell("A2").value = 1;
    sheet.getCell("B2").value = { formula: "A2+1", result: 2 };
  }));
  const empty = new ExcelJS.Workbook();

  assert.notEqual(original.semantic_sha256, changedValue.semantic_sha256);
  assert.notEqual(original.semantic_sha256, moved.semantic_sha256);
  assert.deepEqual((await summarizeWorkbook(Buffer.from(await empty.xlsx.writeBuffer()))).sheets, []);
});

test("decimal aggregates are order-independent at six decimal places and preserve integer counts", () => {
  const left = fixture();
  left.abbott_bi.page_stats = [
    { page_title: "Same", url: "[fixture]", pageviews: 1, bounce_rate: 0.1 },
    { page_title: "Same", url: "[fixture]", pageviews: 2, bounce_rate: 0.2 },
    { page_title: "Same", url: "[fixture]", pageviews: 3, bounce_rate: 0.3 },
  ];
  const reordered = structuredClone(left);
  reordered.abbott_bi.page_stats.reverse();
  const changed = structuredClone(left);
  changed.abbott_bi.page_stats[2].bounce_rate = 0.300001;

  const leftSummary = summarizeAbbottPayload(left, { audience: "manager" });
  const reorderedSummary = summarizeAbbottPayload(reordered, { audience: "manager" });
  const changedSummary = summarizeAbbottPayload(changed, { audience: "manager" });
  assert.deepEqual(leftSummary, reorderedSummary);
  assert.equal(leftSummary.tab_rows.page_stats.numeric_aggregates.pageviews, 6);
  assert.equal(leftSummary.tab_rows.page_stats.numeric_aggregates.bounce_rate, "0.6");
  assert.deepEqual(compareRedactedValues(leftSummary, changedSummary), [
    "tab_rows.page_stats.numeric_aggregates.bounce_rate",
  ]);
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

  assert.equal((await stat(typeof directory === "string" ? directory : directory.path)).mode & 0o777, 0o700);
  assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(report, /manager-fixture|embed-fixture/);
  await parityTool.cleanupPrivateOutputDirectory?.(directory);
});

test("output containment rejects links into Git and a swapped parent", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "abbott-output-boundary-"));
  const linked = path.join(outside, "linked-output");
  await symlink(process.cwd(), linked);
  await assert.rejects(
    createPrivateReportDirectory(linked, process.cwd()),
    /outside Git|OUTPUT_CONTAINMENT/,
  );

  const parent = path.join(outside, "parent");
  const held = path.join(outside, "held-parent");
  await mkdir(parent, { mode: 0o700 });
  const before = new Set(await readdir(process.cwd()));
  await assert.rejects(createPrivateReportDirectory(parent, process.cwd(), {
    afterValidation: async () => {
      await rename(parent, held);
      await symlink(process.cwd(), parent);
    },
  }), /OUTPUT_CONTAINMENT/);
  const after = await readdir(process.cwd());
  assert.deepEqual(new Set(after), before);
});

test("exclusive no-follow report write rejects a swapped leaf without changing its target", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-output-leaf-"));
  const directory = await createPrivateReportDirectory(parent);
  const target = path.join(parent, "protected-target");
  await writeFile(target, "unchanged", { mode: 0o600 });

  await assert.rejects(writeParityReport(directory, { status: "match" }, {
    beforeOpen: () => symlink(target, path.join(typeof directory === "string" ? directory : directory.path, "abbott-runtime-parity.json")),
  }), /OUTPUT_WRITE/);
  assert.equal(await readFile(target, "utf8"), "unchanged");
  await parityTool.cleanupPrivateOutputDirectory?.(directory);
});

test("retained output identity rejects a renamed directory replacement and cleans only the approved inode", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "abbott-retained-output-"));
  const fakeRepository = path.join(outside, "fake-repository");
  const outputParent = path.join(outside, "output-parent");
  const renamedApproved = path.join(outputParent, "renamed-approved");
  await mkdir(fakeRepository, { mode: 0o700 });
  await mkdir(outputParent, { mode: 0o700 });
  const output = await createPrivateReportDirectory(outputParent, fakeRepository);
  assert.equal(typeof parityTool.cleanupPrivateOutputDirectory, "function");
  assert.equal(typeof output, "object");
  const originalPath = output.path;
  await rename(originalPath, renamedApproved);
  await symlink(fakeRepository, originalPath);

  await assert.rejects(writeParityReport(output, { status: "match" }), /OUTPUT_CONTAINMENT|OUTPUT_WRITE/);
  assert.deepEqual(await readdir(fakeRepository), []);
  await parityTool.cleanupPrivateOutputDirectory(output);
  assert.equal(await readlink(originalPath), fakeRepository);
  assert.equal(await stat(renamedApproved).then(() => true).catch(() => false), false);
  assert.deepEqual(await readdir(fakeRepository), []);
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

test("runtime origins are literal HTTP loopback with exact ports", () => {
  assert.equal(buildAuthorizedRequest("http://127.0.0.1:3004", "/api/dashboard/18", { kind: "manager", value: "manager-fixture" }).url.origin, "http://127.0.0.1:3004");
  for (const origin of [
    "https://127.0.0.1:3004",
    "http://localhost:3004",
    "http://example.test:3004",
    "http://127.0.0.1:3002",
    "http://user:pass@127.0.0.1:3004",
  ]) {
    assert.throws(() => buildAuthorizedRequest(origin, "/api/dashboard/18", { kind: "manager", value: "manager-fixture" }), /LOOPBACK_ORIGIN/);
  }
});

test("credentialed fetch refuses redirects without following them", async () => {
  let calls = 0;
  await assert.rejects(fetchNoRedirect(
    new URL("http://127.0.0.1:3004/api/dashboard/18"),
    { headers: { cookie: "dashboard_viewer_18=manager-fixture" } },
    "PAYLOAD_FETCH",
    async (_url, options) => {
      calls += 1;
      assert.equal(options.redirect, "error");
      return new Response(null, { status: 302, headers: { location: "http://example.test/private" } });
    },
  ), (error) => error instanceof SafeStageError && error.code === "PAYLOAD_FETCH");
  assert.equal(calls, 1);
});

test("safe stage errors never render JSON, workbook, browser, URL, or credential details", async () => {
  const privateText = "manager-fixture embed-fixture http://127.0.0.1:3004/?access_token=fixture raw-cell";
  for (const [code, operation] of [
    ["PAYLOAD_JSON", async () => JSON.parse(`{${privateText}`)],
    ["WORKBOOK_PARSE", async () => summarizeWorkbook(Buffer.from(privateText))],
    ["BROWSER_CAPTURE", async () => { throw new Error(`browser failed ${privateText}`); }],
  ]) {
    await assert.rejects(runSafeStage(code, operation), SafeStageError);
    const output = formatSafeCliFailure(await runSafeStage(code, operation).catch((caught) => caught), "ABBOTT_TEST");
    assert.equal(output, `ABBOTT_TEST_FAILED stage=${code}\n`);
    assert.doesNotMatch(output, /manager-fixture|embed-fixture|http|token|raw-cell|parse failed|workbook failed|browser failed/i);
  }
});
