import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/admin/campaigns/all/route";

function uploadCsv(csv: string) {
  return {
    filename: "yandex-direct.csv",
    mime_type: "text/csv",
    content_base64: Buffer.from(csv, "utf8").toString("base64"),
  };
}

test("POST discovers transformed manual campaign IDs from source config", async () => {
  const request = new Request("http://localhost/api/admin/campaigns/all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sources: [
        {
          source_key: "manual_data",
          manual_transform: "yandex_direct_search_campaigns",
          upload_file: uploadCsv(
            [
              "Day,Campaign Name,Impressions,Cost",
              "2026-07-10,mtg | gidrofuril | search | symptom,10,12.5",
              "2026-07-10,mtg | gidrofuril | search | transactional,2,5",
            ].join("\n"),
          ),
        },
      ],
    }),
  });

  const response = await POST(request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    campaigns: [
      {
        source_key: "manual_data",
        platform_campaign_id: "manual:yandex|search",
        campaign_name: "yandex / search",
      },
      {
        source_key: "manual_data",
        platform_campaign_id: "manual:yandex|search transactional",
        campaign_name: "yandex / search transactional",
      },
    ],
    total: 2,
  });
});
