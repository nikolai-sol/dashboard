import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadSourceBindingEvidence, profileHash, readSiteProfile } from "./site-seo-profile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRegistry(input) {
  if (Array.isArray(input)) return input;
  if (!input) return [];
  if (!fs.existsSync(input)) return [];
  const value = JSON.parse(fs.readFileSync(input, "utf8"));
  if (!Array.isArray(value)) throw new TypeError("site registry must be an array");
  return value;
}

function collision(profile, registry) {
  const candidate = profile.runtime;
  const fields = ["dashboardId", "slug", "domain"];
  for (const registration of registry) {
    const other = registration.profile || registration;
    const runtime = other.runtime || {};
    if (other.siteId === profile.siteId && profileHash(other) === profileHash(profile)) continue;
    if (fields.some((field) => other[field] !== undefined && other[field] === profile[field])) return `profile ${fields.find((field) => other[field] === profile[field])}`;
    for (const field of ["route", "assetPrefix", "buildOutputDir", "processName", "port", "deployPath", "deployLockPath"]) {
      if (runtime[field] !== undefined && runtime[field] === candidate[field]) return `runtime ${field}`;
    }
  }
  return null;
}

function makeBindings(profile) {
  const evidence = loadSourceBindingEvidence(ROOT, profile);
  const result = {};
  for (const source of profile.sources) {
    if (source.mode === "disabled") continue;
    const entry = evidence[source.bindingId] || {};
    result[source.sourceKey] = {
      bindingId: source.bindingId,
      mode: source.mode,
      status: entry.status || "unconfigured",
      ...(source.sourceKey === "google_search_console" ? { domain: profile.domain } : {}),
      ...(entry.counterId ? { counterId: entry.counterId } : {}),
    };
  }
  return result;
}

export function previewCreate(profileFilename, { registry = [] } = {}) {
  const profile = readSiteProfile(profileFilename);
  const registrations = readRegistry(registry);
  const conflict = collision(profile, registrations);
  if (conflict) throw new Error(`site/runtime collision: ${conflict}`);
  const hash = profileHash(profile);
  const releaseManifest = {
    schemaVersion: 1,
    siteId: profile.siteId,
    profileVersion: profile.profileVersion,
    profileHash: hash,
    templateVersion: profile.templateVersion,
    ...profile.runtime,
  };
  return {
    previewId: `site-preview-${hash.slice(0, 16)}`,
    profileHash: hash,
    profile,
    bindings: makeBindings(profile),
    proposedClientId: profile.clientId,
    proposedSiteId: profile.siteId,
    proposedDashboardId: profile.dashboardId,
    registrationStatus: "proposed_local",
    creates: {
      registry: `site:${profile.siteId}`,
      deployPath: profile.runtime.deployPath,
      route: profile.runtime.route,
      releaseBranch: profile.runtime.releaseBranch,
    },
    releaseManifest,
  };
}

function writeAtomic(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  fs.renameSync(temporary, filename);
}

export function applyCreate(profileFilename, { registry, previewId, preview } = {}) {
  if (!registry) throw new TypeError("registry path is required for apply");
  const expected = previewCreate(profileFilename, { registry: readRegistry(registry) });
  if (!previewId || previewId !== expected.previewId) throw new Error("stale or invalid preview");
  if (preview && preview.profileHash !== expected.profileHash) throw new Error("stale preview profile hash");
  const current = readRegistry(registry);
  const existing = current.find((entry) => entry.profile?.siteId === expected.profile.siteId);
  if (existing) {
    if (profileHash(existing.profile) !== expected.profileHash) throw new Error("profile changed after registration");
    return { profile: existing.profile, releaseManifest: expected.releaseManifest, previewId: expected.previewId, idempotent: true };
  }
  const registration = { profile: expected.profile, bindings: [] };
  const next = [...current, registration];
  writeAtomic(registry, next);
  const releaseManifestPath = `${registry}.release-manifest.json`;
  writeAtomic(releaseManifestPath, expected.releaseManifest);
  return { profile: expected.profile, releaseManifest: expected.releaseManifest, previewId: expected.previewId, idempotent: false };
}

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--preview") result.preview = true;
    else if (item === "--apply") result.apply = true;
    else if (item.startsWith("--")) result[item.slice(2)] = argv[++index];
    else throw new Error(`unexpected argument: ${item}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = args(process.argv.slice(2));
    if (!options.profile) throw new Error("--profile is required");
    if (options.preview === Boolean(options.apply)) throw new Error("choose exactly one of --preview or --apply");
    const registry = options.registry ? path.resolve(options.registry) : path.join(ROOT, "config/sites/registry.json");
    if (options.preview) {
      process.stdout.write(`${JSON.stringify(previewCreate(path.resolve(options.profile), { registry }), null, 2)}\n`);
    } else {
      const preview = previewCreate(path.resolve(options.profile), { registry });
      const result = applyCreate(path.resolve(options.profile), { registry, previewId: options["preview-id"], preview });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
