import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiVisibilityQuery,
  loadZarukuAiVisibilityData,
  normalizeAiVisibilityRow,
} from "@/lib/zaruku-ai-visibility";

test("buildAiVisibilityQuery scopes by account and optional weeks", () => {
  const query = buildAiVisibilityQuery(["66624469"], ["2026-W28", "2026-W29"]);

  assert.match(query.sql, /seo_ai_visibility_weekly/);
  assert.match(query.sql, /week_key IN \(\?, \?\)/);
  assert.deepEqual(query.params, ["66624469", "2026-W28", "2026-W29"]);
});

test("normalizeAiVisibilityRow parses booleans, numbers, and cited URLs JSON", () => {
  assert.deepEqual(
    normalizeAiVisibilityRow({
      week_key: "2026-W28",
      cluster_id: "cluster-1",
      query_text: "где лечить рак",
      engine: "yandex_gen_search",
      region_id: "225",
      language_code: "ru",
      device_type: "desktop",
      mentioned: 1,
      mention_count: "2",
      citation_count: "1",
      cited_urls_json: JSON.stringify(["https://zaruku.ru/map/"]),
      checked_at: "2026-07-12 10:00:00",
    }),
    {
      week: "2026-W28",
      cluster_id: "cluster-1",
      query: "где лечить рак",
      engine: "yandex_gen_search",
      region: "225",
      language: "ru",
      device: "desktop",
      mentioned: true,
      mention_count: 2,
      citation_count: 1,
      cited_urls: ["https://zaruku.ru/map/"],
      checked_at: "2026-07-12 10:00:00",
    },
  );
});

test("loadZarukuAiVisibilityData is unavailable when the table is missing", async () => {
  const data = await loadZarukuAiVisibilityData(["66624469"], ["2026-W28"], async () => {
    throw new Error("Table 'seo_ai_visibility_weekly' doesn't exist");
  });

  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.rows, []);
  assert.match(data.error ?? "", /doesn't exist/);
});
