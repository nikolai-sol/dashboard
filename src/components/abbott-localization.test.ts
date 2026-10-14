import test from "node:test";
import assert from "node:assert/strict";
import { abbottTrafficSourceLabel, abbottTrafficSourceOption } from "./abbott-localization";

test("preserves every native Metrica source label and code", () => {
  for (const value of ["direct", "Direct traffic", "ad", "Ad traffic", "internal", "Internal traffic",
    "Unknown traffic", "undefined", "messenger", "Custom CRM / SEO traffic", "Прямые заходы"]) {
    assert.equal(abbottTrafficSourceLabel(value), value);
    assert.deepEqual(abbottTrafficSourceOption(value), { value, label: value });
  }
});

test("does not invent a source label for an empty value", () => {
  assert.equal(abbottTrafficSourceLabel(""), "");
});
