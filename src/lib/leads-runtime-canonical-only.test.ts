import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateConfirmedLeadsByPlatform,
  getConfirmedLeadRowsFromStoredSnapshot,
} from "@/lib/leads-fetcher";

test("runtime leads read only the confirmed snapshot stored in MySQL config", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("runtime must not fetch the source sheet");
  };

  try {
    const sourceConfig = {
      sheet_url: "https://docs.google.com/spreadsheets/d/external/edit",
      inline_rows: [
        { date: "2026-08-18", platform: "vk", channel: "Search", leads: 3 },
      ],
      review: {
        status: "confirmed",
        platform_bindings: { vk: "vk" },
      },
    };

    assert.deepEqual(getConfirmedLeadRowsFromStoredSnapshot(sourceConfig), [
      {
        date: "2026-08-18",
        platform: "vk",
        channel: "Search",
        source: "",
        leads: 3,
        qualified_leads: 0,
        revenue: 0,
        notes: "",
      },
    ]);
    assert.deepEqual(
      await aggregateConfirmedLeadsByPlatform(sourceConfig, ["vk"], "2026-08-01", "2026-08-31"),
      { vk: 3 },
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy confirmed lead source without a stored snapshot does not fetch externally", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("runtime must not fetch the source sheet");
  };

  try {
    const sourceConfig = {
      sheet_url: "https://docs.google.com/spreadsheets/d/external/edit",
      review: { status: "confirmed", platform_bindings: { vk: "vk" } },
    };
    assert.deepEqual(getConfirmedLeadRowsFromStoredSnapshot(sourceConfig), []);
    assert.deepEqual(
      await aggregateConfirmedLeadsByPlatform(sourceConfig, ["vk"], "2026-08-01", "2026-08-31"),
      {},
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
