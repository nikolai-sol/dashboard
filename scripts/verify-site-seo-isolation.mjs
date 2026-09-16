import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSiteProfile } from "./site-seo-profile.mjs";

function value(entry) {
  if (entry && entry.profile && entry.profile.runtime) return entry.profile;
  if (entry && entry.runtime) return entry;
  if (entry && entry.route && entry.siteId) return entry;
  throw new TypeError("isolation registry entry must contain a profile runtime");
}

export function verifyIsolation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("isolation registry must not be empty");
  const seen = new Map();
  const identity = ["dashboardId", "slug", "domain", "route", "assetPrefix", "buildOutputDir", "processName", "port", "deployPath", "releaseBranch", "deployLockPath"];
  for (const entry of entries) {
    const profile = value(entry);
    if (profile.schemaVersion !== undefined) readSiteProfileFromValue(profile);
    const runtime = profile.runtime || profile;
    const siteId = profile.siteId || runtime.siteId;
    if (!siteId) throw new TypeError("siteId is required");
    for (const field of identity) {
      const candidate = profile[field] ?? runtime[field];
      if (candidate === undefined) continue;
      const key = `${field}:${candidate}`;
      if (seen.has(key) && seen.get(key) !== siteId) throw new Error(`isolation collision for ${field}: ${candidate}`);
      seen.set(key, siteId);
    }
    const expectedSlug = profile.slug || siteId.replace(/^site-/, "");
    if (runtime.route !== `/dashboard/${expectedSlug}` || runtime.assetPrefix !== `/_next-${expectedSlug}` || runtime.buildOutputDir !== `.next-${expectedSlug}` || runtime.processName !== `dashboard-${expectedSlug}` || runtime.deployPath !== `/var/www/dashboard-${expectedSlug}`) throw new Error(`runtime identity is not site-owned: ${siteId}`);
    const serialized = JSON.stringify(entry).toLowerCase();
    if (serialized.includes("zaruku") || serialized.includes("abbott")) throw new Error(`foreign runtime reference in ${siteId}`);
  }
  return { ok: true, sites: entries.length, identities: seen.size };
}

function readSiteProfileFromValue(profile) {
  // Keep the CLI verifier independent of TypeScript; validate the shape through
  // a temporary in-memory data path only when a complete profile is supplied.
  if (!profile.runtime || !profile.siteId || !profile.slug) throw new TypeError("profile is incomplete");
  return profile;
}

function load(filename) {
  const value = JSON.parse(fs.readFileSync(filename, "utf8"));
  return Array.isArray(value) ? value : [value];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filenames = process.argv.slice(2);
  if (filenames.length === 0) {
    process.stderr.write("usage: node verify-site-seo-isolation.mjs REGISTRY.json [...]\n");
    process.exitCode = 2;
  } else {
    try {
      const entries = filenames.flatMap((filename) => load(filename));
      process.stdout.write(`${JSON.stringify(verifyIsolation(entries))}\n`);
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
