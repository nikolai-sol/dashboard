import assert from "node:assert/strict";
import test from "node:test";
import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { dashboardTabs } from "../src/components/Dashboard.tsx";
import { sourceStatusLabel } from "../src/components/Sources.tsx";

const profile = {
  sources: [
    { sourceKey: "yandex_metrika", mode: "automated", bindingId: "fixture", importCadence: [] },
    { sourceKey: "google_search_console", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "yandex_wordstat", mode: "disabled", bindingId: null, importCadence: [] },
    { sourceKey: "yandex_webmaster_alice_manual", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "seo_os", mode: "automated", bindingId: "fixture", importCadence: [] },
  ],
} as SiteProfile;

test("hides disabled adapters while preserving the available source sections", () => {
  const labels = dashboardTabs(profile).map((tab) => tab.label);
  assert.ok(labels.includes("Обзор"));
  assert.ok(labels.includes("Поиск и индексация"));
  assert.ok(labels.includes("AI-видимость и конкуренты"));
  assert.ok(labels.includes("SEO OS"));
  assert.ok(!labels.includes("Wordstat"));
});

test("labels manual data with its actual loaded period rather than calling it current", () => {
  assert.match(sourceStatusLabel({ sourceKey: "google_search_console", period: { kind: "calendar_month", key: "2026-01", from: "2026-01-01", to: "2026-01-31", sourceTimezone: "Europe/Moscow" }, state: "ready", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: "2026-02-01T00:00:00Z", freshness: "delayed", latestAttempt: "success" }), /2026-01-01/);
});
