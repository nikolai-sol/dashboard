import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as parityTool from "./compare-abbott-runtime.mjs";
import * as captureTool from "./capture-abbott-runtime.mjs";
import { formatSafeCliFailure } from "./compare-abbott-runtime.mjs";

import {
  buildCapturePlan,
  buildCaptureDimensions,
  buildCaptureUrl,
  calculatePixelDifference,
  closeOwnedBrowser,
  createPrivateCandidateDirectory,
  inspectPngDimensions,
  passesVisualThreshold,
  runCaptureLifecycle,
  validateCaptureLocations,
} from "./capture-abbott-runtime.mjs";

function captureTokenFixture(overrides = {}) {
  return `${Buffer.from(JSON.stringify({ type: "viewer", dashboard_id: 18, audience: "manager", credential_version: 1, exp: Math.floor(Date.now() / 1000) + 600, ...overrides })).toString("base64url")}.${"a".repeat(43)}`;
}

test("token capture blocks redirects and off-origin requests before credentials can escape", async () => {
  assert.equal(typeof captureTool.guardCaptureRequests, "function");
  for (const [url, redirects, allowed] of [["http://127.0.0.1:3004/dashboard/18", [], true], ["https://example.invalid/", [], false], ["http://127.0.0.1:3001/", [], false], ["http://127.0.0.1:3004/dashboard/18", [{}], false]]) {
    let handler, intercepted = false, continued = 0, aborted = 0;
    const page = { setRequestInterception: async value => { intercepted = value; }, on: (event, callback) => { assert.equal(event, "request"); handler = callback; } };
    const guard = await captureTool.guardCaptureRequests(page, "http://127.0.0.1:3004");
    await handler({ url: () => url, redirectChain: () => redirects, continue: async () => { continued += 1; }, abort: async () => { aborted += 1; } });
    assert.equal(intercepted, true);
    assert.equal(continued, allowed ? 1 : 0);
    assert.equal(aborted, allowed ? 0 : 1);
    if (allowed) guard.assertSafe(); else assert.throws(() => guard.assertSafe(), /CAPTURE_REQUEST_BOUNDARY/);
  }
});

test("token capture authorizes both ports without login and cleans private output on expired server response", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "abbott-token-capture-"));
  const baseline = path.join(root, "baseline"), outputParent = path.join(root, "output");
  await mkdir(baseline, { mode: 0o700 }); await mkdir(outputParent, { mode: 0o700 });
  for (const item of buildCapturePlan(["users_summary", "user_actions", "page_stats", "returning", "general_materials"])) await writeFile(path.join(baseline, item.filename), "fixture");
  const token = captureTokenFixture(); let launches = 0; const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: String(url), options });
    return new URL(url).port === "3001" ? new Response(JSON.stringify({ user_ids: [] })) : new Response("expired", { status: 401 });
  });
  try {
    await assert.rejects(captureTool.captureAbbottRuntime({ loginBase: "http://127.0.0.1:3001", candidateBase: "http://127.0.0.1:3004", baseline, outputParent, managerAccessToken: token, launch: async () => { launches += 1; } }), error => !String(error).includes(token));
    assert.deepEqual(requests.map(r => new URL(r.url).port), ["3001", "3004"]);
    assert.ok(requests.every(r => r.options.method === "GET" && !r.url.includes(token)));
    assert.equal(launches, 0);
    assert.deepEqual(await readdir(outputParent), []);
  } finally { await rm(root, { recursive: true }); }
});

test("token browser failure closes the owned browser and removes output without token diagnostics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "abbott-token-cleanup-"));
  const baseline = path.join(root, "baseline"), outputParent = path.join(root, "output");
  await mkdir(baseline, { mode: 0o700 }); await mkdir(outputParent, { mode: 0o700 });
  for (const item of buildCapturePlan(["users_summary", "user_actions", "page_stats", "returning", "general_materials"])) await writeFile(path.join(baseline, item.filename), "fixture");
  const token = captureTokenFixture(); let closed = false, screenshot = false;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ user_ids: [] })));
  const page = {
    setRequestInterception: async () => undefined, on: () => undefined,
    setBypassServiceWorker: async () => undefined, setViewport: async () => undefined,
    setCookie: async cookie => { assert.equal(cookie.value, token); },
    goto: async () => { throw Error(token); },
    screenshot: async () => { screenshot = true; },
  };
  try {
    const error = await captureTool.captureAbbottRuntime({ loginBase: "http://127.0.0.1:3001", candidateBase: "http://127.0.0.1:3004", baseline, outputParent, managerAccessToken: token, launch: async () => ({ newPage: async () => page, close: async () => { closed = true; } }) }).catch(error => error);
    assert.equal(formatSafeCliFailure(error, "ABBOTT_CAPTURE"), "ABBOTT_CAPTURE_FAILED stage=CAPTURE_BROWSER_CAPTURE\n");
    assert.ok(!String(error).includes(token));
    assert.equal(closed, true);
    assert.equal(screenshot, false);
    assert.deepEqual(await readdir(outputParent), []);
  } finally { await rm(root, { recursive: true }); }
});

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
    { filename: "06-users-summary-mobile.png", tab: "users_summary", viewport: { width: 390, height: 844, deviceScaleFactor: 800 / 390 } },
  ]);
});

test("capture URL contains only the fixed period and never authorization", () => {
  const url = buildCaptureUrl("http://127.0.0.1:3004");
  assert.equal(url.href, "http://127.0.0.1:3004/dashboard/18?from=2026-09-01&to=2026-09-13");
  assert.doesNotMatch(url.href, /token|cookie|embed/i);
});

test("mobile capture records CSS 390x844 and preserved 800px raster width", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(7192, 20);
  assert.deepEqual(buildCaptureDimensions(
    { width: 390, height: 844, deviceScaleFactor: 800 / 390 },
    png,
  ), {
    css: { width: 390, height: 844 },
    pixels: { width: 800, height: 7192 },
  });
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

test("browser is marked closed only after successful bounded retry and exact PIDs exit", async () => {
  let closes = 0;
  let alive = true;
  const browser = {
    close: async () => {
      closes += 1;
      if (closes === 1) throw new Error("close fixture");
      alive = false;
    },
    process: () => ({ pid: 4242 }),
  };

  assert.deepEqual(await closeOwnedBrowser(browser, {
    isPidAlive: () => alive,
    pause: async () => undefined,
  }), { process_ids: [4242], exit_verified: true, close_attempts: 2, close_succeeded: true });
  assert.equal(closes, 2);
});

test("browser close failure uses only the captured PID for bounded termination", async () => {
  let alive = true;
  const terminations = [];
  const result = await closeOwnedBrowser({
    close: async () => { throw new Error("private close failure"); },
    process: () => ({ pid: 4343 }),
  }, {
    isPidAlive: () => alive,
    terminatePid: (pid, signal) => { terminations.push([pid, signal]); alive = false; },
    pause: async () => undefined,
  });

  assert.deepEqual(result, {
    process_ids: [4343],
    exit_verified: true,
    close_attempts: 2,
    close_succeeded: false,
  });
  assert.deepEqual(terminations, [[4343, "SIGTERM"]]);
});

test("never-settling browser close reaches the captured-PID fallback and settles", async () => {
  let alive = true;
  const terminations = [];
  const result = await Promise.race([
    closeOwnedBrowser({
      close: () => new Promise(() => undefined),
      process: () => ({ pid: 4444 }),
    }, {
      closeTimeoutMs: 5,
      isPidAlive: () => alive,
      terminatePid: (pid, signal) => { terminations.push([pid, signal]); alive = false; },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("close did not settle")), 200)),
  ]);

  assert.equal(result.close_succeeded, false);
  assert.equal(result.exit_verified, true);
  assert.deepEqual(terminations, [[4444, "SIGTERM"]]);
});

test("close and PID-fallback failure still removes partial capture output", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-close-cleanup-"));
  const output = path.join(parent, "candidate");
  let alive = true;
  const error = await runCaptureLifecycle({
    signalSource: new EventEmitter(),
    setExitCode: () => undefined,
    createOutput: async () => { await mkdir(output, { mode: 0o700 }); return output; },
    authorize: async () => "authorization-fixture",
    launch: async () => ({
      close: async () => { throw new Error("private close failure"); },
      process: () => ({ pid: 4545 }),
    }),
    capture: async () => { await writeFile(path.join(output, "partial.png"), "private"); return {}; },
    writeIndex: async () => undefined,
    closeTimeoutMs: 5,
    pidFallbackTimeoutMs: 5,
    isPidAlive: () => alive,
    terminatePid: () => { throw Object.assign(new Error("private fallback failure"), { code: "EPERM" }); },
    pause: async () => undefined,
  }).catch((caught) => caught);

  assert.equal(formatSafeCliFailure(error, "ABBOTT_CAPTURE"), "ABBOTT_CAPTURE_FAILED stage=CAPTURE_BROWSER_EXIT\n");
  assert.equal(await stat(output).then(() => true).catch(() => false), false);
  alive = false;
});

test("signal cancellation with hung close removes output and leaves no owned PID", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-hung-cancel-"));
  const output = path.join(parent, "candidate");
  const signalSource = new EventEmitter();
  let alive = true;
  const error = await Promise.race([
    runCaptureLifecycle({
      signalSource,
      setExitCode: () => undefined,
      createOutput: async () => { await mkdir(output, { mode: 0o700 }); return output; },
      authorize: async () => "authorization-fixture",
      launch: async () => ({
        close: () => new Promise(() => undefined),
        process: () => ({ pid: 4646 }),
      }),
      capture: async () => {
        await writeFile(path.join(output, "partial.png"), "private");
        signalSource.emit("SIGINT");
        return {};
      },
      writeIndex: async () => undefined,
      closeTimeoutMs: 5,
      pidFallbackTimeoutMs: 5,
      isPidAlive: () => alive,
      terminatePid: () => { alive = false; },
    }).catch((caught) => caught),
    new Promise((_, reject) => setTimeout(() => reject(new Error("cancellation did not settle")), 200)),
  ]);

  assert.equal(error.code, "CAPTURE_CANCELLED");
  assert.equal(alive, false);
  assert.equal(await stat(output).then(() => true).catch(() => false), false);
});

test("timed PID wait escalates from ignored SIGTERM to SIGKILL and cleanup settles", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-timed-escalation-"));
  const output = path.join(parent, "candidate");
  const signals = [];
  let alive = true;
  const started = Date.now();
  const error = await Promise.race([
    runCaptureLifecycle({
      signalSource: new EventEmitter(),
      setExitCode: () => undefined,
      createOutput: async () => { await mkdir(output, { mode: 0o700 }); return output; },
      authorize: async () => "authorization-fixture",
      launch: async () => ({
        close: async () => { throw new Error("private close rejection"); },
        process: () => ({ pid: 4747 }),
      }),
      capture: async () => {
        await writeFile(path.join(output, "partial.png"), "private");
        throw new Error("private capture failure");
      },
      writeIndex: async () => undefined,
      closeTimeoutMs: 10,
      pidFallbackTimeoutMs: 15,
      isPidAlive: () => alive,
      terminatePid: (_pid, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") alive = false;
      },
    }).catch((caught) => caught),
    new Promise((_, reject) => setTimeout(() => reject(new Error("escalation did not settle")), 300)),
  ]);

  assert.equal(error.code, "CAPTURE_BROWSER_CAPTURE");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(alive, false);
  assert.equal(await stat(output).then(() => true).catch(() => false), false);
  assert.ok(Date.now() - started < 300);
});

test("terminal SIGKILL failure returns a fixed code after partial output cleanup", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-terminal-escalation-"));
  const output = path.join(parent, "candidate");
  const signals = [];
  const error = await Promise.race([
    runCaptureLifecycle({
      signalSource: new EventEmitter(),
      setExitCode: () => undefined,
      createOutput: async () => { await mkdir(output, { mode: 0o700 }); return output; },
      authorize: async () => "authorization-fixture",
      launch: async () => ({
        close: async () => { throw new Error("private close rejection"); },
        process: () => ({ pid: 4848 }),
      }),
      capture: async () => { await writeFile(path.join(output, "partial.png"), "private"); return {}; },
      writeIndex: async () => undefined,
      closeTimeoutMs: 10,
      pidFallbackTimeoutMs: 15,
      isPidAlive: () => true,
      terminatePid: (_pid, signal) => { signals.push(signal); },
    }).catch((caught) => caught),
    new Promise((_, reject) => setTimeout(() => reject(new Error("terminal escalation did not settle")), 300)),
  ]);

  assert.equal(formatSafeCliFailure(error, "ABBOTT_CAPTURE"), "ABBOTT_CAPTURE_FAILED stage=CAPTURE_BROWSER_EXIT\n");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(await stat(output).then(() => true).catch(() => false), false);
});

test("SIGINT and SIGTERM at every capture stage close browser and remove partial output", async () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    for (const signalStage of ["output", "authorization", "launch", "capture", "index"]) {
      const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-cancel-test-"));
      const output = path.join(parent, "candidate");
      const signalSource = new EventEmitter();
      let closeCount = 0;
      let exitCode = null;
      let alive = true;
      const maybeSignal = (stage) => {
        if (signalStage === stage) signalSource.emit(signal);
      };
      const browser = {
        close: async () => { closeCount += 1; alive = false; },
        process: () => ({ pid: 5252 }),
      };

      await assert.rejects(runCaptureLifecycle({
        signalSource,
        setExitCode: (value) => { exitCode = value; },
        createOutput: async () => { await mkdir(output, { mode: 0o700 }); maybeSignal("output"); return output; },
        authorize: async () => { maybeSignal("authorization"); return "authorized-fixture"; },
        launch: async () => { maybeSignal("launch"); return browser; },
        capture: async () => { await writeFile(path.join(output, "partial.png"), "fixture"); maybeSignal("capture"); return {}; },
        writeIndex: async () => { await writeFile(path.join(output, "partial.json"), "fixture"); maybeSignal("index"); return {}; },
        isPidAlive: () => alive,
        pause: async () => undefined,
      }), (error) => error?.code === "CAPTURE_CANCELLED");

      assert.equal(exitCode, signal === "SIGINT" ? 130 : 143);
      assert.equal(await stat(output).then(() => true).catch(() => false), false, `${signal} at ${signalStage}`);
      assert.equal(closeCount, ["launch", "capture", "index"].includes(signalStage) ? 1 : 0);
    }
  }
});

test("browser failures become fixed safe stage codes and clean partial output", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "abbott-browser-error-"));
  const output = path.join(parent, "candidate");
  const privateText = "browser manager-fixture http://127.0.0.1:3004/?access_token=fixture raw-cell";
  let alive = true;
  const error = await runCaptureLifecycle({
    signalSource: new EventEmitter(),
    setExitCode: () => undefined,
    createOutput: async () => { await mkdir(output, { mode: 0o700 }); return output; },
    authorize: async () => "authorization-fixture",
    launch: async () => ({
      close: async () => { alive = false; },
      process: () => ({ pid: 6262 }),
    }),
    capture: async () => { throw new Error(privateText); },
    writeIndex: async () => undefined,
    isPidAlive: () => alive,
    pause: async () => undefined,
  }).catch((caught) => caught);

  assert.equal(formatSafeCliFailure(error, "ABBOTT_CAPTURE"), "ABBOTT_CAPTURE_FAILED stage=CAPTURE_BROWSER_CAPTURE\n");
  assert.doesNotMatch(formatSafeCliFailure(error, "ABBOTT_CAPTURE"), /manager-fixture|http|token|raw-cell|browser manager/i);
  assert.equal(await stat(output).then(() => true).catch(() => false), false);
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
  assert.equal((await stat(typeof candidate === "string" ? candidate : candidate.path)).mode & 0o777, 0o700);
  await parityTool.cleanupPrivateOutputDirectory?.(candidate);
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
