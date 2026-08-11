import assert from "node:assert/strict";
import test from "node:test";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";

test("between is registered as a canonical ads source", () => {
  assert.deepEqual(getSchemaMetaByPlatform("between"), {
    id: "between",
    display_name: "Between",
    source: "mysql",
    schema_file: "schemas/between.yaml",
    source_key: "between",
    source_type: "ads",
    canonical_table: "canonical_fact_ads_daily",
  });
});

test("getSchemaMetaByPlatform resolves by source key", () => {
  assert.equal(getSchemaMetaByPlatform("vk_ads_v2")?.id, "vk");
  assert.equal(getSchemaMetaByPlatform("vk_ads_v2")?.source_key, "vk_ads_v2");
  assert.equal(getSchemaMetaByPlatform("yandex_direct")?.id, "yandex");
  assert.equal(getSchemaMetaByPlatform("yandex_direct")?.source_key, "yandex_direct");
});
