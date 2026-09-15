import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import { buildMedicalIntent, classifyMedicalQuery, MEDICAL_INTENT_VERSION } from "./medical-intent.ts";
import seed from "./rules/medroche-intent-core.json";

const period: Period = { kind: "iso_week", key: "2026-W37", from: "2026-09-07", to: "2026-09-13", sourceTimezone: "Europe/Moscow" };
const meta = (overrides: Partial<DatasetMeta> = {}): DatasetMeta => ({
  sourceKey: "google_search_console", period, state: "partial", collectionMode: "manual",
  completeness: "limited", importId: "test", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success", ...overrides,
});
const metrics = (impressions: number, clicks: number) => ({ impressions, clicks, ctrPct: null, averagePosition: null });
const gsc = (source = meta(), rows = [{ value: "бевацизумаб", metrics: metrics(90, 9) }, { value: "погода", metrics: metrics(10, 1) }]) => ({
  meta: source, summary: metrics(999999, 99999), daily: [], dimensionMeta: { query: source },
  dimensions: rows.map(row => ({ ...row, dimension: "query" as const })),
});
const webmaster = (source = meta({ sourceKey: "yandex_webmaster" })) => ({
  ...source, kind: "webmaster" as const, summary: metrics(99999, 9999), daily: [], topPages: [],
  queryFacts: [{ query: "лечение меланомы", metrics: metrics(10, 2) }, { query: "рецепт торта", metrics: metrics(90, 3) }],
});

test("preserves the complete expert seed and explains every exact match", () => {
  assert.equal(seed.queries.length, 802);
  assert.equal(new Set(seed.queries.map(row => row.group)).size, 89);
  assert.match(seed.sourceSha256, /^[a-f0-9]{64}$/);
  for (const row of seed.queries) {
    const actual = classifyMedicalQuery(row.query);
    assert.equal(actual.category, "medical", row.query);
    assert.equal(actual.group, row.group);
    assert.equal(actual.reason, "expert_seed");
  }
});

test("extends medical inflections, drugs, abbreviations and treatment context", () => {
  for (const query of [
    "БЕВАЦИЗУМАБ: инструкция", "эффективность бевацизумаба при опухолях",
    "bevacizumab clinical trial", "лечение рассеянного склероза", "терапия рака легких",
    "диабетического макулярного отёка", "HER-2 положительная опухоль", "BRAF V600E",
    "метастазы в печени", "рак 3 стадии", "раком молочной железы", "TNM pT2N0M0",
    "трастузумабом", "АЛЕКТИНИБА", "рецепт на энтректиниб", "авaстин бевацизумаб",
    "эндотелиального фактора роста", "мышечной атрофии", "лечение ДВККЛ",
    "нейрофиброматоза", "химиотерапия", "онкологическая конференция", "симптомы гриппа",
  ]) assert.equal(classifyMedicalQuery(query).category, "medical", query);
});

test("does not expand generic seed group names or unrelated word fragments", () => {
  for (const query of ["погода", "форум", "статьи", "исследование рынка", "конференция разработчиков",
    "разработки", "ракета", "краска", "раковина", "гороскоп рак", "знак зодиака рак",
    "как варить раков", "рецепт рака с укропом", "сма разъем", "ros1 robot", "her2 файл"]) {
    assert.equal(classifyMedicalQuery(query).category, "noise", query);
  }
});

test("expert queries remain medical inside longer searches and legitimate medical document/recipe context", () => {
  for (const row of seed.queries) {
    assert.equal(classifyMedicalQuery("что такое " + row.query).category, "medical", row.query);
  }
  for (const query of ["таргетная терапия побочные эффекты", "гематология учебник онлайн", "лечение влажной вмд",
    "HER-2 положительный статус", "рецепт при раке молочной железы", "классификация t1n0m0 в файле pdf",
    "экспрессия рецептора her2", "лечение окклюзии центральной вены сетчатки"]) {
    assert.equal(classifyMedicalQuery(query).category, "medical", query);
  }
});

test("preserves failed source metadata without requiring a fact payload", () => {
  const result = buildMedicalIntent({
    period, gsc: { ...gsc(), meta: meta({ state: "failed" }), dimensionMeta: {}, dimensions: [] },
    webmaster: null, webmasterMeta: meta({ sourceKey: "yandex_webmaster", state: "failed" }),
  });
  assert.deepEqual(result.sources.map(source => source.reason), ["failed", "failed"]);
  assert.equal(result.medical.impressions, null);
});

test("nonmedical exclusions use words and specific context, not fragments of medical vocabulary", () => {
  for (const query of ["рак нарушение пищеварения", "рак роботизированная хирургия"]) {
    assert.equal(classifyMedicalQuery(query).category, "medical", query);
  }
  for (const query of ["рецепт рака в пиве", "вареные раки рецепт", "ros1 робот", "сма разъем"]) {
    assert.equal(classifyMedicalQuery(query).category, "noise", query);
  }
});

test("shares are weighted by available query impressions, not rows, clicks or property totals", () => {
  const result = buildMedicalIntent({ period, gsc: gsc(), webmaster: webmaster() });
  assert.equal(result.version, MEDICAL_INTENT_VERSION);
  assert.deepEqual(result.medical, { impressions: 100, clicks: 11, sharePct: 50 });
  assert.deepEqual(result.noise, { impressions: 100, clicks: 4, sharePct: 50 });
  assert.equal(result.sources.length, 2);
  assert.equal(result.queries.length, 4);
});

test("rejects monthly, failed and missing data without silently creating noise", () => {
  const monthly = meta({ period: { ...period, kind: "calendar_month", key: "2026-09", from: "2026-09-01", to: "2026-09-30" } });
  const result = buildMedicalIntent({ period, gsc: gsc(monthly), webmaster: webmaster() });
  assert.equal(result.medical.sharePct, 10);
  assert.equal(result.sources[0].included, false);
  assert.equal(result.sources[0].reason, "different_period");
  const failed = buildMedicalIntent({ period, gsc: gsc(meta({ state: "failed" })), webmaster: null });
  assert.equal(failed.medical.sharePct, null);
  assert.equal(failed.noise.impressions, null);
  assert.equal(failed.sources.some(source => source.included), false);
});

test("only confirmed empty coverage is a known zero; undefined query rows are unavailable", () => {
  const empty = buildMedicalIntent({ period, gsc: gsc(meta({ state: "complete_empty", completeness: "complete" }), []), webmaster: null });
  assert.deepEqual(empty.medical, { impressions: 0, clicks: 0, sharePct: null });
  assert.equal(empty.sources[0].included, true);
  const unavailable = buildMedicalIntent({ period, gsc: gsc(meta(), []), webmaster: { ...webmaster(), queryFacts: undefined } });
  assert.equal(unavailable.noise.impressions, null);
  assert.equal(unavailable.sources.some(source => source.included), false);
});

test("zero impression data has no percentage, keeps clicks and rejects invalid metrics", () => {
  const zero = buildMedicalIntent({ period, gsc: gsc(meta(), [{ value: "бевацизумаб", metrics: metrics(0, 2) }]), webmaster: null });
  assert.equal(zero.medical.sharePct, null);
  assert.equal(zero.medical.clicks, 2);
  const invalid = buildMedicalIntent({ period, gsc: gsc(meta(), [{ value: "погода", metrics: metrics(-1, 0) }]), webmaster: null });
  assert.equal(invalid.noise.impressions, null);
  assert.equal(invalid.sources[0].reason, "invalid_metrics");
});
