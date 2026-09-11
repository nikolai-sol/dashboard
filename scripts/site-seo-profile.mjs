import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SOURCE_KEYS = new Set([
  "yandex_metrika", "yandex_webmaster", "google_search_console",
  "yandex_wordstat", "yandex_webmaster_alice_manual", "seo_os",
]);
const MODES = {
  yandex_metrika: new Set(["automated", "disabled"]),
  yandex_webmaster: new Set(["automated", "disabled"]),
  google_search_console: new Set(["automated", "manual", "disabled"]),
  yandex_wordstat: new Set(["automated", "disabled"]),
  yandex_webmaster_alice_manual: new Set(["manual", "disabled"]),
  seo_os: new Set(["automated", "disabled"]),
};

const PROFILE_FIELDS = new Set([
  "schemaVersion", "profileVersion", "siteId", "clientId", "dashboardId", "slug",
  "domain", "allowedDomains", "title", "logoAsset", "locale", "businessTimezone",
  "templateVersion", "sources", "seoSections", "taxonomyVersion", "seoRulesVersion", "authPolicyRef", "runtime",
]);
const SOURCE_FIELDS = new Set(["sourceKey", "mode", "bindingId", "importCadence"]);
const SEO_SECTION_FIELDS = new Set(["id", "label", "pathPrefixes"]);
const RUNTIME_FIELDS = new Set(["route", "assetPrefix", "buildOutputDir", "processName", "port", "deployPath", "releaseBranch", "deployLockPath"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
  return value;
}
function fields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (/token|password|secret|credential|api.?key/i.test(key)) throw new TypeError(`${label} contains secret-bearing field: ${key}`);
    if (!allowed.has(key)) throw new TypeError(`${label} has unknown field: ${key}`);
  }
}
function safe(value, label, pattern) {
  const result = text(value, label);
  if (!pattern.test(result) || /[;$`|&<>\\\n\r]/.test(result)) throw new TypeError(`${label} is unsafe`);
  return result;
}

export function validateSiteProfile(value) {
  const profile = object(value, "profile");
  fields(profile, PROFILE_FIELDS, "profile");
  if (profile.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  for (const key of ["profileVersion", "siteId", "clientId", "title", "locale", "businessTimezone", "templateVersion", "taxonomyVersion", "seoRulesVersion", "authPolicyRef"]) text(profile[key], key);
  if (!Number.isInteger(profile.dashboardId) || profile.dashboardId <= 0) throw new TypeError("dashboardId must be positive");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.slug)) throw new TypeError("slug is invalid");
  text(profile.domain, "domain");
  if (!Array.isArray(profile.allowedDomains) || profile.allowedDomains.length === 0) throw new TypeError("allowedDomains must not be empty");
  const domains = profile.allowedDomains.map((entry, index) => text(entry, `allowedDomains[${index}]`).toLowerCase());
  if (!domains.includes(profile.domain.toLowerCase()) || new Set(domains).size !== domains.length) throw new TypeError("domain must occur once in allowedDomains");
  if (profile.logoAsset !== null && typeof profile.logoAsset !== "string") throw new TypeError("logoAsset must be a string or null");
  if (!Array.isArray(profile.sources)) throw new TypeError("sources must be an array");
  const sourceKeys = new Set();
  for (const [index, sourceValue] of profile.sources.entries()) {
    const source = object(sourceValue, `sources[${index}]`);
    fields(source, SOURCE_FIELDS, `sources[${index}]`);
    if (!SOURCE_KEYS.has(source.sourceKey)) throw new TypeError(`unsupported sourceKey: ${source.sourceKey}`);
    if (sourceKeys.has(source.sourceKey)) throw new TypeError(`duplicate sourceKey: ${source.sourceKey}`);
    sourceKeys.add(source.sourceKey);
    if (!MODES[source.sourceKey].has(source.mode)) throw new TypeError(`${source.sourceKey} mode is unsupported`);
    if (!Array.isArray(source.importCadence) || source.importCadence.some((item) => !["previous_month", "previous_iso_week"].includes(item))) throw new TypeError(`${source.sourceKey} importCadence is invalid`);
    if (source.mode === "disabled") {
      if (source.bindingId !== null || source.importCadence.length !== 0) throw new TypeError(`disabled ${source.sourceKey} must not have bindingId or cadence`);
    } else text(source.bindingId, `${source.sourceKey}.bindingId`);
  }
  if (profile.seoSections !== undefined) {
    if (!Array.isArray(profile.seoSections)) throw new TypeError("seoSections must be an array");
    const sectionIds = new Set();
    const pathPrefixes = new Set();
    for (const [index, sectionValue] of profile.seoSections.entries()) {
      const section = object(sectionValue, `seoSections[${index}]`);
      fields(section, SEO_SECTION_FIELDS, `seoSections[${index}]`);
      const id = safe(section.id, `seoSections[${index}].id`, /^[a-z0-9][a-z0-9-]*$/);
      text(section.label, `seoSections[${index}].label`);
      if (sectionIds.has(id)) throw new TypeError(`duplicate seoSections id: ${id}`);
      sectionIds.add(id);
      if (!Array.isArray(section.pathPrefixes) || section.pathPrefixes.length === 0) throw new TypeError(`seoSections[${index}].pathPrefixes must not be empty`);
      for (const [prefixIndex, prefixValue] of section.pathPrefixes.entries()) {
        const prefix = safe(prefixValue, `seoSections[${index}].pathPrefixes[${prefixIndex}]`, /^\/[A-Za-z0-9._~!$'()*+,;=:@%/-]+\/$/);
        if (pathPrefixes.has(prefix)) throw new TypeError(`duplicate seoSections path prefix: ${prefix}`);
        pathPrefixes.add(prefix);
      }
    }
  }
  const runtime = object(profile.runtime, "runtime");
  fields(runtime, RUNTIME_FIELDS, "runtime");
  safe(runtime.route, "route", /^\/[a-z0-9/_-]+$/);
  safe(runtime.assetPrefix, "assetPrefix", /^\/[a-z0-9/_-]+$/);
  safe(runtime.buildOutputDir, "buildOutputDir", /^\.[a-z0-9._-]+$/);
  safe(runtime.processName, "processName", /^[a-z0-9._-]+$/);
  if (!Number.isInteger(runtime.port) || runtime.port < 1024 || runtime.port > 65535) throw new TypeError("runtime port is invalid");
  safe(runtime.deployPath, "deployPath", /^\/var\/www\/[a-z0-9._/-]+$/);
  safe(runtime.releaseBranch, "releaseBranch", /^release\/[a-z0-9._/-]+$/);
  safe(runtime.deployLockPath, "deployLockPath", /^\/var\/www\/[a-z0-9._/-]+$/);
  const expected = `dashboard-${profile.slug}`;
  if (runtime.route !== `/dashboard/${profile.slug}` || runtime.processName !== expected || runtime.releaseBranch !== `release/${profile.slug}` || runtime.deployPath !== `/var/www/${expected}` || runtime.buildOutputDir !== `.next-${profile.slug}` || runtime.assetPrefix !== `/_next-${profile.slug}`) throw new TypeError("runtime identity is not owned by profile slug");
  return profile;
}

export function readSiteProfile(filename) {
  const profile = JSON.parse(fs.readFileSync(filename, "utf8"));
  return validateSiteProfile(profile);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function profileHash(profile) {
  return createHash("sha256").update(canonicalJson(profile)).digest("hex");
}

export function loadSourceBindingEvidence(repoRoot, profile) {
  const filename = path.join(repoRoot, "deploy", profile.slug, "repository.json");
  if (!fs.existsSync(filename)) return {};
  const repository = JSON.parse(fs.readFileSync(filename, "utf8"));
  return repository.sourceBindings && typeof repository.sourceBindings === "object" ? repository.sourceBindings : {};
}
