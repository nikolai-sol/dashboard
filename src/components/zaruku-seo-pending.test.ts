import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPendingRequirementSources } from "@/components/zaruku-seo-pending";
import type { ZarukuSeoData } from "@/lib/types";

type PendingInput = Pick<ZarukuSeoData, "pending_requirements" | "sources">;

test("formats only currently pending SEO sources", () => {
  const data: PendingInput = {
    sources: [
      { id: "gsc", label: "Search Console", layer: "serp", status: "pending", color: "#000000" },
      { id: "webmaster", label: "Яндекс Вебмастер", layer: "serp", status: "connected", color: "#000000" },
      { id: "dataforseo", label: "DataForSEO", layer: "ai", status: "pending", color: "#000000" },
    ],
    pending_requirements: [
      {
        source: "gsc",
        layer: "serp",
        title: "Google Search Console",
        status: "pending",
        reason: "Google SERP layer is not connected yet.",
        expected_fields: ["query"],
      },
      {
        source: "dataforseo",
        layer: "ai",
        title: "DataForSEO / AI visibility",
        status: "pending",
        reason: "External AI visibility source is not connected yet.",
        expected_fields: ["prompt"],
      },
    ],
  };

  assert.equal(formatPendingRequirementSources(data), "Search Console · DataForSEO");
});

test("reports complete pending coverage when nothing is pending", () => {
  const data: PendingInput = {
    sources: [
      { id: "webmaster", label: "Яндекс Вебмастер", layer: "serp", status: "connected", color: "#000000" },
    ],
    pending_requirements: [],
  };

  assert.equal(formatPendingRequirementSources(data), "Все источники подключены");
});
