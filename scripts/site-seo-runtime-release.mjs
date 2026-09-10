import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = ["siteId", "releaseBranch", "processName", "port", "deployPath", "deployLockPath"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function text(value, key) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${key} is required`);
  return value;
}

export function validateRuntimeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("runtime manifest must be an object");
  for (const key of REQUIRED.filter((key) => key !== "port")) text(manifest[key], key);
  if (!/^site-[a-z0-9-]+$/.test(manifest.siteId)) throw new TypeError("siteId is invalid");
  const slug = manifest.siteId.slice("site-".length);
  if (manifest.releaseBranch !== `release/${slug}`) throw new TypeError("releaseBranch must be pinned to the site");
  if (manifest.processName !== `dashboard-${slug}`) throw new TypeError("processName is outside site scope");
  if (!Number.isInteger(manifest.port) || manifest.port < 1024 || manifest.port > 65535) throw new TypeError("port is invalid");
  if (manifest.deployPath !== `/var/www/dashboard-${slug}`) throw new TypeError("deployPath is outside site scope");
  if (manifest.deployLockPath !== `/var/www/.dashboard-${slug}-deploy.lock`) throw new TypeError("deployLockPath is outside site scope");
  if (manifest.processName === "dashboard-zaruku" || manifest.deployPath.includes("dashboard-zaruku")) throw new TypeError("foreign runtime scope");
  return manifest;
}

export function planRuntimeAction(manifest, action) {
  validateRuntimeManifest(manifest);
  if (!["deploy", "rollback"].includes(action)) throw new TypeError("action must be deploy or rollback");
  return { action, siteId: manifest.siteId, processName: manifest.processName, deployPath: manifest.deployPath };
}

export function assertReleaseLineage(manifest, repository) {
  validateRuntimeManifest(manifest);
  if (!repository || repository.siteId !== manifest.siteId || repository.ref !== `refs/heads/${manifest.releaseBranch}` || repository.base === undefined) throw new Error("release lineage is not bound to the site branch");
  if (repository.approvedPredecessor !== null && (typeof repository.approvedPredecessor !== "string" || !/^[a-f0-9]{7,64}$/i.test(repository.approvedPredecessor))) throw new Error("invalid approved predecessor");
  return true;
}

export function readReleaseManifest(filename) {
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  return validateRuntimeManifest(manifest);
}

function parse(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--preview") result.preview = true;
    else if (argument.startsWith("--")) result[argument.slice(2)] = argv[++index];
    else throw new Error(`unexpected argument: ${argument}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (!options.manifest || !options.action) throw new Error("--manifest and --action are required");
    if (!options.preview) throw new Error("live deploy/rollback is disabled in this fixture policy; use --preview");
    const manifest = readReleaseManifest(path.resolve(options.manifest));
    const repositoryPath = options.repository ? path.resolve(options.repository) : path.join(ROOT, "deploy", manifest.siteId.replace(/^site-/, ""), "repository.json");
    const repository = JSON.parse(fs.readFileSync(repositoryPath, "utf8"));
    assertReleaseLineage(manifest, repository);
    process.stdout.write(`${JSON.stringify(planRuntimeAction(manifest, options.action))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
