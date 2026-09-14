import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCapturePlan,
  buildCaptureUrl,
  calculatePixelDifference,
  createPrivateCandidateDirectory,
  inspectPngDimensions,
  passesVisualThreshold,
  runOwnedBrowserTask,
  validateCaptureLocations,
} from "./capture-abbott-runtime.mjs";

test("capture plan always includes five desktop tabs and one CSS 390x844 mobile capture", () => {
  assert.deepEqual(buildCapturePlan([
    "users_summary",
    "user_actions",
    "page_stats",
    "returning",
    "general_materials",
  ]), [
    { filename: "01-users-summary-desktop.png", tab: "users_summary", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "02-user-actions-desktop.png", tab: "user_actions", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "03-page-stats-desktop.png", tab: "page_stats", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "04-returning-desktop.png", tab: "returning", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "05-general-materials-desktop.png", tab: "general_materials", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "06-users-summary-mobile.png", tab: "users_summary", viewport: { width: 390, height: 844, deviceScaleFactor: 2 } },
  ]);
});

test("capture URL contains only the fixed period and never authorization", () => {
  const url = buildCaptureUrl("http://127.0.0.1:3004");
  assert.equal(url.href, "http://127.0.0.1:3004/dashboard/18?from=2026-09-01&to=2026-09-13");
  assert.doesNotMatch(url.href, /token|cookie|embed/i);
});

test("capture plan adds only conditional tabs that are truthfully visible", () => {
  const plan = buildCapturePlan([
    "users_summary",
    "user_actions",
    "page_stats",
    "returning",
    "general_materials",
    "session_journeys",
    "time_buckets",
  ]);

  assert.deepEqual(plan.slice(6), [
    { filename: "07-session-journeys-desktop.png", tab: "session_journeys", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
    { filename: "08-time-buckets-desktop.png", tab: "time_buckets", viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 } },
  ]);
});

test("owned browser closes on success and failure", async () => {
  let closes = 0;
  const launch = async () => ({ close: async () => { closes += 1; } });

  assert.equal(await runOwnedBrowserTask(launch, async () => "ok"), "ok");
  await assert.rejects(runOwnedBrowserTask(launch, async () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(closes, 2);
});

test("candidate directory is private and locations outside Git are enforced", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-capture-test-"));
  const baseline = path.join(parent, "baseline");
  const outputParent = path.join(parent, "candidates");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(baseline, { mode: 0o700 }),
    mkdir(outputParent, { mode: 0o700 }),
  ]));
  await Promise.all([
    "01-users-summary-desktop.png",
    "02-user-actions-desktop.png",
    "03-page-stats-desktop.png",
    "04-returning-desktop.png",
    "05-general-materials-desktop.png",
    "06-users-summary-mobile.png",
  ].map((filename) => writeFile(path.join(baseline, filename), "fixture")));

  await validateCaptureLocations({ baseline, outputParent, repositoryRoot: process.cwd() });
  const candidate = await createPrivateCandidateDirectory(outputParent);
  assert.equal((await stat(candidate)).mode & 0o777, 0o700);
  await assert.rejects(
    validateCaptureLocations({ baseline, outputParent: path.join(process.cwd(), "output"), repositoryRoot: process.cwd() }),
    /outside Git/,
  );
});

test("PNG dimension inspection uses the image header without decoding private pixels", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
  png.writeUInt32BE(1440, 16);
  png.writeUInt32BE(1000, 20);

  assert.deepEqual(inspectPngDimensions(png), { width: 1440, height: 1000 });
  assert.throws(() => inspectPngDimensions(Buffer.from("not-png")), /Invalid PNG/);
});

test("pixel comparison returns only aggregate redacted metrics", () => {
  const result = calculatePixelDifference(
    Buffer.from([0, 0, 0, 255, 10, 10, 10, 255]),
    Buffer.from([0, 0, 0, 255, 20, 10, 0, 255]),
    4,
  );

  assert.deepEqual(result, {
    changed_pixel_ratio: 0.5,
    mean_absolute_error: 0.009804,
  });
});

test("visual gate requires equal dimensions and bounded aggregate pixel differences", () => {
  assert.equal(passesVisualThreshold({
    dimensions_match: true,
    pixel_metrics: { changed_pixel_ratio: 0.02, mean_absolute_error: 0.005 },
  }), true);
  assert.equal(passesVisualThreshold({
    dimensions_match: true,
    pixel_metrics: { changed_pixel_ratio: 0.020001, mean_absolute_error: 0.005 },
  }), false);
  assert.equal(passesVisualThreshold({ dimensions_match: false, pixel_metrics: null }), false);
});
