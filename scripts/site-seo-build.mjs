import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSiteRegistry } from "../packages/site-seo-contract/src/index.ts";
import { createArtifactManifest, inspectArtifactDirectory, validateArtifactManifest } from "./site-seo-artifact-policy.mjs";
import { profileHash, readSiteProfile } from "./site-seo-profile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_SOURCE_PATHS = [
  "apps/site-seo",
  "packages/site-seo-contract",
  "src/db/site-seo",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

function parse(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument.startsWith("--")) result[argument.slice(2)] = argv[++index];
    else throw new Error(`unexpected argument: ${argument}`);
  }
  return result;
}

function profileFilename(site) {
  if (site.includes("/") || site.includes("\\") || !/^[a-z0-9-]+$/.test(site)) throw new Error("invalid --site slug");
  const preferred = path.join(ROOT, "config/sites", `${site}.json`);
  const fixture = path.join(ROOT, "config/sites/fixtures", `${site}.json`);
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(fixture)) return fixture;
  throw new Error(`profile not found for site ${site}`);
}

export function buildEnvironment(profile) {
  return {
    SITE_SEO_SITE_ID: profile.siteId,
    SITE_SEO_SITE_SLUG: profile.slug,
    SITE_SEO_PROFILE_VERSION: profile.profileVersion,
    SITE_SEO_TEMPLATE_VERSION: profile.templateVersion,
    SITE_SEO_BUILD_OUTPUT_DIR: profile.runtime.buildOutputDir,
    SITE_SEO_ASSET_PREFIX: profile.runtime.assetPrefix,
    SITE_SEO_ROUTE: profile.runtime.route,
    PORT: String(profile.runtime.port),
  };
}

export function assertTemplateSource(profile, { repositoryRoot = ROOT, sourcePaths = TEMPLATE_SOURCE_PATHS } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(profile.templateVersion)) throw new Error("templateVersion must be an exact git commit");
  try {
    execFileSync("git", ["cat-file", "-e", `${profile.templateVersion}^{commit}`], { cwd: repositoryRoot, stdio: "ignore" });
  } catch {
    throw new Error(`template source commit is unavailable: ${profile.templateVersion}`);
  }
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths], { cwd: repositoryRoot, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim())
    .filter((line) => !/^apps\/site-seo\/\.next-[^/]+(?:\/|$)/.test(line.slice(3)));
  if (dirty.length) throw new Error("template source tree has uncommitted files");
  for (const sourcePath of sourcePaths) {
    const result = spawnSync("git", ["diff", "--quiet", profile.templateVersion, "--", sourcePath], { cwd: repositoryRoot });
    if (result.status !== 0) throw new Error(`template source differs from ${profile.templateVersion}: ${sourcePath}`);
  }
  return { revision: profile.templateVersion, sourcePaths: [...sourcePaths] };
}

export function assertRegistered(profile, registryFilename) {
  if (!registryFilename || !fs.existsSync(registryFilename)) {
    throw new Error("site registry is required before build");
  }
  const registry = JSON.parse(fs.readFileSync(registryFilename, "utf8"));
  try {
    assertSiteRegistry(registry);
  } catch (error) {
    throw new Error(`site registry validation failed: ${error.message}`, { cause: error });
  }
  const registration = registry.find((entry) => entry.profile?.siteId === profile.siteId);
  if (!registration || profileHash(registration.profile) !== profileHash(profile)) throw new Error(`site ${profile.siteId} is not registered at this profile version`);
  if (!Array.isArray(registration.bindings)) throw new TypeError("site registration bindings must be an array");
  return registration;
}

export function writeRuntimeRegistration(standaloneRoot, registration) {
  const destination = path.join(standaloneRoot, "apps", "site-seo", "site-registration.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o640 });
  return destination;
}

export function copyRuntimeAssets(outputRoot, standaloneRoot, buildOutputDir) {
  const source = path.join(outputRoot, "static");
  if (!fs.existsSync(source)) throw new Error(`missing Next static output: ${source}`);
  const destination = path.join(standaloneRoot, "apps", "site-seo", buildOutputDir, "static");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

export function createBuildMetadata(standaloneRoot, profile, templateSource) {
  const manifest = createArtifactManifest(standaloneRoot, profile);
  manifest.templateSourceCommit = templateSource.revision;
  manifest.templateSourcePaths = templateSource.sourcePaths;
  validateArtifactManifest(manifest);
  const destination = path.join(path.dirname(standaloneRoot), "site-seo-artifact-manifest.json");
  fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
  const errors = inspectArtifactDirectory(standaloneRoot, manifest);
  if (errors.length) throw new Error(`site-seo artifact policy failed:\n${errors.join("\n")}`);
  return { manifest, destination };
}

export function buildSite(profileFilenameValue, { dryRun = false, registryFilename = null } = {}) {
  const profile = readSiteProfile(profileFilenameValue);
  const templateSource = assertTemplateSource(profile);
  const registration = assertRegistered(profile, registryFilename);
  const appRoot = path.join(ROOT, "apps/site-seo");
  const env = { ...process.env, ...buildEnvironment(profile) };
  if (dryRun) return { profile, environment: buildEnvironment(profile), appRoot, command: "next build --webpack" };
  let dependencyRoot = ROOT;
  while (!fs.existsSync(path.join(dependencyRoot, "node_modules/next/dist/bin/next")) && dependencyRoot !== path.dirname(dependencyRoot)) dependencyRoot = path.dirname(dependencyRoot);
  const nextEntrypoint = path.join(dependencyRoot, "node_modules/next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextEntrypoint, "build", "--webpack"], { cwd: appRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Next build failed with status ${result.status}`);
  const outputRoot = path.join(appRoot, profile.runtime.buildOutputDir);
  const standaloneRoot = path.join(outputRoot, "standalone");
  if (!fs.existsSync(standaloneRoot)) throw new Error(`missing standalone output: ${standaloneRoot}`);
  writeRuntimeRegistration(standaloneRoot, registration);
  copyRuntimeAssets(outputRoot, standaloneRoot, profile.runtime.buildOutputDir);
  return { profile, ...createBuildMetadata(standaloneRoot, profile, templateSource) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (!options.site) throw new Error("--site is required");
    const registry = options.registry ? path.resolve(options.registry) : path.join(ROOT, "config/sites/registry.json");
    const result = buildSite(profileFilename(options.site), { dryRun: options.dryRun, registryFilename: fs.existsSync(registry) ? registry : null });
    process.stdout.write(`${JSON.stringify({ siteId: result.profile.siteId, ...(result.environment ? { environment: result.environment, mode: "preview" } : { artifactManifest: result.destination }) }, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
