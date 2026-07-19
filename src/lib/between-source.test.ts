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
