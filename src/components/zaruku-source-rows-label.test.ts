import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuSeoData } from "@/lib/types";
import { getZarukuSourceRowsLabel } from "./zaruku-source-rows-label";

function aliceData({
  aliceStatus,
  dataThrough,
}: {
  aliceStatus: "partial" | "unavailable";
  dataThrough: string;
}): ZarukuSeoData {
  return {
    sources: [{
      id: "yandex_gen_search",
      label: "AI-видимость",
      layer: "ai",
      color: "#000000",
      status: aliceStatus === "unavailable" ? "connected" : aliceStatus,
      collection_mode: "manual",
      data_through: dataThrough,
      note: "",
    }],
    source_freshness: [],
    alice_visibility: {
      status: aliceStatus,
      latestMonth: aliceStatus === "unavailable" ? null : "2026-08",
      snapshots: [],
      latest: null,
      queries: [],
      sources: [],
      featured: [],
    },
    seo_intelligence: {
      status: "available",
      sov: { rows: [], latest_week: null },
      ai: {
        rows: [{
          engine: "alisa_ai",
          period: "2026-07",
          mentions: 89,
          citations: 155,
          presence_rate: 44,
          provenance: "legacy",
          captured_at: "2026-07-13 14:30:00",
          ingestion_run_id: "legacy-2026-07",
        }],
        latest_period: "2026-07",
      },
    },
  } as unknown as ZarukuSeoData;
}

test("canonical August Alice source freshness wins over July legacy rows", () => {
  assert.equal(
    getZarukuSourceRowsLabel(aliceData({ aliceStatus: "partial", dataThrough: "2026-08" }), "yandex_gen_search"),
    "посл. дата: 01.08.2026",
  );
});

test("legacy Alice capture date remains visible only for the unavailable fallback", () => {
  assert.equal(
    getZarukuSourceRowsLabel(aliceData({ aliceStatus: "unavailable", dataThrough: "2026-07-13 14:30:00" }), "yandex_gen_search"),
    "посл. дата: 13.07.2026",
  );
});
