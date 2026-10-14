import test from "node:test";
import assert from "node:assert/strict";
import { abbottTrafficSourceLabel, abbottTrafficSourceOption } from "./abbott-localization";

test("localizes known Abbott traffic sources for display", () => {
  assert.equal(abbottTrafficSourceLabel("Direct traffic"), "Прямые заходы");
  assert.equal(abbottTrafficSourceLabel("Link traffic"), "Переходы по ссылкам");
  assert.equal(abbottTrafficSourceLabel("Search engine traffic"), "Переходы из поисковых систем");
  assert.equal(abbottTrafficSourceLabel("Internal traffic"), "Внутренние переходы");
  assert.equal(abbottTrafficSourceLabel("Unknown traffic"), "Неизвестный источник");
  assert.equal(abbottTrafficSourceLabel("Registered portal behavior"), "Зарегистрированное поведение на портале");
});

test("keeps custom source labels unchanged", () => {
  assert.equal(abbottTrafficSourceLabel("Custom CRM / SEO traffic"), "Custom CRM / SEO traffic");
});

test("uses the unknown label only for blank and known unknown sources", () => {
  assert.equal(abbottTrafficSourceLabel(""), "Неизвестный источник");
  assert.equal(abbottTrafficSourceLabel("   "), "Неизвестный источник");
  assert.equal(abbottTrafficSourceLabel("Unknown traffic"), "Неизвестный источник");
});

test("localizes only the option label and preserves the raw value", () => {
  assert.deepEqual(abbottTrafficSourceOption("Search engine traffic"), {
    value: "Search engine traffic",
    label: "Переходы из поисковых систем",
  });
});
