import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./abbott-bi.ts", import.meta.url), "utf8");

test("Abbott manager read model builds period-local frequency from canonical private visits", () => {
  assert.match(source, /import \{ buildAbbottReturnFrequency/);
  assert.match(source, /return_frequency:[\s\S]{0,120}buildAbbottReturnFrequency/);
  assert.match(source, /SELECT visit_id_hash, session_started_at, utm_source,/);
  assert.match(source, /canonical_fact_metrika_visits/);
  assert.doesNotMatch(source, /api-metrika\.yandex|METRIKA_TOKEN/);
});

test("existing Reports API recency builder remains a separate control model", () => {
  assert.match(source, /function buildReturning\(/);
  assert.match(source, /returning:\s*buildReturning\(/);
});
