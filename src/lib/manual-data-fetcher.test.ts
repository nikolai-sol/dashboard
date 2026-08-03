import assert from "node:assert/strict";
import test from "node:test";
import { fetchManualDataFromSourceConfig } from "@/lib/manual-data-fetcher";

function uploadCsv(csv: string) {
  return {
    filename: "yandex-direct.csv",
    mime_type: "text/csv",
    content_base64: Buffer.from(csv, "utf8").toString("base64"),
  };
}

test("fetchManualDataFromSourceConfig maps Yandex Direct search export rows into bound manual channels", async () => {
  const rows = await fetchManualDataFromSourceConfig({
    manual_transform: "yandex_direct_search_campaigns",
    upload_file: uploadCsv(
      [
        "Day,Campaign Name,Impressions,Clicks,Ctr,Avg Cpc,Cost",
        '2026-07-10,mtg | gidrofuril | search | symptom,490,8,"1,63","8,47","67,8"',
        '2026-07-10,mtg | gidrofuril | search | competitor,167,6,"3,59","8,64","51,83"',
        '2026-07-10,mtg | gidrofuril | search | symptom | transactional,1,1,100,"17,01","17,01"',
      ].join("\n"),
    ),
  });

  assert.deepEqual(rows.map((row) => ({
    date: row.date,
    platform: row.platform,
    channel: row.channel,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    reach: row.reach,
  })), [
    { date: "2026-07-10", platform: "yandex", channel: "search", impressions: 490, clicks: 8, spend: 67.8, reach: 245 },
    { date: "2026-07-10", platform: "yandex", channel: "search", impressions: 167, clicks: 6, spend: 51.83, reach: 83.5 },
    { date: "2026-07-10", platform: "yandex", channel: "search transactional", impressions: 1, clicks: 1, spend: 17.01, reach: 0.5 },
  ]);
});

test("fetchManualDataFromSourceConfig uses Yandex and cost when Direct platform and spend cells are blank", async () => {
  const rows = await fetchManualDataFromSourceConfig({
    manual_transform: "yandex_direct_search_campaigns",
    upload_file: uploadCsv(
      [
        "Day,Platform,Campaign Name,Impressions,Cost,Spend",
        "2026-07-10,,mtg | gidrofuril | search | symptom,10,12.5,",
      ].join("\n"),
    ),
  });

  assert.deepEqual(rows.map((row) => ({ platform: row.platform, spend: row.spend })), [
    { platform: "yandex", spend: 12.5 },
  ]);
});
