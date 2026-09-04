import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { groupByChannel, parseMediaPlanSource } from "@/lib/gsheet-fetcher";
import { fetchLeadsFromSourceConfig } from "@/lib/leads-fetcher";
import { fetchManualDataFromSourceConfig } from "@/lib/manual-data-fetcher";

test("parseMediaPlanSource reads legacy BIFF .xls uploads", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["date", "platform", "channel", "buy_type", "budget_plan", "impressions_plan", "leads", "clicks"],
      ["2026-08-01", "yandex_direct", "Search", "CPM", 1_000, 10_000, 3, 7],
    ]),
    "Plan",
  );
  const bytes = XLSX.write(workbook, { bookType: "biff8", type: "buffer" }) as Buffer;

  const result = await parseMediaPlanSource({
    upload_file: {
      filename: "legacy-plan.xls",
      mime_type: "application/vnd.ms-excel",
      content_base64: bytes.toString("base64"),
    },
  });

  assert.equal(result.format, "canonical_template");
  assert.equal(result.raw_rows, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].platform, "yandex");
  assert.equal(result.rows[0].budget_plan, 1_000);
  assert.equal(result.rows[0].impressions_plan, 10_000);

  const uploadFile = {
    filename: "legacy-plan.xls",
    mime_type: "application/vnd.ms-excel",
    content_base64: bytes.toString("base64"),
  };
  const manual = await fetchManualDataFromSourceConfig({ upload_file: uploadFile });
  const leads = await fetchLeadsFromSourceConfig({ upload_file: uploadFile });
  assert.deepEqual(manual.map((row) => [row.date, row.platform, row.clicks]), [["2026-08-01", "yandex", 7]]);
  assert.deepEqual(leads.rows.map((row) => [row.date, row.platform, row.leads]), [["2026-08-01", "yandex", 3]]);
});

test("parseMediaPlanSource reads CSV uploads labeled with the Excel MIME type", async () => {
  const csv = [
    "date,platform,channel,buy_type,budget_plan,impressions_plan,leads,clicks",
    "2026-08-02,vk_ads,Social,CPM,2000,25000,4,8",
  ].join("\n");

  const result = await parseMediaPlanSource({
    upload_file: {
      filename: "media-plan.csv",
      mime_type: "application/vnd.ms-excel",
      content_base64: Buffer.from(csv, "utf8").toString("base64"),
    },
  });

  assert.equal(result.format, "canonical_template");
  assert.equal(result.raw_rows, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].platform, "vk");
  assert.equal(result.rows[0].budget_plan, 2_000);
  assert.equal(result.rows[0].impressions_plan, 25_000);

  const uploadFile = {
    filename: "metrics.csv",
    mime_type: "application/vnd.ms-excel",
    content_base64: Buffer.from(csv, "utf8").toString("base64"),
  };
  const manual = await fetchManualDataFromSourceConfig({ upload_file: uploadFile });
  const leads = await fetchLeadsFromSourceConfig({ upload_file: uploadFile });
  assert.deepEqual(manual.map((row) => [row.date, row.platform, row.clicks]), [["2026-08-02", "vk", 8]]);
  assert.deepEqual(leads.rows.map((row) => [row.platform, row.leads]), [["vk", 4]]);
});

test("parseMediaPlanSource preserves nested monthly values from stored inline rows", async () => {
  const result = await parseMediaPlanSource({
    inline_rows: [
      {
        line_key: "olw::hybrid::1",
        platform: "hybrid/between",
        channel: "ОЛВ WL inpage",
        format: "In-stream",
        buy_type: "CPM",
        units_plan: 1450,
        unit_price: 220,
        budget_plan: 319000,
        impressions_plan: 1450000,
        reach_plan: 483333,
        clicks_plan: 4350,
        monthly: {
          июль: 550000,
          август: 700000,
          сентябрь: 200000,
        },
      },
    ],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].monthly.июль, 550000);
  assert.equal(result.rows[0].monthly.август, 700000);
  assert.equal(result.rows[0].monthly.сентябрь, 200000);

  const [group] = groupByChannel(result.rows);
  assert.equal(group.monthly_breakdown.июль.impressions, 550000);
  assert.equal(group.monthly_breakdown.август.impressions, 700000);
  assert.equal(group.monthly_breakdown.сентябрь.impressions, 200000);
  assert.equal(group.monthly_breakdown.июль.budget, 121000);
  assert.equal(group.monthly_breakdown.август.budget, 154000);
  assert.equal(group.monthly_breakdown.сентябрь.budget, 44000);
});
