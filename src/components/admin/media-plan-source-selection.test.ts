import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveMediaPlanRowSourceKeys,
  toggleMediaPlanRowSourceKey,
} from "@/components/admin/media-plan-source-selection";

const available = ["hybrid", "vk_ads_v2", "yandex_direct"];

test("resolveMediaPlanRowSourceKeys uses saved source_keys before the imported platform text", () => {
  assert.deepEqual(
    resolveMediaPlanRowSourceKeys(
      { instrument: "hybrid/between", source_keys: ["hybrid", "vk_ads_v2"] },
      available,
    ),
    ["hybrid", "vk_ads_v2"],
  );
});

test("resolveMediaPlanRowSourceKeys returns no sources for an unknown platform until the user chooses them", () => {
  assert.deepEqual(resolveMediaPlanRowSourceKeys({ instrument: "hybrid/between" }, available), []);
});

test("resolveMediaPlanRowSourceKeys falls back to the imported platform when it matches a source", () => {
  assert.deepEqual(resolveMediaPlanRowSourceKeys({ instrument: "ВК" }, available), ["vk_ads_v2"]);
  assert.deepEqual(resolveMediaPlanRowSourceKeys({ instrument: "hybrid" }, available), ["hybrid"]);
});

test("resolveMediaPlanRowSourceKeys treats all-platform rows as every available source", () => {
  assert.deepEqual(resolveMediaPlanRowSourceKeys({ instrument: "all" }, available), available);
  assert.deepEqual(resolveMediaPlanRowSourceKeys({ instrument: "" }, available), available);
});

test("toggleMediaPlanRowSourceKey adds and removes source keys without duplicates", () => {
  assert.deepEqual(toggleMediaPlanRowSourceKey(["hybrid"], "vk_ads_v2", true, available), [
    "hybrid",
    "vk_ads_v2",
  ]);
  assert.deepEqual(toggleMediaPlanRowSourceKey(["hybrid", "vk_ads_v2"], "hybrid", false, available), [
    "vk_ads_v2",
  ]);
  assert.deepEqual(toggleMediaPlanRowSourceKey(["hybrid"], "hybrid", true, available), ["hybrid"]);
  assert.deepEqual(toggleMediaPlanRowSourceKey(["hybrid"], "meta", true, available), ["hybrid"]);
});
