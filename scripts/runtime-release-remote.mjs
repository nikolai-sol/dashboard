// Transported from the clean reviewed checkout, never loaded from a release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const BASE = '/var/www';
const DEPLOY_UID = 0;
const DEPLOY_GID = 0;
const APP = `${BASE}/dashboard-zaruku`;
const RELEASES = `${BASE}/dashboard-zaruku-releases`;
const BACKUPS = `${BASE}/dashboard-zaruku-backups`;
const CONTROL = `${BASE}/.dashboard-zaruku-control`;
const LOCK = `${BASE}/.dashboard-zaruku-deploy.lock`;
const CURRENT = `${CONTROL}/current.json`;
export const HOST_DIRECTORY_MODES = Object.freeze({
  [RELEASES]: 0o711,
  [BACKUPS]: 0o711,
  [CONTROL]: 0o700,
  [`${BASE}/.dashboard-zaruku-secrets`]: 0o700,
  [`${BASE}/.dashboard-zaruku-shadow`]: 0o700,
  [`${BASE}/.dashboard-zaruku-shadow/evidence`]: 0o700,
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
export const ENV_KEYS = Object.freeze([
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB',
  'NODE_ENV', 'HOSTNAME', 'PORT', 'NEXT_PUBLIC_BASE_URL', 'DASHBOARD_AUTH_SECRET',
  'INTERNAL_BASE_URL', 'PUPPETEER_EXECUTABLE_PATH',
]);
export const SECRET_INPUT_KEYS = Object.freeze([
  'ZARUKU_DB_HOST', 'ZARUKU_DB_PORT', 'ZARUKU_DB_USER', 'ZARUKU_DB_PASSWORD', 'ZARUKU_DB_NAME',
  'DASHBOARD_AUTH_SECRET', 'NEXT_PUBLIC_BASE_URL', 'PUPPETEER_EXECUTABLE_PATH',
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
  const stat = fs.lstatSync(filename);
  if (stat.gid !== DEPLOY_GID || (stat.mode & 0o7777) !== mode) fail('Unsafe exact deploy directory mode');
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

// Read-only use of the same sealed active-tree authority used by deployment.
export { current as inspectActiveRuntime };

export function renderEnvironment(source) {
  if (!source || typeof source !== 'object' || Object.keys(source).some(key => !SECRET_INPUT_KEYS.includes(key))) fail('Invalid Zaruku credential input keys');
  const get = (key, fallback) => {
    const value = source[key] ?? fallback;
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f'"\\`]/.test(value)) fail(`Missing required or invalid Zaruku environment key: ${key}`);
    return value;
  };
  const host = get('ZARUKU_DB_HOST'), port = get('ZARUKU_DB_PORT');
  const user = get('ZARUKU_DB_USER'), password = get('ZARUKU_DB_PASSWORD'), db = get('ZARUKU_DB_NAME');
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

export function parseZarukuSecrets(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) fail('Invalid credential file');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.endsWith('\n')) fail('Invalid credential file');
    const source = {};
    for (const line of text.slice(0, -1).split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\u0000-\u001f\u007f]*)'$/.exec(line);
      if (!match || !SECRET_INPUT_KEYS.includes(match[1]) || Object.hasOwn(source, match[1])) fail('Invalid credential file');
      source[match[1]] = match[2];
    }
    renderEnvironment(source);
    return source;
  } catch { fail('Missing or unsafe dedicated Zaruku credential file'); }
}

export function serializeZarukuSecrets(source) {
  renderEnvironment(source);
  const bytes = Buffer.from(Object.entries(source).map(([key, value]) => `${key}='${value}'\n`).join(''));
  parseZarukuSecrets(bytes);
  return bytes;
}

export function readZarukuSecrets() {
  try {
    const filename = `${BASE}/.dashboard-zaruku-secrets/runtime.env`;
    owned(path.dirname(filename), true);
    if (fs.lstatSync(path.dirname(filename)).mode & 0o077) fail('Unsafe credential directory');
    owned(filename);
    if (fs.lstatSync(filename).size > 65536) fail('Oversized credential file');
    const bytes = stableRead(filename, true);
    return parseZarukuSecrets(bytes);
  } catch { fail('Missing or unsafe dedicated Zaruku credential file'); }
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

// Application code is reached only after the fixed OS privilege drop and this
// trusted bootstrap attest the kernel identity. The privileged parent retains
// private manifest access; none of its credentials or authority paths are passed.
export function normalizeBootEnvironment(env) {
  // The pinned amd64 execution runtime inserts this exact libuv opt-out even
  // after env -i. No other inherited or runtime-created setting is tolerated.
  if (Object.hasOwn(env, 'UV_USE_IO_URING')) {
    if (env.UV_USE_IO_URING !== '0') throw new Error('Zaruku boot environment mismatch');
    delete env.UV_USE_IO_URING;
  }
  if (Object.keys(env).sort().join(',') !== 'HOSTNAME,NODE_ENV,PORT' || env.NODE_ENV !== 'production' || env.HOSTNAME !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(env.PORT) || Number(env.PORT) > 65535) throw new Error('Zaruku boot environment mismatch');
}

const BOOT_IDENTITY_BOOTSTRAP = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [uidText, gidText, server] = process.argv.slice(1);
const uid = Number(uidText), gid = Number(gidText);
const status = fs.readFileSync('/proc/self/status', 'utf8');
const groups = /^Groups:[\t ]*([^\r\n]*)$/m.exec(status)?.[1].trim();
for (const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) {
  if (!new RegExp('^' + name + ':[\\t ]*0+$', 'm').test(status)) throw new Error('Zaruku boot capabilities were retained');
}
if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0 ||
    process.getuid() !== uid || process.geteuid() !== uid || process.getgid() !== gid || process.getegid() !== gid ||
    groups !== '' || !/^NoNewPrivs:[\t ]*1$/m.test(status) ||
    process.getgroups().some(group => group !== gid) || fs.realpathSync(process.cwd()) !== path.dirname(server)) {
  throw new Error('Zaruku boot privilege identity mismatch');
}
fs.writeSync(3, JSON.stringify({uid,gid,euid:process.geteuid(),egid:process.getegid(),supplementaryGroups:[],cwd:fs.realpathSync(process.cwd())}) + '\n');
fs.closeSync(3);
(${normalizeBootEnvironment.toString()})(process.env);
require(server);
`;

function attestBootProcess(pid, account, cwd) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  for (const [key, expected] of [['Uid', account.uid], ['Gid', account.gid]]) {
    const values = new RegExp(`^${key}:[\\t ]*(\\d+)[\\t ]+(\\d+)[\\t ]+(\\d+)[\\t ]+(\\d+)$`, 'm').exec(status);
    if (!values || values.slice(1).some(value => Number(value) !== expected)) fail('Zaruku boot kernel identity mismatch');
  }
  if (!/^Groups:[\t ]*$/m.test(status) || !/^NoNewPrivs:[\t ]*1$/m.test(status) || fs.realpathSync(`/proc/${pid}/cwd`) !== cwd) fail('Zaruku boot kernel groups/cwd mismatch');
  for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) if (!new RegExp(`^${name}:[\\t ]*0+$`, 'm').test(status)) fail('Zaruku boot kernel capabilities mismatch');
}

export async function bootRuntimeAsService(artifact) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || process.geteuid() !== 0) fail('Zaruku service boot requires a privileged Linux verifier');
  const account = realPlatform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || !Number.isInteger(account.gid) || account.gid <= 0) fail('Invalid fixed service-account identity');
  // No environment or positional argument can replace the reviewed mechanism.
  const mechanism = '/usr/bin/setpriv';
  const environmentBoundary = '/usr/bin/env';
  owned(mechanism); owned(environmentBoundary); owned(process.execPath);
  const cwd = `${artifact}/apps/zaruku`, server = `${cwd}/server.js`;
  owned(artifact, true); owned(cwd, true); owned(server);
  const port = await new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close(error => error ? reject(error) : resolve(port));
    });
  });
  const child = spawn(mechanism, [
    `--reuid=${account.uid}`, `--regid=${account.gid}`, '--clear-groups', '--no-new-privs',
    '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--',
    environmentBoundary, '-i', 'NODE_ENV=production', 'HOSTNAME=127.0.0.1', `PORT=${port}`,
    process.execPath, '--input-type=commonjs', '-e', BOOT_IDENTITY_BOOTSTRAP, String(account.uid), String(account.gid), server,
  ], { cwd, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
  let childError = false, message = '', identity;
  child.once('error', () => { childError = true; });
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stdio[3].on('data', chunk => {
    message += chunk.toString('utf8');
    if (message.length > 4096) { childError = true; return; }
    if (!message.endsWith('\n')) return;
    try {
      const value = JSON.parse(message);
      if (value.uid !== account.uid || value.euid !== account.uid || value.gid !== account.gid || value.egid !== account.gid ||
          !Array.isArray(value.supplementaryGroups) || value.supplementaryGroups.length || value.cwd !== cwd) fail('Boot identity mismatch');
      identity = value;
    } catch { childError = true; }
  });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && child.exitCode === null && !childError) {
      if (identity) {
        attestBootProcess(child.pid, account, cwd);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
          const body = await response.text();
          if (response.status === 200 && body.length < 1024 && JSON.stringify(JSON.parse(body)) === '{"ok":true,"scope":"zaruku"}') {
            attestBootProcess(child.pid, account, cwd);
            return identity;
          }
        } catch { /* A bounded startup retry; never display child output. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fail('Zaruku unprivileged boot identity/health check failed');
  } finally {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 1000);
    await closed;
    clearTimeout(force);
  }
}

export async function verifyStagedArtifact(artifact, manifest, boot) {
  const code = `${path.dirname(manifest)}/scripts/runtime-artifact-policy.mjs`;
  const args = [code, 'zaruku', artifact, '--trusted-manifest', manifest];
  command(process.execPath, args);
  if (boot) {
    await bootRuntimeAsService(artifact);
    command(process.execPath, args);
  }
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
  verify: verifyStagedArtifact,
  secrets: readZarukuSecrets,
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
  snapshot() {
    const matches = JSON.parse(command('pm2',['jlist'])).filter(row=>row.name==='dashboard-zaruku');
    if (!matches.length || matches.length===1 && matches[0].pid===0 && matches[0].pm2_env?.status==='stopped') return null;
    const proof=captureRuntimeIdentity(matches,realPlatform.account(),filename=>fs.readFileSync(filename,'utf8'),filename=>fs.realpathSync(filename),command('ss',['-ltnpH','( sport = :3002 )']));
    const second=JSON.parse(command('pm2',['jlist'])).filter(row=>row.name==='dashboard-zaruku');
    if(second.length!==1||second[0].pid!==proof.pid||second[0].pm_id!==proof.pmId)fail('Runtime identity changed');
    return proof;
  },
  async stop(pmId) {
    if(!Number.isSafeInteger(pmId)||pmId<0)fail('Owned PM2 identity required');
    command('pm2', ['stop', String(pmId)]); command('pm2', ['save']);
  },
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

export function captureRuntimeIdentity(processes,account,readText,readCwd,listeners) {
  assertRuntimeProcess(processes,account,readText,readCwd);
  const process=processes[0];
  if(!Number.isSafeInteger(process.pm_id)||process.pm_id<0)fail('Runtime identity mismatch');
  const stat=()=>{const text=readText(`/proc/${process.pid}/stat`),close=text.lastIndexOf(')');const fields=text.slice(close+2).trim().split(/\s+/);if(close<0||!/^\d+$/.test(fields[19]??''))fail('Runtime start identity mismatch');return fields[19];};
  const startTime=stat(),bootId=readText('/proc/sys/kernel/random/boot_id').trim();
  if(!/^[a-f0-9-]{36}$/.test(bootId))fail('Runtime boot identity mismatch');
  const rows=listeners.trim().split('\n');
  if(rows.length!==1||rows[0].trim().split(/\s+/)[3]!=='127.0.0.1:3002'||[...rows[0].matchAll(/pid=(\d+)/g)].map(match=>Number(match[1])).some(pid=>pid!==process.pid)||!rows[0].includes(`pid=${process.pid},`))fail('Runtime listener ownership mismatch');
  assertRuntimeProcess(processes,account,readText,readCwd);
  if(stat()!==startTime)fail('Runtime PID reused');
  return {pid:process.pid,pmId:process.pm_id,startTime,bootId,uid:account.uid,gid:account.gid,cwd:readCwd(`/proc/${process.pid}/cwd`),listener:'127.0.0.1:3002'};
}

function bindingValid(binding) {
  if(!binding||Object.keys(binding).sort().join(',')!=='runId,sourceSha'||!SHA.test(binding.sourceSha)||!UUID.test(binding.runId))fail('Invalid deployment ownership binding');
}
function processProof(platform,account) {
  const value=platform.snapshot();
  if(value===null)return null;
  if(!value||Object.keys(value).sort().join(',')!=='bootId,cwd,gid,listener,pid,pmId,startTime,uid'||!Number.isSafeInteger(value.pid)||value.pid<=0||!Number.isSafeInteger(value.pmId)||value.pmId<0||!/^\d+$/.test(value.startTime)||!/^[a-f0-9-]{36}$/.test(value.bootId)||value.uid!==account.uid||value.gid!==account.gid||value.cwd!==`${APP}/apps/zaruku`||value.listener!=='127.0.0.1:3002')fail('Invalid deployment process ownership');
  return value;
}
const directoryIdentity=()=>{owned(APP,true);const stat=fs.lstatSync(APP);return {dev:String(stat.dev),ino:String(stat.ino)};};
function durableFile(filename,value) {
  createFile(filename,JSON.stringify(value)+'\n');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
async function stopProof(proof,platform,account,guard) {
  if(!proof)fail('No owned deployment process');
  guard();
  if(!isDeepStrictEqual(processProof(platform,account),proof))fail('Deployment ownership changed; no stop');
  await platform.stop(proof.pmId);
}
async function stopOwned(binding,platform,account,guard) {
  bindingValid(binding);
  const filename=`${CONTROL}/ownership-${binding.runId}.json`;
  if(!fs.lstatSync(filename,{throwIfNoEntry:false}))return {passed:true,stopped:false};
  owned(filename);const stat=fs.lstatSync(filename);
  if(stat.gid!==DEPLOY_GID||(stat.mode&0o7777)!==0o600||stat.size>8192)fail('Unsafe deployment receipt');
  const receipt=JSON.parse(stableRead(filename,true));
  if(Object.keys(receipt).sort().join(',')!=='binding,directory,process,record,transaction,version'||receipt.version!==1||!UUID.test(receipt.transaction)||!isDeepStrictEqual(receipt.binding,binding)||receipt.record?.sourceSha!==binding.sourceSha||!isDeepStrictEqual(current(),receipt.record)||!isDeepStrictEqual(directoryIdentity(),receipt.directory))fail('Deployment receipt no longer owns active release');
  attestTree(APP,receipt.record);
  await stopProof(receipt.process,platform,account,guard);
  return {passed:true,stopped:true};
}

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

export async function transact(request, platform = realPlatform, stagedGuard) {
  if (platform === realPlatform && typeof stagedGuard !== 'function') fail('Use the staged dispatcher');
  const guard = stagedGuard ?? (() => {});
  guard();
  if (process.getuid() !== DEPLOY_UID) fail('Privileged deploy account required');
  const account = platform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || account.uid === DEPLOY_UID || !Number.isInteger(account.gid) || account.gid <= 0) fail('Dedicated runtime account and write separation required');
  owned(BASE, true);
  const owner = randomUUID();
  try { fs.mkdirSync(LOCK, { mode: 0o700 }); } catch { fail('Zaruku deployment lock is already held or unsafe'); }
  createFile(`${LOCK}/owner`, owner);
  try {
    for (const dir of [RELEASES, BACKUPS, CONTROL]) ensureDirectory(dir, HOST_DIRECTORY_MODES[dir]);
    if(request.action==='stop-owned')return await stopOwned(request.binding,platform,account,guard);
    const old = current();
    if (request.action === 'inspect') return old;
    if ((old?.sourceSha ?? null) !== request.expectedActiveSha) fail('Active Zaruku SHA changed; recheck source ancestry');
    if (request.action !== 'deploy' && request.action !== 'rollback') fail('Invalid fixed release action');
    if(platform===realPlatform&&request.action==='deploy')bindingValid(request.binding);
    if(request.binding){bindingValid(request.binding);if(request.payload?.sourceSha!==request.binding.sourceSha||fs.lstatSync(`${CONTROL}/ownership-${request.binding.runId}.json`,{throwIfNoEntry:false}))fail('Deployment binding source or run reuse mismatch');}
    const beforeProcess=processProof(platform,account);
    if(!old&&beforeProcess)fail('Unowned process exists before deployment');
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
    guard();
    // Pin is retained in memory from transport (deploy) or protected record (rollback).
    // Replacing both manifest and its sidecar cannot change this activation authority.
    attestTree(stage, record);
    if (hash(stableRead(`${stage}/.env`)) !== envDigest) fail('Runtime environment changed during verification');
    if (old) attestTree(APP, old);
    const oldBackup = old ? `${BACKUPS}/${old.id}` : null;
    if (oldBackup && fs.lstatSync(oldBackup, { throwIfNoEntry: false })) fail('Predecessor backup collision');
    let oldMoved = false, candidateMoved = false, started = false, ownedProcess=null;
    try {
      if (old) { fs.renameSync(APP, oldBackup); oldMoved = true; }
      fs.renameSync(stage, APP); candidateMoved = true;
      guard();
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during activation');
      await platform.start(`${CONTROL}/${record.id}`);
      started=true;
      const candidateProcess=processProof(platform,account);
      if(!candidateProcess||isDeepStrictEqual(candidateProcess,beforeProcess))fail('New deployment process was not established');
      ownedProcess=candidateProcess;
      await platform.health();
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during health verification');
      publishPointer(record);
      if(request.binding) {
        if(!isDeepStrictEqual(processProof(platform,account),ownedProcess))fail('Deployment ownership changed after health');
        durableFile(`${CONTROL}/ownership-${request.binding.runId}.json`,{version:1,binding:request.binding,transaction:owner,record,directory:directoryIdentity(),process:ownedProcess});
      }
      return record;
    } catch {
      let rollbackCandidateNeedsRecovery = false;
      try {
        if(candidateMoved&&started)await stopProof(ownedProcess,platform,account,guard);
        if(candidateMoved&&!started&&beforeProcess===null&&processProof(platform,account)!==null)fail('Ambiguous startup ownership; no stop');
        if (candidateMoved) {
          // A manual rollback borrows its predecessor from BACKUPS. Return that
          // exact artifact to its authoritative slot so current.previousId stays
          // usable after transient startup/health failures and a retry is safe.
          let destination = `${RELEASES}/${record.id}-failed-${randomUUID()}`;
          if (request.action === 'rollback') {
            try {
              attestTree(APP, record);
              if (hash(stableRead(`${APP}/.env`)) !== envDigest || fs.lstatSync(stage, { throwIfNoEntry: false })) fail('Rollback backup slot is unavailable');
              destination = stage;
            } catch { rollbackCandidateNeedsRecovery = true; }
          }
          owned(APP, true);
          if (fs.lstatSync(destination, { throwIfNoEntry: false })) fail('Recovery destination collision');
          fs.renameSync(APP, destination);
        }
        if (oldMoved) {
          attestTree(oldBackup, old);
          if (fs.lstatSync(APP, { throwIfNoEntry: false })) fail('Active recovery path is occupied');
          fs.renameSync(oldBackup, APP);
          // A failed start reply cannot authorize stopping/replacing an unknown
          // process. Preserve the exact predecessor only if still provably ours.
          if(!started&&beforeProcess&&!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Ambiguous predecessor identity');
          if(started||!beforeProcess)await platform.start(`${CONTROL}/${old.id}`);
          await platform.health(); attestTree(APP, old); publishPointer(old);
        }
      } catch { fail('Zaruku activation and predecessor restoration failed; ownership requires review'); }
      if (rollbackCandidateNeedsRecovery) fail('Current Zaruku release restored; rollback backup collision or integrity failure requires recovery');
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
