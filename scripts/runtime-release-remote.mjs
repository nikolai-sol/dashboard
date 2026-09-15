// Transported from the clean reviewed checkout, never loaded from a release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { isDeepStrictEqual } from 'node:util';

// Based on af1948c's immutable installer; transport binds this closure to the
// clean, exact release ref. No executable is imported from an artifact.
export function createRuntimeInstaller(authority, environmentKeys, browserPrerequisite = null) {
const { scope, port, appName } = authority;
if (!/^[a-z][a-z0-9-]{0,31}$/.test(scope) || appName !== `dashboard-${scope}` ||
    authority.appDir !== `/var/www/${appName}` || authority.lockDir !== `/var/www/.${appName}-deploy.lock` ||
    authority.releaseBranch !== `release/${scope}` || authority.assetPrefix !== `/_next-${scope}` ||
    !Number.isInteger(port) || port < 3001 || port > 65535 || !Array.isArray(environmentKeys)) throw new Error('Invalid runtime authority');
const BASE = '/var/www';
const DEPLOY_UID = 0;
const DEPLOY_GID = 0;
const APP = `${BASE}/dashboard-${scope}`;
const RELEASES = `${BASE}/dashboard-${scope}-releases`;
const BACKUPS = `${BASE}/dashboard-${scope}-backups`;
const CONTROL = `${BASE}/.dashboard-${scope}-control`;
const LOCK = `${BASE}/.dashboard-${scope}-deploy.lock`;
const CURRENT = `${CONTROL}/current.json`;
const HOST_DIRECTORY_MODES = Object.freeze({
  [RELEASES]: 0o711,
  [BACKUPS]: 0o711,
  [CONTROL]: 0o700,
  [`${BASE}/.dashboard-${scope}-secrets`]: 0o700,
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const ENV_KEYS = Object.freeze([...environmentKeys]);
const SECRET_INPUT_KEYS = ENV_KEYS.filter(key => !['PORT', 'HOSTNAME', 'NODE_ENV', 'INTERNAL_BASE_URL'].includes(key));

function safeRelative(name) {
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

function readPinned(filename, digest) {
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
  if (record.id !== id || record.scope !== `${scope}` || !SHA.test(record.sourceSha) || !DIGEST.test(record.manifestDigest) || record.previousId !== null && !ID.test(record.previousId)) fail('Invalid runtime release authority');
  return record;
}

function attestTree(artifact, record) {
  owned(artifact, true);
  const manifestPath = `${CONTROL}/${record.id}/trusted-runtime-manifest.json`;
  owned(manifestPath);
  const manifest = JSON.parse(readPinned(manifestPath, record.manifestDigest));
  if (manifest.scope !== `${scope}` || manifest.sourceSha !== record.sourceSha || !Array.isArray(manifest.files)) fail('Trusted source or scope mismatch');
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
  if (stableRead(`${artifact}/.release-source-sha`).toString() !== `${record.sourceSha}\n` || stableRead(`${artifact}/.release-runtime-scope`).toString() !== `${scope}\n`) fail('Invalid exact runtime scope/source metadata');
  return manifestPath;
}

function current() {
  const appExists = fs.existsSync(APP) || fs.lstatSync(APP, { throwIfNoEntry: false });
  if (!fs.existsSync(CURRENT)) {
    if (appExists) fail('Active runtime release has no independent deploy authority');
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


function renderEnvironment(source) {
  if (!source || typeof source !== 'object' || Object.keys(source).some(key => !SECRET_INPUT_KEYS.includes(key))) fail('Invalid runtime credential input keys');
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f'"\\\\`]/.test(value)) fail('Invalid runtime environment value');
    result[key] = value;
  }
  for (const key of SECRET_INPUT_KEYS.filter(key => !key.startsWith('MYSQL_') && !['PUPPETEER_EXECUTABLE_PATH','NEXT_PUBLIC_BASE_URL'].includes(key))) {
    if (!result[key]) fail('Missing required runtime credential');
  }
  return { ...result, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    INTERNAL_BASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_BASE_URL: result.NEXT_PUBLIC_BASE_URL ?? 'https://dashboards.adreports.ru' };
}

function parseRuntimeSecrets(bytes) {
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
  } catch { fail('Missing or unsafe dedicated runtime credential file'); }
}

function serializeRuntimeSecrets(source) {
  renderEnvironment(source);
  const bytes = Buffer.from(Object.entries(source).map(([key, value]) => `${key}='${value}'\n`).join(''));
  parseRuntimeSecrets(bytes);
  return bytes;
}

function readRuntimeSecrets() {
  try {
    const filename = `${BASE}/.dashboard-${scope}-secrets/runtime.env`;
    owned(path.dirname(filename), true);
    if (fs.lstatSync(path.dirname(filename)).mode & 0o077) fail('Unsafe credential directory');
    owned(filename);
    if (fs.lstatSync(filename).size > 65536) fail('Oversized credential file');
    const bytes = stableRead(filename, true);
    return parseRuntimeSecrets(bytes);
  } catch { fail('Missing or unsafe dedicated runtime credential file'); }
}

const commandEnv = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir(), PM2_HOME: path.join(os.homedir(), '.pm2') });
function releaseCommandEnvironment(record) {
  if (!record || !ID.test(record.id) || !SHA.test(record.sourceSha) || record.scope !== scope) fail('Invalid PM2 release binding');
  return { RUNTIME_RELEASE_ID: record.id, RUNTIME_RELEASE_SOURCE_SHA: record.sourceSha };
}
function command(bin, args, record) {
  const env = { ...commandEnv(), ...(record ? releaseCommandEnvironment(record) : {}) };
  try { return execFileSync(bin, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch { fail('runtime operating system command failed'); }
}

function assertRuntimeProcess(processes, account, readStatus = filename => fs.readFileSync(filename, 'utf8'), readCwd = filename => fs.realpathSync(filename)) {
  const matches = processes.filter(item => item.name === `dashboard-${scope}`);
  if (matches.length !== 1 || !Number.isInteger(matches[0].pid) || matches[0].pid <= 0) fail('Runtime process identity mismatch');
  const status = readStatus(`/proc/${matches[0].pid}/status`);
  for (const [field, expected] of [['Uid', account.uid], ['Gid', account.gid]]) {
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`, 'm').exec(status);
    if (!match || match.slice(1).some(value => Number(value) !== expected)) fail('Runtime process identity mismatch');
  }
  if (readCwd(`/proc/${matches[0].pid}/cwd`) !== `${APP}/apps/${scope}`) fail('Runtime process is not in the active directory');
}

// Application code is reached only after the fixed OS privilege drop and this
// trusted bootstrap attest the kernel identity. The privileged parent retains
// private manifest access; none of its credentials or authority paths are passed.
function normalizeBootEnvironment(env) {
  // The pinned amd64 execution runtime inserts this exact libuv opt-out even
  // after env -i. No other inherited or runtime-created setting is tolerated.
  if (Object.hasOwn(env, 'UV_USE_IO_URING')) {
    if (env.UV_USE_IO_URING !== '0') throw new Error('runtime boot environment mismatch');
    delete env.UV_USE_IO_URING;
  }
  if (Object.keys(env).sort().join(',') !== 'HOSTNAME,NODE_ENV,PORT' || env.NODE_ENV !== 'production' || env.HOSTNAME !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(env.PORT) || Number(env.PORT) > 65535) throw new Error('runtime boot environment mismatch');
}

const BOOT_IDENTITY_BOOTSTRAP = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [uidText, gidText, server] = process.argv.slice(1);
const uid = Number(uidText), gid = Number(gidText);
const status = fs.readFileSync('/proc/self/status', 'utf8');
const groups = /^Groups:[\t ]*([^\r\n]*)$/m.exec(status)?.[1].trim();
for (const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) {
  if (!new RegExp('^' + name + ':[\\t ]*0+$', 'm').test(status)) throw new Error('runtime boot capabilities were retained');
}
if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0 ||
    process.getuid() !== uid || process.geteuid() !== uid || process.getgid() !== gid || process.getegid() !== gid ||
    groups !== '' || !/^NoNewPrivs:[\t ]*1$/m.test(status) ||
    process.getgroups().some(group => group !== gid) || fs.realpathSync(process.cwd()) !== path.dirname(server)) {
  throw new Error('runtime boot privilege identity mismatch');
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
    if (!values || values.slice(1).some(value => Number(value) !== expected)) fail('runtime boot kernel identity mismatch');
  }
  if (!/^Groups:[\t ]*$/m.test(status) || !/^NoNewPrivs:[\t ]*1$/m.test(status) || fs.realpathSync(`/proc/${pid}/cwd`) !== cwd) fail('runtime boot kernel groups/cwd mismatch');
  for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) if (!new RegExp(`^${name}:[\\t ]*0+$`, 'm').test(status)) fail('runtime boot kernel capabilities mismatch');
}

async function bootRuntimeAsService(artifact) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || process.geteuid() !== 0) fail('runtime service boot requires a privileged Linux verifier');
  const account = realPlatform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || !Number.isInteger(account.gid) || account.gid <= 0) fail('Invalid fixed service-account identity');
  // No environment or positional argument can replace the reviewed mechanism.
  const mechanism = '/usr/bin/setpriv';
  const environmentBoundary = '/usr/bin/env';
  owned(mechanism); owned(environmentBoundary); owned(process.execPath);
  const cwd = `${artifact}/apps/${scope}`, server = `${cwd}/server.js`;
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
          if (response.status === 503 && body.length < 1024 && isDeepStrictEqual(JSON.parse(body), { ok: false, scope, database: "disconnected" })) {
            attestBootProcess(child.pid, account, cwd);
            return identity;
          }
        } catch { /* A bounded startup retry; never display child output. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fail('runtime unprivileged boot identity/health check failed');
  } finally {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 1000);
    await closed;
    clearTimeout(force);
  }
}

async function verifyStagedArtifact(artifact, manifest, boot) {
  const code = `${path.dirname(manifest)}/scripts/runtime-artifact-policy.mjs`;
  const args = [code, `${scope}`, artifact, '--trusted-manifest', manifest];
  command(process.execPath, args);
  if (boot) {
    await bootRuntimeAsService(artifact);
    command(process.execPath, args);
  }
}

const realPlatform = {
  browser(account) {
    if(scope!=='abbott'||!browserPrerequisite)fail('Abbott browser prerequisite missing');
    return browserPrerequisite.verifyBrowserInstallation({contract:browserPrerequisite.contract,gid:account.gid,checkExecutable:executable=>{
      try {
        const script="const fs=require('node:fs');process.setgroups([]);process.setgid("+account.gid+");process.setuid("+account.uid+");fs.accessSync("+JSON.stringify(executable)+",fs.constants.R_OK|fs.constants.X_OK);";
        execFileSync('/usr/bin/node',['-e',script],{cwd:'/',env:{},stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:1024});return true;
      }catch{return false;}
    }}).executable;
  },
  account() {
    const uid = Number(command('/usr/bin/id', ['-u', `dashboard-${scope}`]).trim());
    const groups = command('/usr/bin/id', ['-G', `dashboard-${scope}`]).trim().split(/\s+/).map(Number);
    const group = command('/usr/bin/getent', ['group', `dashboard-${scope}`]).trim().split(':');
    const gid = Number(group[2]);
    if (groups.some(value => value === 0) || group[0] !== `dashboard-${scope}` || groups.length !== 1 || groups[0] !== gid) fail('Runtime service account must have only its dedicated group');
    return { uid, gid };
  },
  chown: (filename, uid, gid) => fs.chownSync(filename, uid, gid),
  verify: verifyStagedArtifact,
  secrets: readRuntimeSecrets,
  async start(control) {
    const launcher = `${BASE}/.dashboard-${scope}-launcher.cjs`;
    const source = `${control}/deploy/${scope}/start.cjs`;
    if (fs.existsSync(launcher)) {
      owned(launcher);
      if (!stableRead(launcher).equals(stableRead(source))) fail('Launcher change requires separately reviewed process transition');
    } else createFile(launcher, stableRead(source), 0o644);
    const record = readRecord(path.basename(control));
    if (control !== `${CONTROL}/${record.id}`) fail('Invalid PM2 release control');
    // PM2 retains this protected release binding in its registration. The
    // launcher clears inherited metadata before loading the application env.
    command('pm2', ['startOrReload', `${control}/deploy/${scope}/ecosystem.config.cjs`, '--only', appName, '--update-env'], record);
  },
  async startFresh(control) {
    if(scope!=='abbott'||realPlatform.registration()!==null)fail('Fresh Abbott registration requires absence');
    const record=readRecord(path.basename(control));
    if(control!==`${CONTROL}/${record.id}`)fail('Invalid PM2 release control');
    const launcher=`${BASE}/.dashboard-${scope}-launcher.cjs`,source=`${control}/deploy/${scope}/start.cjs`;
    if(fs.existsSync(launcher)){owned(launcher);if(!stableRead(launcher).equals(stableRead(source)))fail('Launcher transition requires review');}
    else createFile(launcher,stableRead(source),0o644);
    if(realPlatform.registration()!==null)fail('Fresh Abbott registration requires absence');
    command('pm2',['start',`${control}/deploy/${scope}/ecosystem.config.cjs`,'--only',appName],record);
  },
  async delete(pmId) {
    if(scope!=='abbott'||!Number.isSafeInteger(pmId)||pmId<0)fail('Owned Abbott registration required');
    command('pm2',['delete',String(pmId)]);
  },
  exited(proof) {
    if(!proof||!Number.isSafeInteger(proof.pid)||proof.pid<=0)fail('Owned process proof required');
    if(fs.lstatSync(`/proc/${proof.pid}`,{throwIfNoEntry:false}))fail('Owned process exit not verified');
  },
  registration(pmId) {
    const matches = JSON.parse(command('pm2', ['jlist'])).filter(row => row.pm_id === pmId || row.name === appName);
    if (!matches.length) return null;
    const registration = captureRuntimeRegistration(matches, realPlatform.account());
    return { registration, pid: matches[0].pid, status: matches[0].pm2_env.status };
  },
  snapshot() {
    const matches = JSON.parse(command('pm2',['jlist'])).filter(row=>row.name===`dashboard-${scope}`);
    if (!matches.length || matches.length===1 && matches[0].pid===0 && matches[0].pm2_env?.status==='stopped') return null;
    const proof=captureRuntimeIdentity(matches,realPlatform.account(),filename=>fs.readFileSync(filename,'utf8'),filename=>fs.realpathSync(filename));
    const second=JSON.parse(command('pm2',['jlist'])).filter(row=>row.name===`dashboard-${scope}`);
    if(second.length!==1||second[0].pid!==proof.pid||second[0].pm_id!==proof.pmId)fail('Runtime identity changed');
    return proof;
  },
  async stop(pmId) {
    if(!Number.isSafeInteger(pmId)||pmId<0)fail('Owned PM2 identity required');
    command('pm2', ['stop', String(pmId)]);
  },
  async assertNoListener() {
    if (command('ss', ['-ltnpH', `( sport = :${port} )`]).trim()) fail('Candidate listener remains after shutdown');
  },
  async health(proof) {
    let healthy = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!isDeepStrictEqual(realPlatform.snapshot(), proof)) fail('Runtime identity changed during readiness');
      try {
        assertRuntimeListener(proof, command('ss', ['-ltnpH', `( sport = :${port} )`]));
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        if (response.status === 200 && isDeepStrictEqual(body, { ok: true, scope, database: "connected" })) { healthy = true; break; }
      } catch { /* Retry startup only; no response bodies or env diagnostics. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!healthy) fail('runtime health attestation failed');
    if (!isDeepStrictEqual(realPlatform.snapshot(), proof)) fail('Runtime identity changed after readiness');
    assertRuntimeListener(proof, command('ss', ['-ltnpH', `( sport = :${port} )`]));
  },
};

function validateRuntimeRegistration(value, account) {
  const launcherArgs = ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', `${BASE}/.dashboard-${scope}-launcher.cjs`];
  if (!value || Object.keys(value).sort().join(',') !== 'appName,args,cwd,exec,gid,pmId,releaseId,sourceSha,uid' ||
      value.appName !== appName || !Number.isSafeInteger(value.pmId) || value.pmId < 0 || value.exec !== '/usr/bin/env' || value.cwd !== `${APP}/apps/${scope}` ||
      ![appName, account.uid].includes(value.uid) || ![appName, account.gid].includes(value.gid) || !ID.test(value.releaseId) || !SHA.test(value.sourceSha) ||
      !Array.isArray(value.args) || value.args.length !== launcherArgs.length || value.args.some((arg, index) => arg !== launcherArgs[index])) fail('Runtime registration identity mismatch');
  return value;
}

function captureRuntimeRegistration(processes, account) {
  if (processes.length !== 1 || processes[0].name !== appName) fail('Runtime registration identity mismatch');
  const row = processes[0], env = row.pm2_env;
  return validateRuntimeRegistration({ appName: row.name, pmId: row.pm_id, exec: env?.pm_exec_path, cwd: env?.pm_cwd,
    args: Array.isArray(env?.args) ? Array.from(env.args) : null, uid: env?.uid, gid: env?.gid,
    releaseId: env?.RUNTIME_RELEASE_ID, sourceSha: env?.RUNTIME_RELEASE_SOURCE_SHA }, account);
}

function captureRuntimeIdentity(processes,account,readText,readCwd) {
  const registration = captureRuntimeRegistration(processes, account);
  assertRuntimeProcess(processes,account,readText,readCwd);
  const process=processes[0];
  const script = registration.args[3];
  // Next changes process.title and therefore Linux argv memory. PM2 retains
  // the exact launch command independently of that mutable process title.
  const stat=()=>{const text=readText(`/proc/${process.pid}/stat`),close=text.lastIndexOf(')');const fields=text.slice(close+2).trim().split(/\s+/);if(close<0||!/^\d+$/.test(fields[19]??''))fail('Runtime start identity mismatch');return fields[19];};
  const startTime=stat(),bootId=readText('/proc/sys/kernel/random/boot_id').trim();
  if(!/^[a-f0-9-]{36}$/.test(bootId))fail('Runtime boot identity mismatch');
  const sourceSha = readText(`${APP}/.release-source-sha`).trim();
  if (!SHA.test(sourceSha) || sourceSha !== registration.sourceSha) fail('Runtime source identity mismatch');
  assertRuntimeProcess(processes,account,readText,readCwd);
  if(stat()!==startTime)fail('Runtime PID reused');
  return {appName,pid:process.pid,pmId:process.pm_id,startTime,bootId,uid:account.uid,gid:account.gid,cwd:readCwd(`/proc/${process.pid}/cwd`),script,sourceSha,registration};
}

function assertRuntimeListener(proof, listeners) {
  const rows = listeners.trim().split('\n');
  if (!proof || rows.length !== 1 || rows[0].trim().split(/\s+/)[3] !== `127.0.0.1:${port}` ||
      !rows[0].includes(`pid=${proof.pid},`) || [...rows[0].matchAll(/pid=(\d+)/g)].some(match => Number(match[1]) !== proof.pid)) fail('Runtime listener ownership mismatch');
}

function bindingValid(binding) {
  if(!binding||Object.keys(binding).sort().join(',')!=='runId,sourceSha'||!SHA.test(binding.sourceSha)||!UUID.test(binding.runId))fail('Invalid deployment ownership binding');
}
function processProof(platform,account) {
  const value=platform.snapshot();
  if(value===null)return null;
  if(!value||Object.keys(value).sort().join(',')!=='appName,bootId,cwd,gid,pid,pmId,registration,script,sourceSha,startTime,uid'||value.appName!==appName||!Number.isSafeInteger(value.pid)||value.pid<=0||!Number.isSafeInteger(value.pmId)||value.pmId<0||!/^\d+$/.test(value.startTime)||!/^[a-f0-9-]{36}$/.test(value.bootId)||value.uid!==account.uid||value.gid!==account.gid||value.cwd!==`${APP}/apps/${scope}`||value.script!==`${BASE}/.dashboard-${scope}-launcher.cjs`||!SHA.test(value.sourceSha))fail('Invalid deployment process ownership');
  validateRuntimeRegistration(value.registration, account);
  if (value.registration.pmId !== value.pmId || value.registration.sourceSha !== value.sourceSha) fail('Process/registration binding mismatch');
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
  return stopRegistration(proof.registration, proof, platform, account, guard);
}
async function stopRegistration(registration, proof, platform, account, guard) {
  guard();
  validateRuntimeRegistration(registration, account);
  const active = platform.registration(registration.pmId);
  if (active !== null) {
    if (!isDeepStrictEqual(active.registration, registration)) fail('PM2 registration ownership changed; no stop');
    if (Number.isSafeInteger(active.pid) && active.pid > 0) {
      const live = processProof(platform, account);
      if (!live || live.pid !== active.pid || !isDeepStrictEqual(live.registration, registration) ||
          proof && !isDeepStrictEqual(live, proof)) fail('Deployment ownership changed; no stop');
    } else if (active.pid !== 0 || !['errored', 'waiting restart', 'launching', 'stopping', 'stopped'].includes(active.status)) fail('Unproven PM2 inactive registration; no stop');
    if (active.pid !== 0 || active.status !== 'stopped') await platform.stop(registration.pmId);
    const stopped = platform.registration(registration.pmId);
    if (stopped !== null && (!isDeepStrictEqual(stopped.registration, registration) || stopped.pid !== 0 || stopped.status !== 'stopped')) fail('Owned PM2 registration did not stop');
  }
  await platform.assertNoListener();
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

function materialize(payload, id, old, platform, account, browserExecutable) {
  if (!payload || payload.scope !== `${scope}` || !SHA.test(payload.sourceSha) || !DIGEST.test(payload.manifestDigest) || hash(payload.manifest) !== payload.manifestDigest) fail('Invalid trusted payload source/scope/digest');
  const manifest = JSON.parse(payload.manifest);
  if (manifest.scope !== `${scope}` || manifest.sourceSha !== payload.sourceSha) fail('Payload source/scope binding failed');
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
  if(scope==='abbott')env.PUPPETEER_EXECUTABLE_PATH=browserExecutable;
  createFile(`${stage}/.env`, Object.entries(env).map(([key, value]) => `${key}='${value}'\n`).join(''), 0o640);
  platform.chown(`${stage}/.env`, DEPLOY_UID, account.gid);
  const record = { id, previousId: old?.id ?? null, scope: `${scope}`, sourceSha: payload.sourceSha, manifestDigest: payload.manifestDigest };
  createFile(`${control}/record.json`, JSON.stringify(record));
  return { record, stage };
}

// Abbott changes registration rather than asking PM2 to merge retained env.
// Every destructive command is addressed by a freshly re-proven registration.
async function activateAbbott({request,record,stage,envDigest,old,beforeProcess,owner,platform,account,guard,preserveLock,terminal}) {
  const oldBackup=old?`${BACKUPS}/${old.id}`:null;
  const journalPath=`${CONTROL}/activation-${owner}.json`;
  const dir=p=>{owned(p,true);const s=fs.lstatSync(p);return{dev:String(s.dev),ino:String(s.ino)};};
  const absent=p=>{if(fs.lstatSync(p,{throwIfNoEntry:false}))fail('Activation path collision');};
  const sameDir=(p,d)=>{if(!isDeepStrictEqual(dir(p),d))fail('Activation directory identity changed');};
  const candidateDirectory=dir(stage),oldDirectory=old?dir(APP):null;
  const originalPointer=old?stableRead(CURRENT,true):null,oldEnv=old?hash(stableRead(`${APP}/.env`)):null;
  let mutated=false,oldMoved=false,candidateMoved=false,startAttempted=false,ownedRegistration=null,ownedProcess=null,pointerPublished=false;
  const lockProof=()=>{owned(LOCK,true);const s=fs.lstatSync(LOCK);if(s.gid!==0||(s.mode&0o7777)!==0o700||stableRead(`${LOCK}/owner`,true).toString()!==owner||fs.readdirSync(LOCK).join()!=='owner')fail('Activation lock drift');};
  const pointerProof=()=>{
    if(pointerPublished){if(!stableRead(CURRENT,true).equals(Buffer.from(JSON.stringify(record))))fail('Activation pointer drift');}
    else if(originalPointer){if(!stableRead(CURRENT,true).equals(originalPointer))fail('Activation pointer drift');}
    else absent(CURRENT);
  };
  const tree=(p,r,d,digest)=>{
    sameDir(p,d);if(!isDeepStrictEqual(readRecord(r.id),r))fail('Activation record drift');attestTree(p,r);
    const s=fs.lstatSync(`${p}/.env`);if(!s.isFile()||s.nlink!==1||s.uid!==0||s.gid!==account.gid||(s.mode&0o7777)!==0o640||hash(stableRead(`${p}/.env`))!==digest)fail('Activation environment drift');
  };
  const journal=state=>{
    lockProof();const next=journalPath+'.next';absent(next);
    if(fs.existsSync(journalPath)){owned(journalPath);const s=fs.lstatSync(journalPath);if(s.gid!==0||(s.mode&0o7777)!==0o600)fail('Activation journal drift');const prior=JSON.parse(stableRead(journalPath,true));if(prior.owner!==owner)fail('Activation journal drift');}
    durableFile(next,{version:1,owner,state,predecessor:old, candidate:record,stage,oldDirectory,candidateDirectory});fs.renameSync(next,journalPath);
  };
  const checkpoint=async()=>{await new Promise(resolve=>setTimeout(resolve,0));guard();lockProof();pointerProof();};
  const noRegistration=async()=>{if(platform.registration()!==null)fail('Abbott registration remains');await platform.assertNoListener();};
  const remove=async(registration,proof)=>{
    // Pointer drift forbids layout compensation, but cannot keep an otherwise
    // exactly owned candidate serving. Process identity remains mandatory.
    lockProof();
    await stopRegistration(registration,proof,platform,account,lockProof);
    if(proof)platform.exited(proof);
    const stopped=platform.registration(registration.pmId);
    if(stopped!==null){
      if(!isDeepStrictEqual(stopped.registration,registration)||stopped.pid!==0||stopped.status!=='stopped')fail('Abbott deletion ownership changed');
      lockProof();
      if(!isDeepStrictEqual(platform.registration(registration.pmId),stopped))fail('Abbott deletion ownership changed');
      await platform.delete(registration.pmId);
    }
    await noRegistration();if(proof)platform.exited(proof);
  };
  const capture=(requireOnline=false)=>{
    const candidate=platform.registration();if(candidate===null){if(requireOnline)fail('Candidate registration disappeared');return;}
    validateRuntimeRegistration(candidate.registration,account);
    if(candidate.registration.releaseId!==record.id||candidate.registration.sourceSha!==record.sourceSha||ownedRegistration&&!isDeepStrictEqual(candidate.registration,ownedRegistration))fail('New deployment registration was not established');
    ownedRegistration=candidate.registration;
    if(Number.isSafeInteger(candidate.pid)&&candidate.pid>0){
      const proof=processProof(platform,account);
      if(!proof||proof.pid!==candidate.pid||!isDeepStrictEqual(proof.registration,ownedRegistration)||beforeProcess&&proof.pid===beforeProcess.pid||ownedProcess&&!isDeepStrictEqual(proof,ownedProcess))fail('New deployment process was not established');
      ownedProcess=proof;
      if(requireOnline&&candidate.status!=='online')fail('New deployment process is not online');
    }else if(requireOnline||candidate.pid!==0||!['errored','waiting restart','launching','stopping','stopped'].includes(candidate.status))fail('New deployment inactive identity mismatch');
  };
  const before=async()=>{
    lockProof();pointerProof();tree(stage,record,candidateDirectory,envDigest);
    if(old){
      tree(APP,old,oldDirectory,oldEnv);absent(oldBackup);
      if(!beforeProcess||platform.registration(beforeProcess.pmId)?.status!=='online'||beforeProcess.sourceSha!==old.sourceSha||beforeProcess.registration.releaseId!==old.id||!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Predecessor process identity mismatch');
      await platform.health(beforeProcess);
      if(!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Predecessor process identity changed');
    }else{absent(APP);await noRegistration();}
  };
  await before();await checkpoint();journal('prepared');
  try{
    await checkpoint();await before();mutated=true;if(terminal)terminal.status='UNACKNOWLEDGED';
    if(old)await remove(beforeProcess.registration,beforeProcess);else await noRegistration();
    journal('predecessor_removed');await checkpoint();
    await noRegistration();
    if(old){tree(APP,old,oldDirectory,oldEnv);absent(oldBackup);if(platform.registration()!==null)fail('Abbott registration reappeared');fs.renameSync(APP,oldBackup);oldMoved=true;}
    tree(stage,record,candidateDirectory,envDigest);absent(APP);if(platform.registration()!==null)fail('Abbott registration reappeared');fs.renameSync(stage,APP);candidateMoved=true;
    journal('candidate_active');await checkpoint();tree(APP,record,candidateDirectory,envDigest);await noRegistration();
    startAttempted=true;let startFailed=false;try{await platform.startFresh(`${CONTROL}/${record.id}`);}catch{startFailed=true;}
    capture(true);if(startFailed||!ownedProcess)fail('New deployment process was not established');
    journal('candidate_started');await checkpoint();await platform.health(ownedProcess);await checkpoint();
    capture(true);tree(APP,record,candidateDirectory,envDigest);
    if(!isDeepStrictEqual(processProof(platform,account),ownedProcess))fail('Candidate readiness identity changed');
    if(old)tree(oldBackup,old,oldDirectory,oldEnv);
    await checkpoint();await platform.health(ownedProcess);capture(true);pointerProof();
    publishPointer(record);pointerPublished=true;
    if(request.binding)durableFile(`${CONTROL}/ownership-${request.binding.runId}.json`,{version:1,binding:request.binding,transaction:owner,record,directory:directoryIdentity(),process:ownedProcess});
    await checkpoint();capture(true);tree(APP,record,candidateDirectory,envDigest);journal('committed');return record;
  }catch{
    if(!mutated){journal('refused');fail('Abbott activation refused before process mutation');}
    try{
      // Cancellation cannot disable identity checks or the bounded compensation.
      lockProof();
      if(startAttempted){if(!ownedRegistration)capture();if(ownedRegistration)await remove(ownedRegistration,ownedProcess);else await noRegistration();}
      else if(old)await remove(beforeProcess.registration,beforeProcess);else await noRegistration();
      pointerProof();
      if(candidateMoved){tree(APP,record,candidateDirectory,envDigest);absent(stage);fs.renameSync(APP,stage);candidateMoved=false;}
      if(oldMoved){tree(oldBackup,old,oldDirectory,oldEnv);absent(APP);fs.renameSync(oldBackup,APP);oldMoved=false;}
      if(old){
        tree(APP,old,oldDirectory,oldEnv);
        if(pointerPublished){const next=`${CONTROL}/current-${randomUUID()}.json`;createFile(next,originalPointer);fs.renameSync(next,CURRENT);pointerPublished=false;}
        pointerProof();await noRegistration();
        let failed=false;try{await platform.startFresh(`${CONTROL}/${old.id}`);}catch{failed=true;}
        const restored=platform.registration();
        if(!restored||restored.registration.releaseId!==old.id||restored.registration.sourceSha!==old.sourceSha)fail('Predecessor restart ownership requires review');
        const live=Number.isSafeInteger(restored.pid)&&restored.pid>0?processProof(platform,account):null;
        try{
          if(failed||!live||restored.status!=='online'||live.registration.releaseId!==old.id||live.sourceSha!==old.sourceSha)fail('Predecessor restart failed');
          await platform.health(live);tree(APP,old,oldDirectory,oldEnv);pointerProof();
          if(!isDeepStrictEqual(processProof(platform,account),live)||!isDeepStrictEqual(current(),old))fail('Predecessor restart identity changed');
        }catch{await remove(restored.registration,live);throw Error();}
      }else{absent(APP);if(pointerPublished){owned(CURRENT);fs.unlinkSync(CURRENT);pointerPublished=false;}await noRegistration();}
      journal('restored');if(terminal)terminal.status='RESTORED';fail(old?'runtime activation failed; attested predecessor restored':'runtime activation failed; service stopped');
    }catch(error){
      if(error.message==='runtime activation failed; attested predecessor restored'||error.message==='runtime activation failed; service stopped')throw error;
      preserveLock();try{journal('review_required');if(terminal)terminal.status='REVIEW_REQUIRED';}catch{}
      fail('runtime activation and predecessor restoration failed; ownership requires review');
    }
  }finally{originalPointer?.fill(0);}
}

async function transact(request, platform = realPlatform, stagedGuard, terminal) {
  // The worker is supplied by the exact clean release source, never by remote disk.
  const guard = stagedGuard ?? (() => {});
  guard();
  if (process.getuid() !== DEPLOY_UID) fail('Privileged deploy account required');
  const account = platform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || account.uid === DEPLOY_UID || !Number.isInteger(account.gid) || account.gid <= 0) fail('Dedicated runtime account and write separation required');
  const browserExecutable=scope==='abbott'&&['deploy','rollback'].includes(request.action)?platform.browser(account):undefined;
  owned(BASE, true);
  const owner = randomUUID();
  let preserveLock=false;
  try { fs.mkdirSync(LOCK, { mode: 0o700 }); } catch { fail('runtime deployment lock is already held or unsafe'); }
  createFile(`${LOCK}/owner`, owner);
  try {
    for (const dir of [RELEASES, BACKUPS, CONTROL]) ensureDirectory(dir, HOST_DIRECTORY_MODES[dir]);
    if(request.action==='stop-owned')return await stopOwned(request.binding,platform,account,guard);
    const old = current();
    if (request.action === 'inspect') return old;
    if ((old?.sourceSha ?? null) !== request.expectedActiveSha) fail('Active runtime SHA changed; recheck source ancestry');
    if (request.action !== 'deploy' && request.action !== 'rollback') fail('Invalid fixed release action');
    if(platform===realPlatform&&request.action==='deploy')bindingValid(request.binding);
    if(request.binding){bindingValid(request.binding);if(request.payload?.sourceSha!==request.binding.sourceSha||fs.lstatSync(`${CONTROL}/ownership-${request.binding.runId}.json`,{throwIfNoEntry:false}))fail('Deployment binding source or run reuse mismatch');}
    const beforeProcess=processProof(platform,account);
    if(!old&&beforeProcess)fail('Unowned process exists before deployment');
    let record, stage;
    if (request.action === 'deploy') ({ record, stage } = materialize(request.payload, randomUUID().replaceAll('-', ''), old, platform, account,browserExecutable));
    else {
      if (!old?.previousId) fail('No attested runtime predecessor');
      record = readRecord(old.previousId); stage = `${BACKUPS}/${record.id}`;
    }
    const manifest = attestTree(stage, record);
    const envDigest = hash(stableRead(`${stage}/.env`));
    // The artifact policy rejects every env file. Runtime credentials are a
    // separate host overlay: park it under protected control while checking and
    // booting the candidate without DB credentials, then restore the exact bytes.
    // This applies equally to fresh candidates and sealed rollback predecessors.
    const parkedEnvironment = `${CONTROL}/${record.id}/verification-${randomUUID()}.env`;
    fs.renameSync(`${stage}/.env`, parkedEnvironment);
    try {
      await platform.verify(stage, manifest, false);
      await platform.verify(stage, manifest, true);
    } finally {
      owned(parkedEnvironment);
      if (fs.lstatSync(`${stage}/.env`, { throwIfNoEntry: false }) || hash(stableRead(parkedEnvironment)) !== envDigest) fail('Runtime environment overlay changed during verification');
      fs.renameSync(parkedEnvironment, `${stage}/.env`);
    }
    guard();
    // Pin is retained in memory from transport (deploy) or protected record (rollback).
    // Replacing both manifest and its sidecar cannot change this activation authority.
    attestTree(stage, record);
    if (hash(stableRead(`${stage}/.env`)) !== envDigest) fail('Runtime environment changed during verification');
    if (old) attestTree(APP, old);
    const oldBackup = old ? `${BACKUPS}/${old.id}` : null;
    if (oldBackup && fs.lstatSync(oldBackup, { throwIfNoEntry: false })) fail('Predecessor backup collision');
    if(scope==='abbott')return await activateAbbott({request,record,stage,envDigest,old,beforeProcess,owner,platform,account,guard,terminal,preserveLock:()=>{preserveLock=true;}});
    let oldMoved = false, candidateMoved = false, startAttempted = false, ownedRegistration = null, ownedProcess = null;
    try {
      if (old) { fs.renameSync(APP, oldBackup); oldMoved = true; }
      fs.renameSync(stage, APP); candidateMoved = true;
      guard();
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during activation');
      startAttempted = true;
      let startFailed = false;
      try { await platform.start(`${CONTROL}/${record.id}`); } catch { startFailed = true; }
      // A command failure or early process exit can still leave a restartable
      // registration. Bind that identity before asking for a live PID/socket.
      const candidate = platform.registration();
      if (candidate !== null) {
        validateRuntimeRegistration(candidate.registration, account);
        if (candidate.registration.sourceSha !== record.sourceSha || candidate.registration.releaseId !== record.id) fail('New deployment registration was not established');
        ownedRegistration = candidate.registration;
        if (Number.isSafeInteger(candidate.pid) && candidate.pid > 0) {
          const candidateProcess = processProof(platform, account);
          if (!candidateProcess || candidateProcess.pid !== candidate.pid || !isDeepStrictEqual(candidateProcess.registration, ownedRegistration) || isDeepStrictEqual(candidateProcess, beforeProcess)) fail('New deployment process was not established');
          ownedProcess = candidateProcess;
        }
      }
      if (startFailed || !ownedProcess) fail('New deployment process was not established');
      await platform.health(ownedProcess);
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
        if (candidateMoved && startAttempted) {
          if (ownedRegistration) await stopRegistration(ownedRegistration, ownedProcess, platform, account, guard);
          else {
            if (platform.registration(beforeProcess?.pmId) !== null) fail('Ambiguous startup ownership; no stop');
            await platform.assertNoListener();
          }
        }
        if(candidateMoved&&!startAttempted&&beforeProcess===null&&processProof(platform,account)!==null)fail('Ambiguous startup ownership; no stop');
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
          if(!startAttempted&&beforeProcess&&!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Ambiguous predecessor identity');
          if(startAttempted||!beforeProcess)await platform.start(`${CONTROL}/${old.id}`);
          const restoredProcess = processProof(platform, account);
          if (!restoredProcess || restoredProcess.sourceSha !== old.sourceSha || restoredProcess.registration.releaseId !== old.id) fail('Restored predecessor process identity mismatch');
          await platform.health(restoredProcess); attestTree(APP, old); publishPointer(old);
        }
      } catch { fail('runtime activation and predecessor restoration failed; ownership requires review'); }
      if (rollbackCandidateNeedsRecovery) fail('Current runtime release restored; rollback backup collision or integrity failure requires recovery');
      fail(old ? 'runtime activation failed; attested predecessor restored' : 'runtime activation failed; service stopped');
    }
  } finally {
    try{
    owned(LOCK, true);
    if (stableRead(`${LOCK}/owner`, true).toString() !== owner || fs.readdirSync(LOCK).join() !== 'owner') fail('runtime lock ownership changed; preserved for recovery');
    if(!preserveLock){fs.unlinkSync(`${LOCK}/owner`); fs.rmdirSync(LOCK);}
    }catch(error){if(terminal)terminal.status='UNACKNOWLEDGED';throw error;}
  }
}

async function transactAcknowledged(request,signal,platform=realPlatform){
  if(scope!=='abbott'||!['inspect','deploy','rollback'].includes(request?.action))return{status:'REFUSED',record:null};
  // Only the transaction's own state transitions can certify compensation.
  // An exception message from a command or injected platform is never authority.
  const terminal={status:'REFUSED'},guard=()=>{if(signal?.aborted)fail('Abbott activation cancelled');};
  try{return{status:'COMMITTED',record:await transact(request,platform,guard,terminal)};}
  catch{return{status:terminal.status,record:null};}
}

async function remoteMain(expectedDigest) {
  let cancelled=false;
  const signals=scope==='abbott'?['SIGINT','SIGTERM','SIGHUP']:[];
  const stop=()=>{cancelled=true;};
  const guard=()=>{if(cancelled)fail('Abbott activation cancelled');};
  for(const signal of signals)process.on(signal,stop);
  try {
    if (!DIGEST.test(expectedDigest)) fail('Invalid transport authority');
    const bytes = fs.readFileSync(0);
    if (bytes.length > 536870912 || hash(bytes) !== expectedDigest) fail('Transport authority mismatch');
    const request = JSON.parse(bytes);
    // Inspection takes the same scope lock; no active metadata is read here.
    const record = await transact(request, realPlatform, guard);
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch (error) {
    process.stderr.write(scope==='abbott'?'ABBOTT_ACTIVATION_REFUSED\n':`Refusing runtime operation: ${error.message}\n`);
    process.exitCode = 1;
  }finally{for(const signal of signals)process.removeListener(signal,stop);}
}


return { safeRelative, readPinned, renderEnvironment, parseRuntimeSecrets, serializeRuntimeSecrets,
  assertRuntimeProcess, captureRuntimeIdentity, captureRuntimeRegistration, releaseCommandEnvironment, assertRuntimeListener, normalizeBootEnvironment, inspectActiveRuntime: current,
  // Fixed interrupted-activation recovery uses the same attesters/PM2 adapter.
  // This does not add a normal deploy action or relax current() consistency.
  interruptedRecoveryTools: () => ({ readRecord, attestTree, platform: realPlatform }),
  transact, transactAcknowledged, remoteMain, ENV_KEYS, HOST_DIRECTORY_MODES };
}
