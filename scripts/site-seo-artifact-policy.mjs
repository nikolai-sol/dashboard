import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = [
  "zaruku", "abbott", "report_bd_private", "api-metrika.yandex.net", "api.webmaster.yandex.net",
  "googleads.googleapis.com", "metrika_token", "yandex_direct_token", "oauth_token",
];

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be non-empty`);
  return value;
}
function sha(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new TypeError(`${label} must be SHA-256`);
  return value.toLowerCase();
}
export function validateArtifactManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("artifact manifest must be an object");
  if (value.schemaVersion !== 1) throw new TypeError("artifact schemaVersion must be 1");
  for (const key of ["siteId", "profileVersion", "templateVersion", "buildOutputDir", "assetPrefix", "route", "processName", "deployPath"]) text(value[key], key);
  if (value.templateSourceCommit !== undefined) {
    text(value.templateSourceCommit, "templateSourceCommit");
    if (value.templateSourceCommit !== value.templateVersion) throw new TypeError("artifact template source does not match profile templateVersion");
  }
  if (value.templateSourcePaths !== undefined && (!Array.isArray(value.templateSourcePaths) || value.templateSourcePaths.length === 0 || value.templateSourcePaths.some((entry) => typeof entry !== "string" || entry.includes("..")))) throw new TypeError("templateSourcePaths are invalid");
  const slug = value.siteId.replace(/^site-/, "");
  if (value.route !== `/dashboard/${slug}` || value.assetPrefix !== `/_next-${slug}` || value.buildOutputDir !== `.next-${slug}` || value.processName !== `dashboard-${slug}` || value.deployPath !== `/var/www/dashboard-${slug}`) throw new TypeError("artifact runtime identity is outside site scope");
  if (!Array.isArray(value.files) || value.files.length === 0) throw new TypeError("artifact files are required");
  const seen = new Set();
  for (const [index, file] of value.files.entries()) {
    if (!file || typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\") || file.path.includes("\0")) throw new TypeError(`invalid artifact file ${index}`);
    if (seen.has(file.path)) throw new TypeError(`duplicate artifact file ${file.path}`);
    seen.add(file.path);
    sha(file.sha256, `files[${index}].sha256`);
    const dependencyFile = /(^|\/)node_modules\//.test(file.path);
    if (/(^|\/)\.env(?:\.|$)/i.test(file.path) || (!dependencyFile && /(^|\/).*?(?:token|secret|credential).*?$/i.test(file.path))) {
      throw new TypeError(`secret-bearing artifact file: ${file.path}`);
    }
    if (FORBIDDEN.some((marker) => file.path.toLowerCase().includes(marker))) throw new TypeError(`foreign artifact file: ${file.path}`);
  }
  return value;
}

function filesUnder(root) {
  const result = [];
  const walk = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in artifact: ${name}`);
      if (entry.isDirectory()) walk(filename, name);
      else if (entry.isFile()) result.push(name);
      else throw new Error(`unsupported artifact entry: ${name}`);
    }
  };
  walk(root);
  return result;
}

export function inspectArtifactDirectory(root, manifest) {
  const errors = [];
  try { validateArtifactManifest(manifest); } catch (error) { errors.push(error.message); return errors; }
  let entries;
  try { entries = filesUnder(root); } catch (error) { return [error.message]; }
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry.sha256.toLowerCase()]));
  for (const filename of entries) {
    const lower = filename.toLowerCase();
    if (FORBIDDEN.some((marker) => lower.includes(marker))) errors.push(`foreign artifact path: ${filename}`);
    if (!expected.has(filename)) errors.push(`unmanifested artifact file: ${filename}`);
    else if (createHash("sha256").update(fs.readFileSync(path.join(root, filename))).digest("hex") !== expected.get(filename)) errors.push(`artifact hash mismatch: ${filename}`);
    const dependencyFile = /(^|\/)node_modules\//.test(filename);
    const packageMetadata = filename === "package.json" || filename.endsWith("/package.json");
    if (!dependencyFile && !packageMetadata && (filename.endsWith(".json") || filename.endsWith(".js") || filename.endsWith(".mjs") || filename.endsWith(".ts"))) {
      const content = fs.readFileSync(path.join(root, filename), "utf8").toLowerCase();
      if (FORBIDDEN.some((marker) => content.includes(marker))) errors.push(`foreign marker in artifact: ${filename}`);
    }
  }
  for (const filename of expected.keys()) if (!entries.includes(filename)) errors.push(`missing artifact file: ${filename}`);
  return errors;
}

export function createArtifactManifest(root, profile, { files = null } = {}) {
  const names = files || filesUnder(root);
  const value = {
    schemaVersion: 1, siteId: profile.siteId, profileVersion: profile.profileVersion, templateVersion: profile.templateVersion,
    buildOutputDir: profile.runtime.buildOutputDir, assetPrefix: profile.runtime.assetPrefix, route: profile.runtime.route,
    processName: profile.runtime.processName, deployPath: profile.runtime.deployPath,
    files: names.sort().map((filename) => ({ path: filename, sha256: createHash("sha256").update(fs.readFileSync(path.join(root, filename))).digest("hex") })),
  };
  validateArtifactManifest(value);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, artifactRoot] = process.argv.slice(2);
  if (!filename || !artifactRoot) {
    process.stderr.write("usage: node site-seo-artifact-policy.mjs MANIFEST ARTIFACT_ROOT\n");
    process.exitCode = 2;
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
      const errors = inspectArtifactDirectory(artifactRoot, manifest);
      if (errors.length) { process.stderr.write(`${errors.join("\n")}\n`); process.exitCode = 1; }
      else process.stdout.write("site-seo artifact policy: PASS\n");
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
