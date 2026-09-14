#!/usr/bin/env node

import crypto from "node:crypto";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ABBOTT_PARITY_PERIOD,
  SafeStageError,
  assertRuntimeBaseUrl,
  cleanupPrivateOutputDirectory,
  createPrivateOutputDirectory,
  formatSafeCliFailure,
  resolveManagerToken,
  readCredentialFd,
  releasePrivateOutputDirectory,
  runSafeStage,
  writePrivateExclusiveFile,
} from "./compare-abbott-runtime.mjs";

const REQUIRED_DESKTOP_TABS = ["users_summary", "user_actions", "page_stats", "returning", "general_materials"];
const CONDITIONAL_TABS = ["bitrix_pages", "session_journeys", "external_events", "time_buckets"];
const TAB_SLUGS = {
  users_summary: "users-summary",
  user_actions: "user-actions",
  page_stats: "page-stats",
  bitrix_pages: "bitrix-pages",
  session_journeys: "session-journeys",
  external_events: "external-events",
  time_buckets: "time-buckets",
  returning: "returning",
  general_materials: "general-materials",
};
const TAB_LABEL_PARTS = {
  users_summary: ["Общая таблица по пользователям", "Источники трафика"],
  user_actions: ["Действия пользователя"],
  page_stats: ["Статистика страниц"],
  bitrix_pages: ["Bitrix: страницы и сессии"],
  session_journeys: ["Bitrix: путь пользователя"],
  external_events: ["Внешние мероприятия", "Внешние события"],
  time_buckets: ["Время на сайте"],
  returning: ["Вернувшиеся"],
  general_materials: ["Общие материалы"],
};
const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844, deviceScaleFactor: 800 / 390 });
const REQUIRED_BASELINE_FILES = [
  "01-users-summary-desktop.png",
  "02-user-actions-desktop.png",
  "03-page-stats-desktop.png",
  "04-returning-desktop.png",
  "05-general-materials-desktop.png",
  "06-users-summary-mobile.png",
];
const INDEX_FORBIDDEN_TEXT = /access_token|embed_key|cookie|raw_user_id|visit_id|start_url|end_url|https?:\/\//i;
export const VISUAL_THRESHOLDS = Object.freeze({ changed_pixel_ratio: 0.02, mean_absolute_error: 0.005 });

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function buildCapturePlan(visibleTabs) {
  const visible = new Set(visibleTabs);
  const desktop = REQUIRED_DESKTOP_TABS.map((tab, index) => ({
    filename: `${String(index + 1).padStart(2, "0")}-${TAB_SLUGS[tab]}-desktop.png`,
    tab,
    viewport: { ...DESKTOP_VIEWPORT },
  }));
  const mobile = [{
    filename: "06-users-summary-mobile.png",
    tab: "users_summary",
    viewport: { ...MOBILE_VIEWPORT },
  }];
  const conditional = CONDITIONAL_TABS.filter((tab) => visible.has(tab)).map((tab, index) => ({
    filename: `${String(index + 7).padStart(2, "0")}-${TAB_SLUGS[tab]}-desktop.png`,
    tab,
    viewport: { ...DESKTOP_VIEWPORT },
  }));
  return [...desktop, ...mobile, ...conditional];
}

export async function validateCaptureLocations({ baseline, outputParent, repositoryRoot = process.cwd() }) {
  const root = await realpath(path.resolve(repositoryRoot));
  const baselinePath = await realpath(path.resolve(baseline));
  const namedOutputPath = path.resolve(outputParent);
  if (isWithin(root, baselinePath) || isWithin(root, namedOutputPath)) {
    throw new Error("Baseline and candidate output must remain outside Git");
  }
  const outputPath = await realpath(namedOutputPath);
  if (isWithin(root, outputPath)) throw new Error("Baseline and candidate output must remain outside Git");
  const baselineMode = (await stat(baselinePath)).mode & 0o777;
  if ((baselineMode & 0o077) !== 0) throw new Error("Visual baseline directory must be private (mode 0700)");
  for (const filename of REQUIRED_BASELINE_FILES) {
    const file = await stat(path.join(baselinePath, filename)).catch(() => null);
    if (!file?.isFile()) throw new Error(`Visual baseline is missing ${filename}`);
  }
  return { baseline: baselinePath, outputParent: outputPath };
}

export async function createPrivateCandidateDirectory(outputParent, repositoryRoot = process.cwd(), options = {}) {
  return createPrivateOutputDirectory(outputParent, "abbott-runtime-candidate-", repositoryRoot, options);
}

export function inspectPngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG image");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function buildCaptureDimensions(viewport, pngBytes) {
  return {
    css: { width: viewport.width, height: viewport.height },
    pixels: inspectPngDimensions(pngBytes),
  };
}

export function calculatePixelDifference(referencePixels, candidatePixels, channels) {
  const reference = Buffer.from(referencePixels);
  const candidate = Buffer.from(candidatePixels);
  if (reference.length !== candidate.length || reference.length % channels !== 0) {
    throw new Error("Pixel buffers have different dimensions");
  }
  let changedPixels = 0;
  let absoluteDifference = 0;
  for (let offset = 0; offset < reference.length; offset += channels) {
    let changed = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const difference = Math.abs(reference[offset + channel] - candidate[offset + channel]);
      absoluteDifference += difference;
      if (difference !== 0) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const pixelCount = reference.length / channels;
  return {
    changed_pixel_ratio: Number((changedPixels / pixelCount).toFixed(6)),
    mean_absolute_error: Number((absoluteDifference / (reference.length * 255)).toFixed(6)),
  };
}

export function passesVisualThreshold(comparison) {
  return comparison?.dimensions_match === true
    && comparison.pixel_metrics !== null
    && comparison.pixel_metrics.changed_pixel_ratio <= VISUAL_THRESHOLDS.changed_pixel_ratio
    && comparison.pixel_metrics.mean_absolute_error <= VISUAL_THRESHOLDS.mean_absolute_error;
}

function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function settleWithin(operation, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SafeStageError(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForPidsToExit(processIds, isPidAlive, pause, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processIds.some(isPidAlive) && Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      await settleWithin(() => pause(Math.min(50, remaining)), remaining, "CAPTURE_BROWSER_EXIT");
    } catch {
      return false;
    }
  }
  return !processIds.some(isPidAlive);
}

export async function closeOwnedBrowser(browser, options = {}) {
  const isPidAlive = options.isPidAlive ?? defaultPidAlive;
  const pause = options.pause ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const terminatePid = options.terminatePid ?? ((pid, signal) => process.kill(pid, signal));
  const closeTimeoutMs = options.closeTimeoutMs ?? 2_000;
  const pidExitTimeoutMs = options.pidExitTimeoutMs ?? 1_000;
  const pidFallbackTimeoutMs = options.pidFallbackTimeoutMs ?? 1_000;
  const pid = Number(browser.process?.()?.pid);
  const processIds = Number.isSafeInteger(pid) && pid > 0 ? [pid] : [];
  let closeAttempts = 0;
  let closeSucceeded = false;
  while (closeAttempts < 2 && !closeSucceeded) {
    closeAttempts += 1;
    try {
      await settleWithin(() => browser.close(), closeTimeoutMs, "CAPTURE_BROWSER_CLOSE");
      closeSucceeded = true;
    } catch {}
  }
  if (closeSucceeded) await waitForPidsToExit(processIds, isPidAlive, pause, pidExitTimeoutMs);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const alivePids = processIds.filter(isPidAlive);
    if (alivePids.length === 0) break;
    await Promise.allSettled(alivePids.map((ownedPid) => settleWithin(
      () => terminatePid(ownedPid, signal),
      pidFallbackTimeoutMs,
      "CAPTURE_BROWSER_EXIT",
    )));
    await waitForPidsToExit(processIds, isPidAlive, pause, pidFallbackTimeoutMs);
  }
  if (processIds.some(isPidAlive)) throw new SafeStageError("CAPTURE_BROWSER_EXIT");
  if (!closeSucceeded && processIds.length === 0) throw new SafeStageError("CAPTURE_BROWSER_CLOSE");
  return { process_ids: processIds, exit_verified: true, close_attempts: closeAttempts, close_succeeded: closeSucceeded };
}

export async function runCaptureLifecycle(options) {
  const signalSource = options.signalSource ?? process;
  const setExitCode = options.setExitCode ?? ((value) => { process.exitCode = value; });
  const controller = new AbortController();
  let cancelled = false;
  let outputDirectory = null;
  let browser = null;
  let browserCloseStarted = false;
  let browserOwnership = { process_ids: [], exit_verified: true, close_attempts: 0, close_succeeded: true };
  let cleanupPromise = null;

  const cleanup = async () => {
    if (cleanupPromise) {
      await cleanupPromise;
      if ((browser && !browserCloseStarted) || outputDirectory) return cleanup();
      return undefined;
    }
    cleanupPromise = (async () => {
      const removeOutput = options.removeOutput ?? ((output) => typeof output === "string"
        ? rm(output, { recursive: true, force: true })
        : cleanupPrivateOutputDirectory(output));
      const tasks = [];
      if (browser && !browserCloseStarted) {
        browserCloseStarted = true;
        tasks.push(closeOwnedBrowser(browser, {
          closeTimeoutMs: options.closeTimeoutMs,
          isPidAlive: options.isPidAlive,
          pause: options.pause,
          pidExitTimeoutMs: options.pidExitTimeoutMs,
          pidFallbackTimeoutMs: options.pidFallbackTimeoutMs,
          terminatePid: options.terminatePid,
        }).then((ownership) => { browserOwnership = ownership; browser = null; }));
      }
      if (outputDirectory) tasks.push(Promise.resolve(removeOutput(outputDirectory)).then(() => { outputDirectory = null; }));
      const results = await Promise.allSettled(tasks);
      if (results.some((result) => result.status === "rejected")) throw new SafeStageError("CAPTURE_CLEANUP");
    })();
    try {
      await cleanupPromise;
    } finally {
      cleanupPromise = null;
    }
  };
  const handlers = new Map();
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const handler = () => {
      if (cancelled) return;
      cancelled = true;
      setExitCode(exitCode);
      controller.abort();
      void cleanup().catch(() => undefined);
    };
    handlers.set(signal, handler);
    signalSource.once(signal, handler);
  }
  const assertActive = () => {
    if (cancelled || controller.signal.aborted) throw new SafeStageError("CAPTURE_CANCELLED");
  };

  try {
    outputDirectory = await runSafeStage("CAPTURE_OUTPUT_CREATE", () => options.createOutput(controller.signal));
    assertActive();
    const authorization = await runSafeStage("CAPTURE_AUTHORIZATION", () => options.authorize(controller.signal));
    assertActive();
    browser = await runSafeStage("CAPTURE_BROWSER_LAUNCH", () => options.launch(controller.signal));
    assertActive();
    const captureResult = await runSafeStage("CAPTURE_BROWSER_CAPTURE", () => options.capture({ browser, authorization, outputDirectory, signal: controller.signal }));
    assertActive();
    browserCloseStarted = true;
    browserOwnership = await closeOwnedBrowser(browser, {
      closeTimeoutMs: options.closeTimeoutMs,
      isPidAlive: options.isPidAlive,
      pause: options.pause,
      pidExitTimeoutMs: options.pidExitTimeoutMs,
      pidFallbackTimeoutMs: options.pidFallbackTimeoutMs,
      terminatePid: options.terminatePid,
    });
    browser = null;
    assertActive();
    const result = await runSafeStage("CAPTURE_INDEX_WRITE", () => options.writeIndex({ captureResult, browserOwnership, outputDirectory, signal: controller.signal }));
    assertActive();
    if (options.releaseOutput) {
      await runSafeStage("CAPTURE_OUTPUT_RELEASE", () => options.releaseOutput(outputDirectory));
      outputDirectory = null;
    }
    return result;
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw new SafeStageError("CAPTURE_CLEANUP");
    }
    if (cancelled) throw new SafeStageError("CAPTURE_CANCELLED");
    throw error instanceof SafeStageError ? error : new SafeStageError("CAPTURE_STAGE");
  } finally {
    for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler);
  }
}

function tabIdForLabel(label) {
  const normalized = String(label ?? "").replace(/\s+/g, " ").trim();
  return Object.entries(TAB_LABEL_PARTS).find(([, parts]) => parts.some((part) => normalized.includes(part)))?.[0] ?? null;
}

async function waitForStableDashboard(page) {
  await page.waitForSelector("[data-dashboard-ready='true']", { timeout: 120_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const animations = document.getAnimations?.() ?? [];
    await Promise.race([
      Promise.allSettled(animations.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function listVisibleTabs(page) {
  const labels = await page.$$eval("nav button", (buttons) => buttons
    .filter((button) => {
      const style = window.getComputedStyle(button);
      return style.visibility !== "hidden" && style.display !== "none" && button.getBoundingClientRect().width > 0;
    })
    .map((button) => button.textContent ?? ""));
  return labels.map(tabIdForLabel).filter(Boolean);
}

async function selectTab(page, tab) {
  const parts = TAB_LABEL_PARTS[tab];
  const clicked = await page.$$eval("nav button", (buttons, expectedParts) => {
    const button = buttons.find((item) => expectedParts.some((part) => (item.textContent ?? "").includes(part)));
    if (!button) return false;
    button.click();
    return true;
  }, parts);
  if (!clicked) throw new Error(`Required visual tab is not visible: ${tab}`);
  await waitForStableDashboard(page);
}

async function visualComparison(referencePath, candidateBytes) {
  const referenceBytes = await readFile(referencePath);
  const referenceDimensions = inspectPngDimensions(referenceBytes);
  const candidateDimensions = inspectPngDimensions(candidateBytes);
  const result = {
    reference_sha256: sha256(referenceBytes),
    candidate_sha256: sha256(candidateBytes),
    reference_dimensions: referenceDimensions,
    candidate_dimensions: candidateDimensions,
    dimensions_match: referenceDimensions.width === candidateDimensions.width
      && referenceDimensions.height === candidateDimensions.height,
    pixel_metrics: null,
  };
  if (!result.dimensions_match) return result;
  const sharp = (await import("sharp")).default;
  const [referenceRaw, candidateRaw] = await Promise.all([
    sharp(referenceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(candidateBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  result.pixel_metrics = calculatePixelDifference(referenceRaw.data, candidateRaw.data, referenceRaw.info.channels);
  result.passes_threshold = passesVisualThreshold(result);
  return result;
}

export function buildCaptureUrl(candidateBase) {
  const url = new URL("/dashboard/18", `${candidateBase}/`);
  url.searchParams.set("from", ABBOTT_PARITY_PERIOD.from);
  url.searchParams.set("to", ABBOTT_PARITY_PERIOD.to);
  return url;
}

async function writeIndex(outputDirectory, index) {
  const text = `${JSON.stringify(index, null, 2)}\n`;
  if (INDEX_FORBIDDEN_TEXT.test(text)) throw new Error("Visual parity index contains forbidden content");
  return writePrivateExclusiveFile(outputDirectory, "parity-index.json", text);
}

export async function guardCaptureRequests(page, candidateBase) {
  const origin = assertRuntimeBaseUrl(candidateBase, 3004);
  let violated = false;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin !== origin || url.username || url.password || request.redirectChain().length !== 0) {
        violated = true;
        await request.abort();
      } else await request.continue();
    } catch {
      violated = true;
      await request.abort().catch(() => undefined);
    }
  });
  return { assertSafe() { if (violated) throw new SafeStageError("CAPTURE_REQUEST_BOUNDARY"); } };
}

export async function captureAbbottRuntime({ loginBase, candidateBase, baseline, outputParent, managerPassword, managerAccessToken, launch }) {
  assertRuntimeBaseUrl(loginBase, 3001);
  assertRuntimeBaseUrl(candidateBase, 3004);
  const locations = await validateCaptureLocations({ baseline, outputParent });
  return runCaptureLifecycle({
    createOutput: () => createPrivateCandidateDirectory(locations.outputParent),
    authorize: () => resolveManagerToken(loginBase, candidateBase, { managerPassword, managerAccessToken }),
    launch,
    capture: async ({ browser, authorization: managerToken, outputDirectory }) => {
      const consoleCounts = { errors: 0, warnings: 0 };
      const page = await browser.newPage();
      const boundary = await guardCaptureRequests(page, candidateBase);
      await page.setBypassServiceWorker(true);
      page.on("console", (message) => {
        if (message.type() === "error") consoleCounts.errors += 1;
        if (message.type() === "warning" || message.type() === "warn") consoleCounts.warnings += 1;
      });
      await page.setViewport(DESKTOP_VIEWPORT);
      await page.setCookie({
        name: "dashboard_viewer_18",
        value: managerToken,
        url: candidateBase,
        httpOnly: true,
        sameSite: "Lax",
      });
      await page.goto(buildCaptureUrl(candidateBase).href, { waitUntil: "networkidle0", timeout: 120_000 });
      boundary.assertSafe();
      await waitForStableDashboard(page);
      const visibleTabs = await listVisibleTabs(page);
      const missing = REQUIRED_DESKTOP_TABS.filter((tab) => !visibleTabs.includes(tab));
      if (missing.length > 0) throw new Error(`Required visual tabs are not visible: ${missing.join(", ")}`);
      const plan = buildCapturePlan(visibleTabs);
      const results = [];
      let previousViewport = null;
      for (const item of plan) {
        const viewportKey = JSON.stringify(item.viewport);
        if (viewportKey !== previousViewport) {
          await page.setViewport(item.viewport);
          await waitForStableDashboard(page);
          previousViewport = viewportKey;
        }
        await selectTab(page, item.tab);
        const cssViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        if (cssViewport.width !== item.viewport.width || cssViewport.height !== item.viewport.height) {
          throw new Error(`Browser did not apply the required CSS viewport for ${item.tab}`);
        }
        boundary.assertSafe();
        const candidateBytes = Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
        boundary.assertSafe();
        await writePrivateExclusiveFile(outputDirectory, item.filename, candidateBytes);
        const baselinePath = path.join(locations.baseline, item.filename);
        const baselineExists = await stat(baselinePath).then((entry) => entry.isFile()).catch(() => false);
        results.push({
          filename: item.filename,
          tab: item.tab,
          dimensions: buildCaptureDimensions(item.viewport, candidateBytes),
          comparison: baselineExists ? await visualComparison(baselinePath, candidateBytes) : null,
        });
      }
      boundary.assertSafe();
      return { visibleTabs, results, consoleCounts };
    },
    writeIndex: async ({ captureResult, browserOwnership, outputDirectory }) => {
      const index = {
        period: ABBOTT_PARITY_PERIOD,
        visible_tabs: captureResult.visibleTabs,
        console: captureResult.consoleCounts,
        browser_processes: browserOwnership,
        visual_thresholds: VISUAL_THRESHOLDS,
        captures: captureResult.results,
      };
      const indexPath = await writeIndex(outputDirectory, index);
      return { outputDirectory, indexPath, index };
    },
    removeOutput: cleanupPrivateOutputDirectory,
    releaseOutput: releasePrivateOutputDirectory,
  });
}

function parseArgs(argv) {
  const options = { credentialsFd: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--login" && next) { options.login = next; index += 1; }
    else if (value === "--candidate" && next) { options.candidate = next; index += 1; }
    else if (value === "--baseline" && next) { options.baseline = next; index += 1; }
    else if (value === "--output-parent" && next) { options.outputParent = next; index += 1; }
    else if (value === "--credentials-fd" && next && /^\d+$/.test(next)) { options.credentialsFd = Number(next); index += 1; }
    else throw new Error("Usage: capture-abbott-runtime.mjs --login ORIGIN:3001 --candidate ORIGIN:3004 --baseline PATH --output-parent PATH [--credentials-fd N]");
  }
  if (!options.login || !options.candidate || !options.baseline || !options.outputParent) {
    throw new Error("Usage: capture-abbott-runtime.mjs --login ORIGIN:3001 --candidate ORIGIN:3004 --baseline PATH --output-parent PATH [--credentials-fd N]");
  }
  return options;
}

async function main() {
  const options = await runSafeStage("ARGUMENTS", () => parseArgs(process.argv.slice(2)));
  const { loginBase, candidateBase } = await runSafeStage("ORIGIN_VALIDATION", () => ({
    loginBase: assertRuntimeBaseUrl(options.login, 3001),
    candidateBase: assertRuntimeBaseUrl(options.candidate, 3004),
  }));
  const { managerPassword, managerAccessToken } = await runSafeStage("CREDENTIAL_INPUT", () => readCredentialFd(options.credentialsFd));
  const puppeteer = await runSafeStage("BROWSER_LIBRARY", async () => (await import("puppeteer")).default);
  const result = await runSafeStage("CAPTURE_EXECUTION", () => captureAbbottRuntime({
    loginBase,
    candidateBase,
    baseline: options.baseline,
    outputParent: options.outputParent,
    managerPassword,
    managerAccessToken,
    launch: () => puppeteer.launch({ headless: true }),
  }));
  process.stdout.write(`captures=${result.index.captures.length} errors=${result.index.console.errors} index=created\n`);
  if (result.index.console.errors > 0 || result.index.captures.some((item) => item.comparison && !passesVisualThreshold(item.comparison))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (!(error instanceof SafeStageError && error.code === "CAPTURE_CANCELLED")) {
      process.stderr.write(formatSafeCliFailure(error, "ABBOTT_CAPTURE"));
      process.exitCode = 1;
    }
  });
}
