#!/usr/bin/env node

import crypto from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ABBOTT_PARITY_PERIOD,
  assertRuntimeBaseUrl,
  obtainManagerToken,
  readCredentialFd,
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
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2 });
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
  const root = path.resolve(repositoryRoot);
  const baselinePath = await realpath(path.resolve(baseline));
  const outputPath = path.resolve(outputParent);
  if (isWithin(root, baselinePath) || isWithin(root, outputPath)) {
    throw new Error("Baseline and candidate output must remain outside Git");
  }
  const baselineMode = (await stat(baselinePath)).mode & 0o777;
  if ((baselineMode & 0o077) !== 0) throw new Error("Visual baseline directory must be private (mode 0700)");
  for (const filename of REQUIRED_BASELINE_FILES) {
    const file = await stat(path.join(baselinePath, filename)).catch(() => null);
    if (!file?.isFile()) throw new Error(`Visual baseline is missing ${filename}`);
  }
  await mkdir(outputPath, { recursive: true, mode: 0o700 });
  await chmod(outputPath, 0o700);
  return { baseline: baselinePath, outputParent: await realpath(outputPath) };
}

export async function createPrivateCandidateDirectory(outputParent) {
  const directory = await mkdtemp(path.join(path.resolve(outputParent), "abbott-runtime-candidate-"));
  await chmod(directory, 0o700);
  return directory;
}

export function inspectPngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG image");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
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

export async function runOwnedBrowserTask(launch, task) {
  const browser = await launch();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close();
  };
  const signalHandlers = new Map();
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const handler = () => { void close().finally(() => process.exit(exitCode)); };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    return await task(browser);
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    await close();
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

async function visualComparison(referencePath, candidatePath) {
  const [referenceBytes, candidateBytes] = await Promise.all([readFile(referencePath), readFile(candidatePath)]);
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
  const destination = path.join(outputDirectory, "parity-index.json");
  await writeFile(destination, text, { flag: "wx", mode: 0o600 });
  await chmod(destination, 0o600);
  return destination;
}

export async function captureAbbottRuntime({ loginBase, candidateBase, baseline, outputParent, managerPassword, launch }) {
  const locations = await validateCaptureLocations({ baseline, outputParent });
  const outputDirectory = await createPrivateCandidateDirectory(locations.outputParent);
  try {
    const managerToken = await obtainManagerToken(loginBase, managerPassword);
    const consoleCounts = { errors: 0, warnings: 0 };
    const captures = await runOwnedBrowserTask(launch, async (browser) => {
      const page = await browser.newPage();
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
        const candidatePath = path.join(outputDirectory, item.filename);
        await page.screenshot({ path: candidatePath, fullPage: true, type: "png" });
        await chmod(candidatePath, 0o600);
        const baselinePath = path.join(locations.baseline, item.filename);
        const baselineExists = await stat(baselinePath).then((entry) => entry.isFile()).catch(() => false);
        results.push({
          filename: item.filename,
          tab: item.tab,
          css_viewport: cssViewport,
          comparison: baselineExists ? await visualComparison(baselinePath, candidatePath) : null,
        });
      }
      return { visibleTabs, results };
    });
    const index = {
      period: ABBOTT_PARITY_PERIOD,
      visible_tabs: captures.visibleTabs,
      console: consoleCounts,
      visual_thresholds: VISUAL_THRESHOLDS,
      captures: captures.results,
    };
    const indexPath = await writeIndex(outputDirectory, index);
    return { outputDirectory, indexPath, index };
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
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
  const options = parseArgs(process.argv.slice(2));
  const loginBase = assertRuntimeBaseUrl(options.login, 3001);
  const candidateBase = assertRuntimeBaseUrl(options.candidate, 3004);
  const { managerPassword } = await readCredentialFd(options.credentialsFd);
  const puppeteer = (await import("puppeteer")).default;
  const result = await captureAbbottRuntime({
    loginBase,
    candidateBase,
    baseline: options.baseline,
    outputParent: options.outputParent,
    managerPassword,
    launch: () => puppeteer.launch({ headless: true }),
  });
  process.stdout.write(`captures=${result.index.captures.length} errors=${result.index.console.errors} index=${result.indexPath}\n`);
  if (result.index.console.errors > 0 || result.index.captures.some((item) => item.comparison && !passesVisualThreshold(item.comparison))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`Abbott capture failed: ${message.replace(/https?:\/\/\S+/g, "[redacted-url]")}\n`);
    process.exitCode = 1;
  });
}
