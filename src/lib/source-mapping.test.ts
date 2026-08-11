import assert from "node:assert/strict";
import test from "node:test";
import { resolveSourceKey } from "@/lib/source-mapping";

test("resolveSourceKey supports vk aliases", () => {
  assert.equal(resolveSourceKey("vk"), "vk_ads_v2");
  assert.equal(resolveSourceKey("ВК"), "vk_ads_v2");
  assert.equal(resolveSourceKey("вк"), "vk_ads_v2");
  assert.equal(resolveSourceKey("вконтакте"), "vk_ads_v2");
  assert.equal(resolveSourceKey("VK ADS"), "vk_ads_v2");
});

test("resolveSourceKey keeps unknown values unchanged", () => {
  assert.equal(resolveSourceKey("reddit"), "reddit");
  assert.equal(resolveSourceKey("unknown_platform"), "unknown_platform");
});
