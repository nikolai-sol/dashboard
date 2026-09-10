import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function safeSite(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new TypeError("fixture site must be a safe slug");
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value;
}

function siteRoot(root, site) {
  return path.join(path.resolve(root), "sites", safeSite(site));
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  fs.renameSync(temporary, filename);
}

function readJson(filename, fallback) {
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : fallback;
}

function artifactBytes(artifact) {
  if (Buffer.isBuffer(artifact)) return artifact;
  if (typeof artifact !== "string") throw new TypeError("artifact must be bytes or a file path/content string");
  return fs.existsSync(artifact) && fs.statSync(artifact).isFile() ? fs.readFileSync(artifact) : Buffer.from(artifact);
}

function validateIdentity({ site, processName, profileHash }) {
  safeSite(site);
  if (processName !== `dashboard-${site}`) throw new Error(`process metadata is outside fixture scope: ${processName}`);
  requiredText(profileHash, "profileHash");
}

function publish({ root, site, processName, artifact, profileHash, releaseId, action }) {
  validateIdentity({ site, processName, profileHash });
  requiredText(releaseId, "releaseId");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(releaseId)) throw new TypeError("releaseId is unsafe");
  const base = siteRoot(root, site);
  const release = path.join(base, "releases", releaseId);
  if (fs.existsSync(release)) throw new Error(`fixture release already exists: ${releaseId}`);
  const bytes = artifactBytes(artifact);
  const artifactSha256 = hash(bytes);
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(release, "artifact.bin"), bytes, { mode: 0o640 });
  atomicJson(path.join(release, "manifest.json"), { site, processName, releaseId, artifactSha256, profileHash });
  const current = { releaseId, artifactSha256, profileHash, processName, processStartMarker: `${processName}:${releaseId}` };
  atomicJson(path.join(base, "current.json"), current);
  const history = readJson(path.join(base, "history.json"), []);
  history.push({ action, ...current });
  atomicJson(path.join(base, "history.json"), history);
  return current;
}

export function deployLocalFixture(options) {
  if (fs.existsSync(path.join(siteRoot(options.root, options.site), "current.json"))) throw new Error("fixture site is already deployed; use update");
  return publish({ ...options, action: "deploy" });
}

export function updateLocalFixture(options) {
  const base = siteRoot(options.root, options.site);
  if (!fs.existsSync(path.join(base, "current.json"))) throw new Error("fixture site is not deployed");
  return publish({ ...options, action: "update" });
}

export function rollbackLocalFixture({ root, site, releaseId }) {
  safeSite(site);
  requiredText(releaseId, "releaseId");
  const base = siteRoot(root, site);
  const release = path.join(base, "releases", releaseId, "manifest.json");
  if (!fs.existsSync(release)) throw new Error(`fixture rollback release is unavailable: ${releaseId}`);
  const manifest = JSON.parse(fs.readFileSync(release, "utf8"));
  const current = { releaseId: manifest.releaseId, artifactSha256: manifest.artifactSha256, profileHash: manifest.profileHash, processName: manifest.processName, processStartMarker: `${manifest.processName}:${manifest.releaseId}` };
  atomicJson(path.join(base, "current.json"), current);
  const history = readJson(path.join(base, "history.json"), []);
  history.push({ action: "rollback", ...current });
  atomicJson(path.join(base, "history.json"), history);
  return current;
}

export function readLocalFixture({ root, site }) {
  const base = siteRoot(root, site);
  return { current: readJson(path.join(base, "current.json"), null), history: readJson(path.join(base, "history.json"), []) };
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    options[argument.slice(2)] = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    const action = options.action;
    if (!["deploy", "update", "rollback"].includes(action)) throw new Error("--action must be deploy, update, or rollback");
    const common = { root: options.root, site: options.site, processName: options.process, profileHash: options["profile-hash"], releaseId: options["release-id"] };
    const result = action === "rollback" ? rollbackLocalFixture(common) : (action === "deploy" ? deployLocalFixture({ ...common, artifact: options.artifact }) : updateLocalFixture({ ...common, artifact: options.artifact }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
