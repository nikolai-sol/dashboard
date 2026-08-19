import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildCampaignOptions,
  selectedAccountIds,
  retainBindingsForRowSources,
} from "./WizardStepBinding";

test("same campaign number from two accounts remains two choices", () => {
  const labels = buildCampaignOptions([
    {
      canonical_campaign_id: 501,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet A",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
      display_label: "OLV Serials · 24932 · Cabinet A",
    },
    {
      canonical_campaign_id: 502,
      source_key: "between",
      platform_account_id: "2224",
      account_name: "Cabinet B",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
      display_label: "OLV Serials · 24932 · Cabinet B",
    },
  ]).map((item) => item.label);

  assert.deepEqual(labels, [
    "OLV Serials · 24932 · Cabinet A",
    "OLV Serials · 24932 · Cabinet B",
  ]);
});

test("campaign choices are keyed by canonical identity", () => {
  const options = buildCampaignOptions([
    {
      canonical_campaign_id: 501,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet A",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
      display_label: "OLV Serials · 24932 · Cabinet A",
    },
  ]);

  assert.equal(options[0].value, 501);
});

test("catalog refresh never sanitizes saved bindings by activity", () => {
  const source = readFileSync(path.resolve("src/components/admin/WizardStepBinding.tsx"), "utf8");
  assert.doesNotMatch(source, /sanitizedBindings|validManualBindingIds/);
  assert.match(source, /нет опубликованных и проверенных кампаний/);
  assert.match(source, /не выбраны аккаунты рекламных платформ/);
});

test("account selection accepts both list and singular canonical source config", () => {
  assert.deepEqual(selectedAccountIds({ account_ids: ["1113", " 2224 "] }), ["1113", "2224"]);
  assert.deepEqual(selectedAccountIds({ platform_account_id: "gidrofuril-search" }), ["gidrofuril-search"]);
});

test("removing a row platform removes only bindings for that row and platform", () => {
  const bindings = [
    { line_key: "line-a", channel: "A", canonical_campaign_id: 1, source_key: "between", platform_account_id: "a", platform_campaign_id: "1", effective_from: null, effective_to: null },
    { line_key: "line-a", channel: "A", canonical_campaign_id: 2, source_key: "hybrid", platform_account_id: "b", platform_campaign_id: "2", effective_from: null, effective_to: null },
    { line_key: "line-b", channel: "B", canonical_campaign_id: 3, source_key: "between", platform_account_id: "a", platform_campaign_id: "3", effective_from: null, effective_to: null },
  ];

  assert.deepEqual(
    retainBindingsForRowSources(bindings, "line-a", ["hybrid"]),
    [bindings[1], bindings[2]],
  );
});
