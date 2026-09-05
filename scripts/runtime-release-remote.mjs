// Transported from the clean reviewed checkout, never loaded from a release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const BASE = '/var/www';
const DEPLOY_UID = 0;
const APP = `${BASE}/dashboard-zaruku`;
const RELEASES = `${BASE}/dashboard-zaruku-releases`;
const BACKUPS = `${BASE}/dashboard-zaruku-backups`;
const CONTROL = `${BASE}/.dashboard-zaruku-control`;
const LOCK = `${BASE}/.dashboard-zaruku-deploy.lock`;
const CURRENT = `${CONTROL}/current.json`;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
export const ENV_KEYS = Object.freeze([
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB',
  'NODE_ENV', 'HOSTNAME', 'PORT', 'NEXT_PUBLIC_BASE_URL', 'DASHBOARD_AUTH_SECRET',
  'INTERNAL_BASE_URL', 'PUPPETEER_EXECUTABLE_PATH',
]);

export function safeRelative(name) {
  if (typeof name !== 'string' || !name || name === '.' || name.length > 512 || path.posix.normalize(name) !== name || name.startsWith('/') || name.startsWith('../') || /[\\\u0000-\u0020:]/.test(name)) fail('Unsafe release path');
  return name;
}

function ancestors(filename) {
  for (let dir = path.dirname(filename);; dir = path.dirname(dir)) {
    const s = fs.lstatSync(dir);
    const alias = ['/tmp', '/var'].includes(dir) && s.isSymbolicLink() && fs.realpathSync(dir) === `/private${dir}`;
    const stickySystemTemp = ['/tmp', '/private/tmp'].includes(dir) && (s.mode & 0o1000) && s.uid === 0;
    if (!s.isDirectory() && !alias || !alias && (s.mode & 0o022) && !stickySystemTemp || ![0, process.getuid()].includes(s.uid)) fail('Unsafe directory ancestry');
    if (dir === path.dirname(dir)) break;
  }
}

export function readPinned(filename, digest) {
  ancestors(filename);
  const bytes = stableRead(filename, true);
  if (!DIGEST.test(digest) || hash(bytes) !== digest) fail('External authority digest mismatch');
  return bytes;
}

function stableRead(filename, privateFile = false) {
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 536870912n || privateFile && (Number(before.mode) & 0o077)) fail('Unsafe authority file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const content = fs.readFileSync(fd);
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(filename, { bigint: true })]) {
      if (['dev', 'ino', 'size', 'mode', 'ctimeNs', 'mtimeNs'].some(key => before[key] !== after[key])) fail('Authority file changed');
    }
    return content;
  } finally { fs.closeSync(fd); }
}

function owned(filename, directory = false) {
  const s = fs.lstatSync(filename);
  if ((directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) || s.uid !== DEPLOY_UID || s.mode & 0o022) fail('Unsafe deploy ownership or write separation');
  ancestors(filename);
}

function ensureDirectory(filename, mode = 0o755) {
  if (!fs.existsSync(filename)) { fs.mkdirSync(filename, { mode }); fs.chmodSync(filename, mode); }
  owned(filename, true);
}

function createFile(filename, bytes, mode = 0o600) {
  const missing = [];
  for (let dir = path.dirname(filename); !fs.existsSync(dir); dir = path.dirname(dir)) missing.push(dir);
  for (const dir of missing.reverse()) { fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755); }
  ancestors(filename);
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  fs.chmodSync(filename, mode);
}

function readRecord(id) {
  if (!ID.test(id)) fail('Invalid release identity');
  const filename = `${CONTROL}/${id}/record.json`;
  owned(filename);
  const record = JSON.parse(stableRead(filename, true));
  if (record.id !== id || record.scope !== 'zaruku' || !SHA.test(record.sourceSha) || !DIGEST.test(record.manifestDigest) || record.previousId !== null && !ID.test(record.previousId)) fail('Invalid Zaruku release authority');
  return record;
}

function attestTree(artifact, record) {
  owned(artifact, true);
  const manifestPath = `${CONTROL}/${record.id}/trusted-runtime-manifest.json`;
  owned(manifestPath);
  const manifest = JSON.parse(readPinned(manifestPath, record.manifestDigest));
  if (manifest.scope !== 'zaruku' || manifest.sourceSha !== record.sourceSha || !Array.isArray(manifest.files)) fail('Trusted source or scope mismatch');
  const entries = new Map();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    if (entries.has(entry.path) || entry.type !== 'file' || !DIGEST.test(entry.sha256) || !Number.isInteger(entry.mode) || entry.mode & 0o022 || entry.mode < 0 || entry.mode > 0o777 || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > 536870912) fail('Invalid trusted file authority');
    entries.set(entry.path, entry);
  }
  const seen = new Set();
  function visit(dir) {
    owned(dir, true);
    if ((fs.statSync(dir).mode & 0o005) !== 0o005) fail('Artifact directory must be readable by runtime');
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), s = fs.lstatSync(file);
      if (s.isDirectory()) { visit(file); continue; }
      owned(file);
      const relative = path.relative(artifact, file);
      const bytes = stableRead(file);
      if (relative === '.env') {
        if ((s.mode & 0o007) || bytes.length > 65536) fail('Unsafe runtime environment permissions');
      } else {
        if (!(s.mode & 0o004)) fail('Artifact file must be readable by runtime');
        const entry = entries.get(relative);
        if (!entry || bytes.length !== entry.size || hash(bytes) !== entry.sha256 || (s.mode & 0o777) !== entry.mode) fail('Artifact no longer matches external authority');
        seen.add(relative);
      }
    }
  }
  visit(artifact);
  for (const [name, entry] of entries) if (entry.required && !seen.has(name)) fail('Missing trusted artifact file');
  if (stableRead(`${artifact}/.release-source-sha`).toString() !== `${record.sourceSha}\n` || stableRead(`${artifact}/.release-runtime-scope`).toString() !== 'zaruku\n') fail('Invalid exact Zaruku scope/source metadata');
  return manifestPath;
}

function current() {
  const appExists = fs.existsSync(APP) || fs.lstatSync(APP, { throwIfNoEntry: false });
  if (!fs.existsSync(CURRENT)) {
    if (appExists) fail('Active Zaruku release has no independent deploy authority');
    return null;
  }
  owned(CURRENT);
  const pointer = JSON.parse(stableRead(CURRENT, true));
  const record = readRecord(pointer.id);
  if (JSON.stringify(record) !== JSON.stringify(pointer)) fail('Active authority mismatch');
  attestTree(APP, record);
  return record;
}

export function renderEnvironment(source) {
  const get = (key, fallback) => {
    const value = source[key] ?? fallback;
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f'"\\`]/.test(value)) fail(`Missing required or invalid Zaruku environment key: ${key}`);
    return value;
  };
  const host = get('MYSQL_HOST', 'localhost'), port = get('MYSQL_PORT', '3306');
  const user = get('MYSQL_USER'), password = get('MYSQL_PASSWORD'), db = get('MYSQL_DB');
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) fail('Invalid database port');
  const result = {
    DB_HOST: host, DB_PORT: port, DB_USER: user, DB_PASSWORD: password, DB_NAME: db,
    MYSQL_HOST: host, MYSQL_PORT: port, MYSQL_USER: user, MYSQL_PASSWORD: password, MYSQL_DB: db,
    NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3002',
    NEXT_PUBLIC_BASE_URL: get('NEXT_PUBLIC_BASE_URL', 'https://dashboards.adreports.ru'),
    DASHBOARD_AUTH_SECRET: get('DASHBOARD_AUTH_SECRET'), INTERNAL_BASE_URL: 'http://127.0.0.1:3002',
  };
  if (source.PUPPETEER_EXECUTABLE_PATH) result.PUPPETEER_EXECUTABLE_PATH = get('PUPPETEER_EXECUTABLE_PATH');
  return result;
}

const commandEnv = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir(), PM2_HOME: path.join(os.homedir(), '.pm2') });
function command(bin, args) {
  try { return execFileSync(bin, args, { encoding: 'utf8', env: commandEnv(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch { fail('Zaruku operating system command failed'); }
}

export function assertRuntimeProcess(processes, account, readStatus = filename => fs.readFileSync(filename, 'utf8'), readCwd = filename => fs.realpathSync(filename)) {
  const matches = processes.filter(item => item.name === 'dashboard-zaruku');
  if (matches.length !== 1 || !Number.isInteger(matches[0].pid) || matches[0].pid <= 0) fail('Runtime process identity mismatch');
  const status = readStatus(`/proc/${matches[0].pid}/status`);
  for (const [field, expected] of [['Uid', account.uid], ['Gid', account.gid]]) {
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`, 'm').exec(status);
    if (!match || match.slice(1).some(value => Number(value) !== expected)) fail('Runtime process identity mismatch');
  }
  if (readCwd(`/proc/${matches[0].pid}/cwd`) !== `${APP}/apps/zaruku`) fail('Runtime process is not in the active directory');
}

const realPlatform = {
  account() {
    const uid = Number(command('/usr/bin/id', ['-u', 'dashboard-zaruku']).trim());
    const groups = command('/usr/bin/id', ['-G', 'dashboard-zaruku']).trim().split(/\s+/).map(Number);
    const group = command('/usr/bin/getent', ['group', 'dashboard-zaruku']).trim().split(':');
    const gid = Number(group[2]);
    if (groups.some(value => value === 0) || group[0] !== 'dashboard-zaruku' || groups.length !== 1 || groups[0] !== gid) fail('Runtime service account must have only its dedicated group');
    return { uid, gid };
  },
  chown: (filename, uid, gid) => fs.chownSync(filename, uid, gid),
  async verify(artifact, manifest, boot) {
    const code = `${path.dirname(manifest)}/scripts/runtime-artifact-policy.mjs`;
    command(process.execPath, [code, ...(boot ? ['--boot'] : []), 'zaruku', artifact, '--trusted-manifest', manifest]);
  },
  secrets(control) {
    // Existing reviewed secret location; values never leave this remote process.
    const filename = '/var/www/www-root/data/.production.env';
    owned(filename);
    // The parser is transported separately from the clean installation and loaded
    // from the private control tree, never from unverified artifact contents.
    const require = createRequire(`${control}/package.json`);
    const { parse } = require(`${control}/node_modules/dotenv/lib/main.js`);
    return parse(stableRead(filename, true));
  },
  async start(control) {
    const launcher = `${BASE}/.dashboard-zaruku-launcher.cjs`;
    const source = `${control}/deploy/zaruku/start.cjs`;
    if (fs.existsSync(launcher)) {
      owned(launcher);
      if (!stableRead(launcher).equals(stableRead(source))) fail('Launcher change requires separately reviewed process transition');
    } else createFile(launcher, stableRead(source), 0o644);
    command('pm2', ['startOrReload', `${control}/deploy/zaruku/ecosystem.config.cjs`, '--only', 'dashboard-zaruku', '--update-env']);
    command('pm2', ['save']);
  },
  async stop() { command('pm2', ['stop', 'dashboard-zaruku']); command('pm2', ['save']); },
  async health() {
    let healthy = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:3002/api/health', { redirect: 'error', signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        if (response.status === 200 && JSON.stringify(body) === '{"ok":true,"scope":"zaruku"}') { healthy = true; break; }
      } catch { /* Retry startup only; no response bodies or env diagnostics. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!healthy) fail('Zaruku health attestation failed');
    assertRuntimeProcess(JSON.parse(command('pm2', ['jlist'])), realPlatform.account());
    const rows = command('ss', ['-ltnH', '( sport = :3002 )']).trim().split('\n');
    if (!rows.length || rows.some(row => row.trim().split(/\s+/)[3] !== '127.0.0.1:3002')) fail('Zaruku listener is not exclusively loopback');
  },
};

function publishPointer(record) {
  const temporary = `${CONTROL}/current-${randomUUID()}.json`;
  createFile(temporary, JSON.stringify(record));
  fs.renameSync(temporary, CURRENT);
}

function materialize(payload, id, old, platform, account) {
  if (!payload || payload.scope !== 'zaruku' || !SHA.test(payload.sourceSha) || !DIGEST.test(payload.manifestDigest) || hash(payload.manifest) !== payload.manifestDigest) fail('Invalid trusted payload source/scope/digest');
  const manifest = JSON.parse(payload.manifest);
  if (manifest.scope !== 'zaruku' || manifest.sourceSha !== payload.sourceSha) fail('Payload source/scope binding failed');
  const control = `${CONTROL}/${id}`, stage = `${RELEASES}/${id}`;
  fs.mkdirSync(control, { mode: 0o700 }); fs.mkdirSync(stage, { mode: 0o755 }); fs.chmodSync(stage, 0o755);
  createFile(`${control}/trusted-runtime-manifest.json`, payload.manifest);
  createFile(`${control}/trusted-runtime-manifest.json.sha256`, payload.manifestDigest + '\n');
  for (const file of payload.control) {
    safeRelative(file.path);
    if (file.path === 'trusted-runtime-manifest.json' || file.path === 'record.json') fail('Control authority substitution');
    createFile(`${control}/${file.path}`, Buffer.from(file.data, 'base64'));
  }
  for (const file of payload.files) {
    safeRelative(file.path);
    if (file.path === '.env' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || file.mode & 0o022) fail('Unsafe packaged environment or mode');
    createFile(`${stage}/${file.path}`, Buffer.from(file.data, 'base64'), file.mode);
  }
  const env = renderEnvironment(platform.secrets(control));
  createFile(`${stage}/.env`, Object.entries(env).map(([key, value]) => `${key}='${value}'\n`).join(''), 0o640);
  platform.chown(`${stage}/.env`, DEPLOY_UID, account.gid);
  const record = { id, previousId: old?.id ?? null, scope: 'zaruku', sourceSha: payload.sourceSha, manifestDigest: payload.manifestDigest };
  createFile(`${control}/record.json`, JSON.stringify(record));
  return { record, stage };
}

export async function transact(request, platform = realPlatform) {
  if (process.getuid() !== DEPLOY_UID) fail('Privileged deploy account required');
  const account = platform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || account.uid === DEPLOY_UID || !Number.isInteger(account.gid) || account.gid <= 0) fail('Dedicated runtime account and write separation required');
  owned(BASE, true);
  const owner = randomUUID();
  try { fs.mkdirSync(LOCK, { mode: 0o700 }); } catch { fail('Zaruku deployment lock is already held or unsafe'); }
  createFile(`${LOCK}/owner`, owner);
  try {
    for (const dir of [RELEASES, BACKUPS, CONTROL]) ensureDirectory(dir, dir === CONTROL ? 0o700 : 0o755);
    const old = current();
    if (request.action === 'inspect') return old;
    if ((old?.sourceSha ?? null) !== request.expectedActiveSha) fail('Active Zaruku SHA changed; recheck source ancestry');
    if (request.action !== 'deploy' && request.action !== 'rollback') fail('Invalid fixed release action');
    let record, stage;
    if (request.action === 'deploy') ({ record, stage } = materialize(request.payload, randomUUID().replaceAll('-', ''), old, platform, account));
    else {
      if (!old?.previousId) fail('No attested Zaruku predecessor');
      record = readRecord(old.previousId); stage = `${BACKUPS}/${record.id}`;
    }
    const manifest = attestTree(stage, record);
    const envDigest = hash(stableRead(`${stage}/.env`));
    await platform.verify(stage, manifest, false);
    await platform.verify(stage, manifest, true);
    // Pin is retained in memory from transport (deploy) or protected record (rollback).
    // Replacing both manifest and its sidecar cannot change this activation authority.
    attestTree(stage, record);
    if (hash(stableRead(`${stage}/.env`)) !== envDigest) fail('Runtime environment changed during verification');
    if (old) attestTree(APP, old);
    const oldBackup = old ? `${BACKUPS}/${old.id}` : null;
    if (oldBackup && fs.lstatSync(oldBackup, { throwIfNoEntry: false })) fail('Predecessor backup collision');
    let oldMoved = false, candidateMoved = false;
    try {
      if (old) { fs.renameSync(APP, oldBackup); oldMoved = true; }
      fs.renameSync(stage, APP); candidateMoved = true;
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during activation');
      await platform.start(`${CONTROL}/${record.id}`);
      await platform.health();
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during health verification');
      publishPointer(record);
      return record;
    } catch {
      try {
        if (candidateMoved) fs.renameSync(APP, `${RELEASES}/${record.id}-failed-${randomUUID()}`);
        if (oldMoved) {
          attestTree(oldBackup, old); fs.renameSync(oldBackup, APP);
          await platform.start(`${CONTROL}/${old.id}`); await platform.health(); attestTree(APP, old); publishPointer(old);
        } else if (!old) await platform.stop();
      } catch { try { await platform.stop(); } catch { /* Preserve evidence, fail closed. */ } fail('Zaruku activation and predecessor restoration failed; service stop requested'); }
      fail(old ? 'Zaruku activation failed; attested predecessor restored' : 'Zaruku activation failed; service stopped');
    }
  } finally {
    owned(LOCK, true);
    if (stableRead(`${LOCK}/owner`, true).toString() !== owner || fs.readdirSync(LOCK).join() !== 'owner') fail('Zaruku lock ownership changed; preserved for recovery');
    fs.unlinkSync(`${LOCK}/owner`); fs.rmdirSync(LOCK);
  }
}

export async function remoteMain(expectedDigest) {
  try {
    if (!DIGEST.test(expectedDigest)) fail('Invalid transport authority');
    const bytes = fs.readFileSync(0);
    if (bytes.length > 536870912 || hash(bytes) !== expectedDigest) fail('Transport authority mismatch');
    const request = JSON.parse(bytes);
    // Inspection takes the same scope lock; no active metadata is read here.
    const record = await transact(request);
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch (error) {
    process.stderr.write(`Refusing Zaruku operation: ${error.message}\n`);
    process.exitCode = 1;
  }
}

// Only this fixed adapter is invoked by the SSH transport.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await remoteMain(process.argv[2]);
