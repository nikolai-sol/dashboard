import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatPrivateServerTiming } from "@/lib/dashboard-data-loader";

const routeSource = readFileSync(
  new URL("../app/api/dashboard/[id]/route.ts", import.meta.url),
  "utf8",
);

test("formats only the allowlisted Zaruku phase names and numeric durations", () => {
  const header = formatPrivateServerTiming({
    "metrika-db": 12.345,
    "gsc-db": 4,
    "webmaster-db": 5.5,
    "seo-db": 6,
    total: 20,
    // Runtime input is deliberately wider than the TypeScript contract.
    "SELECT secret FROM credentials": 999,
  } as never);

  assert.equal(
    header,
    "metrika-db;dur=12.3, gsc-db;dur=4.0, webmaster-db;dur=5.5, seo-db;dur=6.0, total;dur=20.0",
  );
  assert.doesNotMatch(header, /SELECT|secret|credentials/);
});

test("dashboard route preserves private no-store while adding safe Server-Timing", () => {
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /"Server-Timing"/);
  assert.match(routeSource, /formatPrivateServerTiming/);
  assert.match(
    readFileSync(new URL("./dashboard-data-loader.ts", import.meta.url), "utf8"),
    /SAFE_SERVER_TIMING_NAMES\s*=\s*\[\s*"metrika-db",\s*"gsc-db",\s*"webmaster-db",\s*"seo-db",\s*"total",\s*\]/,
  );
});
