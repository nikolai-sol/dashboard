import {
  assertSourceScope,
  type SiteBinding,
  type SiteProfile,
  type SiteRegistration,
  type SourceKey,
} from "./index.ts";

const PROFILE_FIELDS = new Set([
  "schemaVersion",
  "profileVersion",
  "siteId",
  "clientId",
  "dashboardId",
  "slug",
  "domain",
  "allowedDomains",
  "title",
  "logoAsset",
  "locale",
  "businessTimezone",
  "templateVersion",
  "sources",
  "taxonomyVersion",
  "seoRulesVersion",
  "authPolicyRef",
  "runtime",
]);
const SOURCE_FIELDS = new Set([
  "sourceKey",
  "mode",
  "bindingId",
  "importCadence",
]);
const RUNTIME_FIELDS = new Set([
  "route",
  "assetPrefix",
  "buildOutputDir",
  "processName",
  "port",
  "deployPath",
  "releaseBranch",
  "deployLockPath",
]);
const SUPPORTED_MODES: Readonly<Record<SourceKey, ReadonlySet<string>>> = {
  yandex_metrika: new Set(["automated", "disabled"]),
  yandex_webmaster: new Set(["automated", "disabled"]),
  google_search_console: new Set(["automated", "manual", "disabled"]),
  yandex_wordstat: new Set(["automated", "disabled"]),
  yandex_webmaster_alice_manual: new Set(["manual", "disabled"]),
  seo_os: new Set(["automated", "disabled"]),
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function exactFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (/token|password|secret|credential|api.?key/i.test(key))
      throw new TypeError(`${label} contains a secret-bearing field: ${key}`);
    if (!allowed.has(key))
      throw new TypeError(`${label} has unknown field: ${key}`);
  }
}

function safeValue(value: unknown, label: string, pattern: RegExp): string {
  const result = nonEmpty(value, label);
  if (!pattern.test(result) || /[;$`|&<>\\\n\r]/.test(result))
    throw new TypeError(`${label} is not a safe data value or path`);
  return result;
}

export function assertSiteProfile(value: unknown): SiteProfile {
  const profile = object(value, "profile");
  exactFields(profile, PROFILE_FIELDS, "profile");
  if (profile.schemaVersion !== 1)
    throw new TypeError("schemaVersion must be 1");
  for (const field of [
    "profileVersion",
    "siteId",
    "clientId",
    "slug",
    "domain",
    "title",
    "locale",
    "businessTimezone",
    "templateVersion",
    "taxonomyVersion",
    "seoRulesVersion",
    "authPolicyRef",
  ])
    nonEmpty(profile[field], field);
  if (
    !Number.isInteger(profile.dashboardId) ||
    Number(profile.dashboardId) <= 0
  )
    throw new TypeError("dashboardId must be positive");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(profile.slug)))
    throw new TypeError("slug is invalid");
  if (
    !Array.isArray(profile.allowedDomains) ||
    profile.allowedDomains.length === 0
  )
    throw new TypeError("allowedDomains must not be empty");
  const domains = profile.allowedDomains.map((domain, index) =>
    nonEmpty(domain, `allowedDomains[${index}]`).toLowerCase(),
  );
  if (
    !domains.includes(String(profile.domain).toLowerCase()) ||
    new Set(domains).size !== domains.length
  ) {
    throw new TypeError("domain must occur once in allowedDomains");
  }
  if (profile.logoAsset !== null && typeof profile.logoAsset !== "string")
    throw new TypeError("logoAsset must be a string or null");

  if (!Array.isArray(profile.sources))
    throw new TypeError("sources must be an array");
  const sourceKeys = new Set<string>();
  for (const [index, rawSource] of profile.sources.entries()) {
    const source = object(rawSource, `sources[${index}]`);
    exactFields(source, SOURCE_FIELDS, `sources[${index}]`);
    const sourceKey = source.sourceKey as SourceKey;
    const modes = SUPPORTED_MODES[sourceKey];
    if (!modes)
      throw new TypeError(`sources[${index}].sourceKey is unsupported`);
    if (sourceKeys.has(sourceKey))
      throw new TypeError(`duplicate sourceKey: ${sourceKey}`);
    sourceKeys.add(sourceKey);
    if (!modes.has(String(source.mode)))
      throw new TypeError(`${sourceKey} mode is unsupported`);
    if (
      !Array.isArray(source.importCadence) ||
      source.importCadence.some(
        (item) =>
          !["previous_month", "previous_iso_week"].includes(String(item)),
      )
    ) {
      throw new TypeError(`${sourceKey} importCadence is invalid`);
    }
    if (source.mode === "disabled") {
      if (source.bindingId !== null || source.importCadence.length > 0)
        throw new TypeError(
          `disabled ${sourceKey} must not have bindingId or cadence`,
        );
    } else {
      nonEmpty(source.bindingId, `${sourceKey}.bindingId`);
    }
  }

  const runtime = object(profile.runtime, "runtime");
  exactFields(runtime, RUNTIME_FIELDS, "runtime");
  safeValue(runtime.route, "route", /^\/[a-z0-9/_-]+$/);
  safeValue(runtime.assetPrefix, "assetPrefix", /^\/[a-z0-9/_-]+$/);
  safeValue(runtime.buildOutputDir, "buildOutputDir", /^\.[a-z0-9._-]+$/);
  safeValue(runtime.processName, "processName", /^[a-z0-9._-]+$/);
  if (
    !Number.isInteger(runtime.port) ||
    Number(runtime.port) < 1024 ||
    Number(runtime.port) > 65535
  )
    throw new TypeError("runtime port is invalid");
  safeValue(runtime.deployPath, "deployPath", /^\/var\/www\/[a-z0-9._/-]+$/);
  safeValue(runtime.releaseBranch, "releaseBranch", /^release\/[a-z0-9._/-]+$/);
  safeValue(
    runtime.deployLockPath,
    "deployLockPath",
    /^\/var\/www\/[a-z0-9._/-]+$/,
  );
  return value as SiteProfile;
}

function assertBinding(value: unknown): SiteBinding {
  const binding = object(value, "binding");
  nonEmpty(binding.bindingId, "bindingId");
  assertSourceScope(binding);
  return value as SiteBinding;
}

export function assertSiteRegistry(
  value: unknown,
): readonly SiteRegistration[] {
  if (!Array.isArray(value))
    throw new TypeError("site registry must be an array");
  const uniqueFields = ["dashboardId", "slug", "domain"] as const;
  const seen = new Map<string, Set<unknown>>();
  for (const field of [
    ...uniqueFields,
    "route",
    "port",
    "buildOutputDir",
    "processName",
    "deployPath",
    "deployLockPath",
  ])
    seen.set(field, new Set());
  // These canonical readers are account-grained, so an account cannot safely
  // identify more than one registered site/resource scope.
  const accountGrainedScopes = new Map<SourceKey, Map<string, SiteBinding>>([
    ["yandex_metrika", new Map()],
    ["yandex_wordstat", new Map()],
    ["seo_os", new Map()],
  ]);

  for (const [index, rawRegistration] of value.entries()) {
    const registration = object(rawRegistration, `registrations[${index}]`);
    const profile = assertSiteProfile(registration.profile);
    if (!Array.isArray(registration.bindings))
      throw new TypeError("bindings must be an array");
    const bindings = registration.bindings.map(assertBinding);
    const bindingIds = new Set(bindings.map((binding) => binding.bindingId));
    for (const binding of bindings) {
      const source = profile.sources.find(
        (candidate) => candidate.bindingId === binding.bindingId,
      );
      if (!source || source.mode === "disabled" || source.sourceKey !== binding.sourceKey)
        throw new TypeError(`binding ${binding.bindingId} is not declared by profile`);
    }
    for (const source of profile.sources) {
      if (source.mode === "disabled") continue;
      const binding = bindings.find(
        (candidate) => candidate.bindingId === source.bindingId,
      );
      if (!binding) continue;
      if (binding.clientId !== profile.clientId)
        throw new TypeError("binding clientId does not match profile");
      if (binding.siteId !== profile.siteId)
        throw new TypeError("binding siteId does not match profile");
      if (binding.dashboardId !== profile.dashboardId)
        throw new TypeError("binding dashboardId does not match profile");
      if (binding.sourceKey !== source.sourceKey)
        throw new TypeError("binding sourceKey does not match profile");
    }
    for (const binding of bindings) {
      const scopes = accountGrainedScopes.get(binding.sourceKey);
      if (!scopes) continue;
      if (binding.sourceKey === "yandex_metrika" && binding.analyticsAccountId !== binding.resourceId)
        throw new TypeError("Metrika counter account and resource identity must match");
      const previous = scopes.get(binding.analyticsAccountId);
      if (previous && (
        previous.clientId !== binding.clientId ||
        previous.siteId !== binding.siteId ||
        previous.dashboardId !== binding.dashboardId ||
        previous.resourceId !== binding.resourceId
      )) {
        throw new TypeError(`${binding.sourceKey} account must not be bound to different scopes`);
      }
      scopes.set(binding.analyticsAccountId, binding);
    }
    if (bindingIds.size !== bindings.length)
      throw new TypeError("bindingId must be unique within a site");

    const values: Record<string, unknown> = {
      dashboardId: profile.dashboardId,
      slug: profile.slug,
      domain: profile.domain.toLowerCase(),
      route: profile.runtime.route,
      port: profile.runtime.port,
      buildOutputDir: profile.runtime.buildOutputDir,
      processName: profile.runtime.processName,
      deployPath: profile.runtime.deployPath,
      deployLockPath: profile.runtime.deployLockPath,
    };
    for (const [field, item] of Object.entries(values)) {
      const items = seen.get(field)!;
      if (items.has(item))
        throw new TypeError(`${field} or runtime identity is duplicated`);
      items.add(item);
    }
  }
  return value as readonly SiteRegistration[];
}
