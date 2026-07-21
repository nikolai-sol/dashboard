import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectAbbottDashboardData } from "@/lib/abbott-data-projection";
import type { DashboardData } from "@/lib/types";

function fixture(): DashboardData {
  return {
    dashboard: {
      client_name: "Abbott",
      dashboard_name: "Private analytics",
      type: "abbott_bi",
      period: { from: "2026-07-01", to: "2026-07-15" },
      currency: "RUB",
      language: "ru",
      show_spend: false,
      filter_scope: "both",
      section_order: [],
    },
    kpi_config: [],
    kpi: {
      total_impressions: 0,
      total_clicks: 0,
      total_spend: 0,
      total_conversions: 0,
      avg_ctr: 0,
      avg_cpm: 0,
      prev_impressions: 0,
      prev_clicks: 0,
      prev_spend: 0,
      prev_conversions: 0,
      prev_ctr: 0,
      prev_cpm: 0,
    },
    platforms: [],
    timeseries: [],
    plan_vs_fact: [],
    abbott_bi: {
      counters: ["90602537"],
      users_summary: [
        {
          user_id: "raw-user-42",
          has_user_id: true,
          traffic_segment: null,
          traffic_source: "Direct",
          direction: "Cardiology",
          visits: 3,
          users: 1,
          new_users: 0,
          page_depth: 2,
          avg_duration: 90,
          bounce_rate: 0,
        },
      ],
      traffic_summary: [
        {
          user_id: "",
          has_user_id: false,
          traffic_segment: null,
          traffic_source: "Organic",
          direction: null,
          visits: 50,
          users: 40,
          new_users: 30,
          page_depth: 1.5,
          avg_duration: 75,
          bounce_rate: 20,
        },
      ],
      user_actions: [
        {
          user_id: "raw-user-42",
          has_user_id: true,
          traffic_source: "Direct",
          direction: "Cardiology",
          start_url: "https://example.test/start?token=private#section",
          end_url: "https://example.test/end?doctor=private#footer",
          visits: 1,
          page_depth: 2,
          avg_duration: 90,
        },
      ],
      page_stats: [
        {
          page_title: "Material",
          url: "https://example.test/material?utm_source=secret#chapter",
          direction: "Cardiology",
          material_type: "Article",
          access: "Public",
          pageviews: 10,
          users: 8,
          bitrix_pageviews: 5,
          bitrix_sessions: 4,
          bitrix_users: 3,
          bitrix_logged_in_sessions: 2,
          bitrix_anonymous_sessions: 2,
          bitrix_avg_session_duration: 60,
        },
      ],
      bitrix_pages: [
        {
          url: "https://example.test/bitrix?sid=private#top",
          path: "/bitrix?sid=private#top",
          direction: "Cardiology",
          material_type: "Article",
          access: "Public",
          pageviews: 5,
          sessions: 4,
          users: 3,
          guests: 1,
          logged_in_hits: 4,
          anonymous_hits: 1,
          logged_in_sessions: 3,
          anonymous_sessions: 1,
          entry_sessions: 2,
          exit_sessions: 2,
          avg_session_duration: 60,
          top_utm_source: "email",
          top_utm_medium: "newsletter",
          top_utm_campaign: "launch",
        },
      ],
      bitrix_summary: null,
      bitrix_period_active: true,
      session_journeys: {
        report_date: "2026-07-15",
        schema: null,
        summary: {
          sessions_in_day: 1,
          sessions_exported: 1,
          sessions_with_user_id: 1,
          sessions_with_content_path: 1,
          hits_total: 2,
          hits_clean: 2,
          events_available: true,
        },
        rows: [
          {
            session_id: 777,
            user_id: "raw-user-42",
            has_user_id: true,
            entry_url_day: "https://example.test/entry?sid=private#start",
            exit_url_day: "https://example.test/exit?sid=private#end",
            entry_url_session: "/entry?sid=private#start",
            exit_url_session: "/exit?sid=private#end",
            hits_total: 2,
            hits_clean: 2,
            hits_content: 2,
            steps_content: 2,
            events_count: 1,
            duration_seconds: 60,
            content_path: [
              "https://example.test/entry?sid=private#start",
              "https://example.test/exit?sid=private#end",
            ],
            content_path_summary:
              "https://example.test/entry?sid=private#start -> https://example.test/exit?sid=private#end",
            all_path_summary: "/entry?sid=private#start -> /exit?sid=private#end",
            events_available: true,
          },
        ],
      },
      external_events: [
        {
          title: "Conference",
          direction: "Cardiology",
          registration_url: "https://events.test/register?email=private#form",
          access: "Public",
        },
      ],
      external_clicks: [
        {
          title: "Conference",
          direction: "Cardiology",
          external_url: "https://events.test/register?email=private#form",
          outbound_clicks: 7,
        },
      ],
      time_buckets: {
        overall: [{ bucket_id: "lt_1m", label: "< 1 minute", users: 10 }],
        materials: [{ bucket_id: "lt_1m", label: "< 1 minute", users: 6 }],
        by_page: [
          {
            url: "https://example.test/material?doctor=private#time",
            buckets: [{ bucket_id: "lt_1m", label: "< 1 minute", users: 6 }],
          },
        ],
      },
      returning: [
        {
          url: "https://example.test/material?doctor=private#returning",
          direction: "Cardiology",
          visits: 10,
          returning_1_day: 2,
          returning_2_7_days: 3,
          returning_8_31_days: 1,
        },
      ],
      general_materials: [
        {
          material_name: "Material",
          url: "https://example.test/material?doctor=private#general",
          pageviews: 10,
          users: 8,
        },
      ],
    },
  };
}

function assertNoForbiddenKeys(value: unknown, forbiddenKeys: Set<string>, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    assert.equal(forbiddenKeys.has(key), false, `forbidden key ${key} at ${path}`);
    assertNoForbiddenKeys(nested, forbiddenKeys, `${path}.${key}`);
  }
}

test("manager projection retains raw user IDs and journey rows while stripping URL query and fragment values", () => {
  const source = fixture();
  source.abbott_bi!.general_materials[0]!.material_name = "FAQ/help?answer";
  source.abbott_bi!.page_stats[0]!.url = "HTTPS://Example.TEST:443/Case?secret=value#chapter";
  source.abbott_bi!.session_journeys.rows[0]!.entry_url_session = "entry?sid=private#start";
  source.abbott_bi!.session_journeys.rows[0]!.content_path_summary =
    "https://example.test/entry?sid=private#start, -> exit?sid=private#end.";
  const projected = projectAbbottDashboardData(source, "manager");
  const abbott = projected.abbott_bi!;

  assert.equal(abbott.users_summary[0]?.user_id, "raw-user-42");
  assert.equal(abbott.user_actions[0]?.user_id, "raw-user-42");
  assert.equal(abbott.session_journeys.rows[0]?.user_id, "raw-user-42");
  assert.equal(abbott.session_journeys.rows[0]?.session_id, 777);
  assert.deepEqual(abbott.session_journeys.rows[0]?.content_path, [
    "https://example.test/entry",
    "https://example.test/exit",
  ]);
  assert.equal(
    abbott.session_journeys.rows[0]?.content_path_summary,
    "https://example.test/entry, -> exit.",
  );
  assert.equal(abbott.session_journeys.rows[0]?.entry_url_session, "entry");
  assert.equal(abbott.user_actions[0]?.start_url, "https://example.test/start");
  assert.equal(abbott.page_stats[0]?.url, "HTTPS://Example.TEST:443/Case");
  assert.equal(abbott.bitrix_pages[0]?.path, "/bitrix");
  assert.equal(abbott.returning[0]?.url, "https://example.test/material");
  assert.equal(abbott.general_materials[0]?.material_name, "FAQ/help?answer");

  assert.equal(source.abbott_bi?.user_actions[0]?.start_url, "https://example.test/start?token=private#section");
  assert.notEqual(projected, source);
});

test("embed projection exposes aggregates without user, action, session, or journey row identifiers", () => {
  const source = fixture();
  Object.assign(source.abbott_bi!.page_stats[0]!, {
    raw_user_id: "raw-user-42",
    visit_id: "visit-42",
    rawUserId: "raw-user-42",
    sessionIdentifier: "session-42",
    raw_user_ids_json: ["raw-user-42", "raw-user-43"],
  });
  const projected = projectAbbottDashboardData(source, "embed");
  const abbott = projected.abbott_bi!;

  assertNoForbiddenKeys(
    projected,
    new Set([
      "raw_user_id",
      "user_id",
      "session_id",
      "visit_id",
      "rawUserId",
      "sessionIdentifier",
      "raw_user_ids_json",
      "user_actions",
    ]),
  );
  assert.equal("users_summary" in abbott, false);
  assert.deepEqual(abbott.session_journeys.rows, []);
  assert.deepEqual(abbott.traffic_summary?.map((row) => row.visits), [50]);
  assert.deepEqual(abbott.page_stats.map((row) => row.pageviews), [10]);
  assert.deepEqual(abbott.page_stats.map((row) => row.users), [8]);
  assert.deepEqual(abbott.bitrix_pages.map((row) => row.sessions), [4]);
  assert.deepEqual(abbott.general_materials.map((row) => row.pageviews), [10]);
  assert.deepEqual(abbott.returning.map((row) => row.returning_2_7_days), [3]);
  assert.equal(abbott.page_stats[0]?.url, "https://example.test/material");

  assert.equal(source.abbott_bi?.session_journeys.rows.length, 1);
  assert.equal(source.abbott_bi?.users_summary[0]?.user_id, "raw-user-42");
});

test("non-Abbott dashboard data keeps its existing shape", () => {
  const source = fixture();
  source.dashboard.type = "overview";
  delete source.abbott_bi;

  assert.equal(projectAbbottDashboardData(source, "embed"), source);
});

test("protected routes project by caller audience, disable caching, and sanitize error bodies", () => {
  const routeFiles = [
    "../app/api/dashboard/[id]/route.ts",
    "../app/api/dashboard/[id]/excel/route.ts",
    "../app/api/dashboard/[id]/pdf/route.ts",
    "../app/api/dashboard/[id]/ai-summary/generate/route.ts",
  ];
  const sources = routeFiles.map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const [apiSource, excelSource, pdfSource, aiSource] = sources;

  assert.match(apiSource, /projectAbbottDashboardData\([\s\S]*access\.audience/);
  assert.match(excelSource, /projectAbbottDashboardData\([\s\S]*access\.audience/);
  assert.match(aiSource, /projectAbbottDashboardData\([\s\S]*access\.audience/);
  assert.match(pdfSource, /createViewerExportToken\(access\.context\.id, access\.audience\)/);

  for (const source of sources) {
    assert.match(source, /Cache-Control["']?:\s*["']private, no-store["']/);
    assert.doesNotMatch(source, /\bdetails\s*:/);
  }
});
