import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILDREN = new Map();

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

export function fileSha256(filename) {
  return hash(fs.readFileSync(filename));
}

function listFiles(root) {
  const files = [];
  const walk = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`fixture artifact symlink is not allowed: ${name}`);
      if (entry.isDirectory()) walk(filename, name);
      else if (entry.isFile()) files.push({ name, filename });
      else throw new Error(`unsupported fixture artifact entry: ${name}`);
    }
  };
  walk(root);
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function directorySha256(root) {
  const digest = createHash("sha256");
  for (const entry of listFiles(root)) digest.update(entry.name).update("\0").update(fs.readFileSync(entry.filename));
  return digest.digest("hex");
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

function validateIdentity({ site, processName, profileHash, artifactRoot, port }) {
  safeSite(site);
  if (processName !== `dashboard-${site}`) throw new Error(`process metadata is outside fixture scope: ${processName}`);
  requiredText(profileHash, "profileHash");
  if (artifactRoot !== undefined) {
    if (!fs.existsSync(artifactRoot) || !fs.statSync(artifactRoot).isDirectory()) throw new Error("standalone fixture artifact directory is required");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("fixture process port is invalid");
  }
}

function publish({ root, site, processName, artifact, profileHash, releaseId, action }) {
  const options = arguments[0];
  validateIdentity(options);
  requiredText(releaseId, "releaseId");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(releaseId)) throw new TypeError("releaseId is unsafe");
  const base = siteRoot(root, site);
  const release = path.join(base, "releases", releaseId);
  if (fs.existsSync(release)) throw new Error(`fixture release already exists: ${releaseId}`);
  fs.mkdirSync(release, { recursive: true });
  let artifactSha256;
  let artifactKind = "bytes";
  if (options.artifactRoot !== undefined) {
    const standalone = path.join(release, "standalone");
    fs.cpSync(options.artifactRoot, standalone, { recursive: true, dereference: false });
    artifactSha256 = directorySha256(standalone);
    artifactKind = "standalone";
  } else {
    const bytes = artifactBytes(artifact);
    artifactSha256 = hash(bytes);
    fs.writeFileSync(path.join(release, "artifact.bin"), bytes, { mode: 0o640 });
  }
  atomicJson(path.join(release, "manifest.json"), { site, processName, releaseId, artifactSha256, profileHash, artifactKind, ...(options.port ? { port: options.port } : {}) });
  const current = { releaseId, artifactSha256, profileHash, processName, processStartMarker: `${processName}:${releaseId}`, ...(artifactKind === "standalone" ? { artifactKind, port: options.port } : {}) };
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
  if (options.artifactRoot !== undefined && isRunning(options.root, options.site)) return updateRunningFixture(options);
  return publish({ ...options, action: "update" });
}

function rollbackState({ root, site, releaseId }) {
  safeSite(site);
  requiredText(releaseId, "releaseId");
  const base = siteRoot(root, site);
  const release = path.join(base, "releases", releaseId, "manifest.json");
  if (!fs.existsSync(release)) throw new Error(`fixture rollback release is unavailable: ${releaseId}`);
  const manifest = JSON.parse(fs.readFileSync(release, "utf8"));
  const current = { releaseId: manifest.releaseId, artifactSha256: manifest.artifactSha256, profileHash: manifest.profileHash, processName: manifest.processName, processStartMarker: `${manifest.processName}:${manifest.releaseId}`, ...(manifest.artifactKind === "standalone" ? { artifactKind: "standalone", port: manifest.port } : {}) };
  atomicJson(path.join(base, "current.json"), current);
  const history = readJson(path.join(base, "history.json"), []);
  history.push({ action: "rollback", ...current });
  atomicJson(path.join(base, "history.json"), history);
  return current;
}

export function rollbackLocalFixture(options) {
  if (options.artifactRoot !== undefined && isRunning(options.root, options.site)) return rollbackRunningFixture(options);
  return rollbackState(options);
}

function processFilename(root, site) {
  return path.join(siteRoot(root, site), "process.json");
}

function processKey(root, site) {
  return `${path.resolve(root)}:${safeSite(site)}`;
}

function isRunning(root, site) {
  const processInfo = readJson(processFilename(root, site), null);
  if (!processInfo?.pid) return false;
  try { process.kill(processInfo.pid, 0); return true; } catch { return false; }
}

function waitForExit(child, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function waitForPidExit(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function stopLocalFixture({ root, site }) {
  const filename = processFilename(root, site);
  const processInfo = readJson(filename, null);
  if (!processInfo?.pid) return false;
  const child = CHILDREN.get(processKey(root, site));
  try {
    if (child) child.kill("SIGTERM");
    else process.kill(processInfo.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (child) await waitForExit(child);
  else await waitForPidExit(processInfo.pid);
  CHILDREN.delete(processKey(root, site));
  fs.rmSync(filename, { force: true });
  return true;
}

export async function startLocalFixture({ root, site }) {
  const base = siteRoot(root, site);
  const current = readJson(path.join(base, "current.json"), null);
  if (!current || current.artifactKind !== "standalone") throw new Error("standalone fixture release is not active");
  if (isRunning(root, site)) throw new Error("fixture process is already running");
  const server = path.join(base, "releases", current.releaseId, "standalone", "server.mjs");
  if (!fs.existsSync(server)) throw new Error("standalone fixture server is missing");
  const startedAt = Date.now();
  const child = spawn(process.execPath, [server], {
    cwd: path.dirname(server),
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(current.port), SITE_SEO_FIXTURE_SITE: site, SITE_SEO_FIXTURE_RELEASE: current.releaseId },
    stdio: "ignore",
  });
  child.unref();
  const processInfo = { pid: child.pid, port: current.port, releaseId: current.releaseId, profileHash: current.profileHash, processName: current.processName, processStartMarker: `${current.processName}:${current.releaseId}:${startedAt}`, healthUrl: `http://127.0.0.1:${current.port}/health` };
  CHILDREN.set(processKey(root, site), child);
  atomicJson(processFilename(root, site), processInfo);
  const updatedCurrent = { ...current, processStartMarker: processInfo.processStartMarker };
  atomicJson(path.join(base, "current.json"), updatedCurrent);
  try {
    await healthCheckLocalFixture({ root, site, timeoutMs: 3000 });
  } catch (error) {
    await stopLocalFixture({ root, site });
    throw error;
  }
  return processInfo;
}

export async function healthCheckLocalFixture({ root, site, timeoutMs = 1500 }) {
  const processInfo = readJson(processFilename(root, site), null);
  if (!processInfo?.healthUrl) throw new Error("fixture process is not running");
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(processInfo.healthUrl, { signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))) });
      if (!response.ok) throw new Error(`health status ${response.status}`);
      const body = await response.json();
      if (body.site !== site || body.release !== processInfo.releaseId) throw new Error("health identity mismatch");
      return { ...body, releaseId: body.release };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  throw new Error(`fixture health check failed: ${lastError?.message || "timeout"}`);
}

async function updateRunningFixture(options) {
  await stopLocalFixture(options);
  publish({ ...options, action: "update" });
  await startLocalFixture({ root: options.root, site: options.site });
  return readJson(path.join(siteRoot(options.root, options.site), "current.json"), null);
}

async function rollbackRunningFixture(options) {
  await stopLocalFixture(options);
  rollbackState(options);
  await startLocalFixture({ root: options.root, site: options.site });
  return readJson(path.join(siteRoot(options.root, options.site), "current.json"), null);
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

async function main() {
  const options = parse(process.argv.slice(2));
  const action = options.action;
  if (!["deploy", "update", "rollback", "start", "health", "stop"].includes(action)) throw new Error("--action must be deploy, update, rollback, start, health, or stop");
  const common = { root: options.root, site: options.site, processName: options.process, profileHash: options["profile-hash"], releaseId: options["release-id"], port: options.port ? Number(options.port) : undefined, artifactRoot: options["artifact-root"] };
  const result = action === "rollback" ? rollbackLocalFixture(common) : action === "deploy" ? deployLocalFixture({ ...common, artifact: options.artifact }) : action === "update" ? updateLocalFixture({ ...common, artifact: options.artifact }) : action === "start" ? startLocalFixture(common) : action === "health" ? healthCheckLocalFixture(common) : stopLocalFixture(common);
  process.stdout.write(`${JSON.stringify(await result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
