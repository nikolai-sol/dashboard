import assert from "node:assert/strict";
import test from "node:test";

import type {
  TargetIntentObservedQuery,
  TargetIntentRule,
  TargetIntentRuleSet,
} from "@reportingdash/site-seo-contract";
import {
  buildTargetIntentView,
  classifyTargetIntentQuery,
  normalizeIntentKey,
} from "./target-intent.ts";

const rule = (
  key: string,
  group: string | null,
  matchType: TargetIntentRule["matchType"],
): TargetIntentRule => ({
  key,
  normalizedKey: normalizeIntentKey(key),
  group,
  matchType,
});

const rules = [
  rule("Рак лёгкого", "Онкология", "exact"),
  rule("таргетная терапия", "Лечение", "phrase"),
  rule("меланома", "Онкология", "exact"),
  rule("онколог", "Специалисты", "phrase"),
] as const;

const ruleSet = (
  overrides: Partial<TargetIntentRuleSet> = {},
): TargetIntentRuleSet => ({
  siteId: "medroche",
  dashboardId: 71,
  versionId: "intent-version-1",
  label: "Мед. интент",
  state: "ready",
  rules,
  provenance: {
    importId: "intent-import-1",
    publicationId: "intent-publication-1",
    sourceTransport: "upload",
    sourceIdentity: "medical-intent.csv",
    contentSha256: "a".repeat(64),
    publishedAt: "2026-09-15T09:00:00.000Z",
    publishedBy: "admin@example.test",
    comment: null,
  },
  ...overrides,
});

test("normalization applies NFKC, case folding, yo and punctuation boundaries", () => {
  assert.equal(
    normalizeIntentKey("  ＨＥＲ－２—ТЕРАПИЯ, ЁЖ  "),
    "her 2 терапия еж",
  );
  assert.equal(normalizeIntentKey("рак___лёгкого"), "рак легкого");
});

test("exact and phrase rules use whole normalized tokens", () => {
  assert.deepEqual(classifyTargetIntentQuery("РАК-ЛЁГКОГО", rules), {
    category: "target",
    group: "Онкология",
    matchedRule: "Рак лёгкого",
    matchType: "exact",
  });
  assert.equal(
    classifyTargetIntentQuery("диагностика рака лёгкого", rules).category,
    "other",
  );
  assert.deepEqual(
    classifyTargetIntentQuery(
      "новая таргетная-терапия при заболевании",
      rules,
    ),
    {
      category: "target",
      group: "Лечение",
      matchedRule: "таргетная терапия",
      matchType: "phrase",
    },
  );
  assert.equal(
    classifyTargetIntentQuery("нетаргетная терапия", rules).category,
    "other",
  );
});

test("classification does not add fuzzy matches or language stemming", () => {
  for (const query of ["меланомы", "меланомма", "приём онколога"]) {
    assert.equal(
      classifyTargetIntentQuery(query, rules).category,
      "other",
      query,
    );
  }
});

test("overlapping phrase matches are independent of source row order", () => {
  const broad = rule("терапия", "Общее", "phrase");
  const specific = rule("таргетная терапия", "Специальное", "phrase");
  const left = classifyTargetIntentQuery("новая таргетная терапия", [
    broad,
    specific,
  ]);
  const right = classifyTargetIntentQuery("новая таргетная терапия", [
    specific,
    broad,
  ]);

  assert.deepEqual(left, right);
  assert.equal(left.matchedRule, "таргетная терапия");
});

test("equal-length phrase ties use stable normalized-key ordering", () => {
  const alpha = rule("alpha beta", "A", "phrase");
  const beta = rule("beta gamma", "B", "phrase");
  const classification = classifyTargetIntentQuery("alpha beta gamma", [
    beta,
    alpha,
  ]);

  assert.equal(classification.matchedRule, "alpha beta");
  assert.equal(classification.group, "A");
});

test("an absent active catalogue is not configured rather than all other", () => {
  const result = buildTargetIntentView({
    siteId: "medroche",
    dashboardId: 71,
    label: "Мед. интент",
    ruleSet: null,
    queries: [
      { query: "погода", source: "google", impressions: 100, clicks: 2 },
    ],
  });

  assert.equal(result.state, "not_configured");
  assert.deepEqual(result.target, {
    label: "Мед. интент",
    impressions: null,
    clicks: null,
    sharePct: null,
    queryCount: null,
  });
  assert.equal(result.other.impressions, null);
  assert.deepEqual(result.queries, []);
});

test("invalid rule-set integrity fails closed", () => {
  const result = buildTargetIntentView({
    siteId: "medroche",
    dashboardId: 71,
    label: "Мед. интент",
    ruleSet: ruleSet({
      rules: [
        { ...rules[0], normalizedKey: "wrong" },
        rules[1],
      ],
    }),
    queries: [
      { query: "погода", source: "google", impressions: 100, clicks: 2 },
    ],
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.versionId, "intent-version-1");
  assert.equal(result.target.impressions, null);
  assert.equal(result.other.impressions, null);
  assert.deepEqual(result.queries, []);
});

test("totals and shares are impression-weighted over positive-impression rows", () => {
  const queries: readonly TargetIntentObservedQuery[] = [
    {
      query: "таргетная терапия",
      source: "google",
      impressions: 90,
      clicks: 9,
    },
    { query: "погода", source: "google", impressions: 10, clicks: 1 },
    {
      query: "Рак-лёгкого",
      source: "yandex",
      impressions: 20,
      clicks: 4,
    },
    { query: "рецепт", source: "yandex", impressions: 80, clicks: 2 },
    { query: "меланома", source: "google", impressions: 0, clicks: 1 },
  ];
  const result = buildTargetIntentView({
    siteId: "medroche",
    dashboardId: 71,
    label: "Ignored profile label",
    ruleSet: ruleSet(),
    queries,
  });

  assert.equal(result.state, "ready");
  assert.deepEqual(result.target, {
    label: "Мед. интент",
    impressions: 110,
    clicks: 13,
    sharePct: 55,
    queryCount: 2,
  });
  assert.deepEqual(result.other, {
    label: "Остальные запросы",
    impressions: 90,
    clicks: 3,
    sharePct: 45,
    queryCount: 2,
  });
  assert.deepEqual(
    result.queries.map(({ query, source }) => [query, source]),
    [
      ["таргетная терапия", "google"],
      ["рецепт", "yandex"],
      ["Рак-лёгкого", "yandex"],
      ["погода", "google"],
    ],
  );
});

test("query ordering is deterministic after metric ties", () => {
  const result = buildTargetIntentView({
    siteId: "medroche",
    dashboardId: 71,
    label: "Мед. интент",
    ruleSet: ruleSet(),
    queries: [
      { query: "zeta", source: "yandex", impressions: 10, clicks: 1 },
      { query: "alpha", source: "yandex", impressions: 10, clicks: 1 },
      { query: "alpha", source: "google", impressions: 10, clicks: 1 },
      { query: "higher clicks", source: "google", impressions: 10, clicks: 2 },
    ],
  });

  assert.deepEqual(
    result.queries.map(({ query, source }) => [query, source]),
    [
      ["higher clicks", "google"],
      ["alpha", "google"],
      ["alpha", "yandex"],
      ["zeta", "yandex"],
    ],
  );
});
