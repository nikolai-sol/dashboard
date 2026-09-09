import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// This internal library is loaded by the attested dispatcher. Direct execution,
// including a symlink alias, refuses before any non-core module can evaluate.
let refuseDirect = false;
try {
  const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
  refuseDirect = Boolean(process.argv[1]) && fs.realpathSync(path.resolve(process.argv[1])) === modulePath;
} catch { refuseDirect = true; }
if (refuseDirect) throw new Error('Refusing Zaruku host implementation; use the staged dispatcher');
const { parseZarukuSecrets, serializeZarukuSecrets, renderEnvironment, HOST_DIRECTORY_MODES } = await import('./runtime-release-remote.mjs');

const NAME = 'dashboard-zaruku';
const JOURNAL = '/var/www/.dashboard-zaruku-host-creation.json';
const SOURCE = '/var/www/www-root/data/.production.env';
const SECRET = '/var/www/.dashboard-zaruku-secrets/runtime.env';
const AUTH = '/var/www/.dashboard-zaruku-shadow/auth.json';
const ROOTS = Object.freeze(Object.keys(HOST_DIRECTORY_MODES));
const PLAN = Object.freeze([{ kind: 'group', target: NAME }, { kind: 'user', target: NAME }, ...ROOTS.map(target => ({ kind: 'directory', target }))]);
const fail = () => { throw new Error('Unsafe Zaruku host boundary'); };
const same = (a, b) => isDeepStrictEqual(a, b);
const safeEnv = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' });

function metadata(stat) {
  if (!stat) return null;
  return { dev: Number(stat.dev), ino: Number(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid), mode: Number(stat.mode) & 0o7777, type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', nlink: stat.isDirectory() ? null : Number(stat.nlink) };
}
function privateFile(stat) {
  const value = metadata(stat);
  if (!value || value.type !== 'file' || value.nlink !== 1 || value.uid !== 0 || value.gid !== 0 || value.mode !== 0o600) fail();
  return value;
}
function directory(stat, mode) {
  const value = metadata(stat);
  if (!value || value.type !== 'directory' || value.uid !== 0 || value.gid !== 0 || value.mode & 0o022 || mode !== undefined && value.mode !== mode) fail();
  return value;
}
function root(adapter) {
  const identity = adapter.currentIdentity();
  if (adapter.platform !== 'linux' || identity.uid !== 0 || identity.euid !== 0) fail();
}

// Open every ancestor without following links. Linux mutations use /proc/self/fd paths,
// so an ancestor rename cannot redirect a write into a replacement directory.
function withParent(adapter, filename, action) {
  const io = adapter.fs, handles = [];
  try {
    let current = '/';
    for (const part of ['', ...path.posix.dirname(filename).split('/').filter(Boolean)]) {
      if (part) current = path.posix.join(current, part);
      const addressed = handles.length ? adapter.anchoredPath(handles.at(-1).fd, part) : '/';
      const before = directory(io.lstatSync(addressed));
      const fd = io.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      handles.push({ fd, current, before });
      if (!same(directory(io.fstatSync(fd)), before)) fail();
    }
    const parent = handles.at(-1);
    const verify = () => {
      for (const handle of handles) if (!same(directory(io.lstatSync(handle.current)), handle.before) || !same(directory(io.fstatSync(handle.fd)), handle.before)) fail();
    };
    verify();
    const result = action(adapter.anchoredPath(parent.fd, path.posix.basename(filename)), parent.fd, verify);
    verify();
    return result;
  } finally { for (const handle of handles.reverse()) io.closeSync(handle.fd); }
}

function readBounded(io, fd, limit) {
  const chunks = []; let size = 0;
  while (size <= limit) {
    const buffer = Buffer.alloc(Math.min(4096, limit + 1 - size));
    const count = io.readSync(fd, buffer, 0, buffer.length, null);
    if (!count) return Buffer.concat(chunks, size);
    size += count; chunks.push(buffer.subarray(0, count));
  }
  fail();
}

function stablePrivateRead(adapter, filename, limit = 65536) {
  return withParent(adapter, filename, addressed => {
    const io = adapter.fs, before = io.lstatSync(addressed);
    privateFile(before);
    if (before.size > limit) fail();
    const fd = io.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const unchanged = after => same(metadata(before), metadata(after)) && ['size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]);
      if (!unchanged(io.fstatSync(fd))) fail();
      const bytes = readBounded(io, fd, limit);
      if (!unchanged(io.fstatSync(fd)) || !unchanged(io.lstatSync(addressed)) || bytes.length !== before.size) fail();
      return bytes;
    } finally { io.closeSync(fd); }
  });
}

// The fixed legacy SOURCE alone has these reviewed non-root ancestors. This
// read-only policy must never be used by withParent or any publication path.
function readLegacySource(adapter) {
  const io = adapter.fs, handles = [];
  const legacy = new Map([
    ['/var/www/www-root', { uid: 1010, gid: 1001, mode: 0o501 }],
    ['/var/www/www-root/data', { uid: 1010, gid: 1010, mode: 0o755 }],
  ]);
  const ancestor = (stat, name) => {
    const pin = legacy.get(name);
    if (!pin) return directory(stat);
    const value = metadata(stat);
    if (!value || value.type !== 'directory' || value.uid !== pin.uid || value.gid !== pin.gid || value.mode !== pin.mode) fail();
    return value;
  };
  const fileIdentity = stat => ({ ...privateFile(stat), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
  let fd, bytes;
  try {
    let current = '/';
    for (const part of ['', 'var', 'www', 'www-root', 'data']) {
      if (part) current = path.posix.join(current, part);
      const addressed = handles.length ? adapter.anchoredPath(handles.at(-1).fd, part) : '/';
      const before = ancestor(io.lstatSync(addressed), current);
      const opened = io.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      handles.push({ fd: opened, current, before });
      if (!same(ancestor(io.fstatSync(opened), current), before)) fail();
    }
    const verify = () => {
      for (const handle of handles) {
        if (!same(ancestor(io.lstatSync(handle.current), handle.current), handle.before) || !same(ancestor(io.fstatSync(handle.fd), handle.current), handle.before)) fail();
      }
    };
    verify();
    const addressed = adapter.anchoredPath(handles.at(-1).fd, path.posix.basename(SOURCE));
    const before = fileIdentity(io.lstatSync(addressed));
    if (before.size > 65536) fail();
    fd = io.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!same(fileIdentity(io.fstatSync(fd)), before)) fail();
    verify();
    // One owned buffer, including a growth sentinel, can be wiped even when a
    // read throws after filling it. Do not retain readBounded's chunk copies.
    bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = io.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (!same(fileIdentity(io.fstatSync(fd)), before) || !same(fileIdentity(io.lstatSync(addressed)), before) || size !== before.size) fail();
    verify();
    return bytes.subarray(0, size);
  } catch {
    bytes?.fill(0); fail();
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    for (const handle of handles.reverse()) io.closeSync(handle.fd);
  }
}

function publishPrivate(adapter, filename, bytes, { exclusive = false, emptyOnly = false } = {}) {
  return withParent(adapter, filename, (addressed, parentFd, verify) => {
    const io = adapter.fs;
    if (filename !== JOURNAL) directory(io.fstatSync(parentFd), 0o700);
    const before = io.lstatSync(addressed, { throwIfNoEntry: false });
    if (before) { privateFile(before); if (exclusive || emptyOnly && before.size !== 0) fail(); }
    const temporary = adapter.anchoredPath(parentFd, `.zaruku-${randomUUID()}.tmp`);
    let fd, temporaryIdentity, published = false;
    try {
      fd = io.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      io.fchmodSync(fd, 0o600);
      io.fchownSync(fd, 0, 0);
      temporaryIdentity = privateFile(io.fstatSync(fd));
      io.writeFileSync(fd, bytes);
      io.fsyncSync(fd);
      privateFile(io.fstatSync(fd));
      verify();
      const now = io.lstatSync(addressed, { throwIfNoEntry: false });
      if (before ? !same(metadata(now), metadata(before)) || now.size !== before.size || now.ctimeMs !== before.ctimeMs : now) fail();
      if (before) io.renameSync(temporary, addressed);
      else { io.linkSync(temporary, addressed); io.unlinkSync(temporary); }
      published = true;
      io.fsyncSync(parentFd);
      if (!same(privateFile(io.lstatSync(addressed)), temporaryIdentity)) fail();
      return temporaryIdentity;
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      if (!published && temporaryIdentity) {
        const leftover = io.lstatSync(temporary, { throwIfNoEntry: false });
        if (leftover && same(metadata(leftover), temporaryIdentity)) io.unlinkSync(temporary);
      }
    }
  });
}

function statDirectory(adapter, filename) {
  // Missing nested roots are absent only when their fixed parent is also absent.
  if (filename === ROOTS.at(-1) && !adapter.fs.lstatSync(ROOTS.at(-2), { throwIfNoEntry: false })) return null;
  return withParent(adapter, filename, addressed => {
    const stat = adapter.fs.lstatSync(addressed, { throwIfNoEntry: false });
    return stat ? directory(stat, HOST_DIRECTORY_MODES[filename]) : null;
  });
}

function validateIdentity(user, group) {
  if (!user && !group) return;
  if (!user || !group || user.name !== NAME || group.name !== NAME || !Number.isSafeInteger(user.uid) || user.uid <= 0 || !Number.isSafeInteger(group.gid) || group.gid <= 0 || user.gid !== group.gid || user.shell !== '/usr/sbin/nologin' || user.home !== '/nonexistent' || !same(user.groups, [group.gid]) || !same(group.members, [])) fail();
}

function validateCreatedIdentity(adapter, step, value) {
  if (step.kind === 'group') {
    if (!value || value.name !== NAME || !Number.isSafeInteger(value.gid) || value.gid <= 0 || !same(value.members, [])) fail();
  } else if (step.kind === 'user') validateIdentity(value, adapter.serviceGroupIdentity());
}

async function stagedPredecessor(adapter, expected = null, pristine = false) {
  if (typeof adapter.stagedPredecessor !== 'function') fail();
  const value = await adapter.stagedPredecessor();
  if (!value || Object.keys(value).sort().join(',') !== 'dev,ino,manifestDigest,sourceSha' || !/^[a-f0-9]{40}$/.test(value.sourceSha) || !/^[a-f0-9]{64}$/.test(value.manifestDigest) || !Number.isSafeInteger(value.dev) || !Number.isSafeInteger(value.ino)) fail();
  const shadow = statDirectory(adapter, ROOTS.at(-2));
  if (!shadow || shadow.dev !== value.dev || shadow.ino !== value.ino || expected && !same(value, expected)) fail();
  if (pristine && !same(adapter.fs.readdirSync(ROOTS.at(-2)), ['control'])) fail();
  if (!same(adapter.fs.readdirSync(`${ROOTS.at(-2)}/control`), [value.sourceSha])) fail();
  return value;
}

export async function inspectHostBoundary(adapter) {
  try {
    if (adapter.platform !== 'linux') fail();
    const user = adapter.serviceIdentity(), group = adapter.serviceGroupIdentity();
    validateIdentity(user, group);
    const directories = ROOTS.map(target => ({ target, metadata: statDirectory(adapter, target) }));
    const present = [user, group, ...directories.map(item => item.metadata)].filter(Boolean).length;
    let predecessor = null;
    if (present === 1 && directories.at(-2).metadata) predecessor = await stagedPredecessor(adapter, null, true);
    else if (present !== 0 && present !== PLAN.length) fail();
    const port3002Free = adapter.port3002Free();
    if (port3002Free !== true) fail();
    return { state: predecessor ? 'staged' : present ? 'compliant' : 'absent', user, group, directories, listener: { port3002Free }, predecessor };
  } catch { fail(); }
}

function stepState(adapter, step) {
  if (step.kind === 'user') return adapter.serviceIdentity();
  if (step.kind === 'group') return adapter.serviceGroupIdentity();
  return statDirectory(adapter, step.target);
}

function saveRecord(adapter, record, exclusive = false) {
  publishPrivate(adapter, JOURNAL, Buffer.from(JSON.stringify(record) + '\n'), { exclusive });
}

function loadRecord(adapter) {
  const record = JSON.parse(stablePrivateRead(adapter, JOURNAL));
  if (!same(Object.keys(record).sort(), ['predecessor', 'runId', 'scope', 'status', 'steps', 'version']) || record.scope !== 'zaruku' || record.version !== 2 || !/^[a-f0-9-]{36}$/.test(record.runId) || !['creating', 'complete', 'rolled-back'].includes(record.status) || !Array.isArray(record.steps) || record.steps.length > PLAN.length) fail();
  const plan = PLAN.filter(step => !record.predecessor || step.target !== ROOTS.at(-2));
  for (const [index, step] of record.steps.entries()) {
    if (!same(Object.keys(step).sort(), ['after', 'before', 'kind', 'target']) || step.kind !== plan[index]?.kind || step.target !== plan[index].target || step.before !== null) fail();
  }
  return record;
}

export async function applyHostBoundary(adapter) {
  try {
    root(adapter);
    const before = await inspectHostBoundary(adapter);
    if (before.state === 'compliant') return before;
    const record = { version: 2, scope: 'zaruku', runId: randomUUID(), status: 'creating', predecessor: before.predecessor, steps: [] };
    saveRecord(adapter, record, true);
    for (const step of PLAN) {
      if (record.predecessor) {
        await stagedPredecessor(adapter, record.predecessor);
        if (step.target === ROOTS.at(-2)) continue;
      }
      if (stepState(adapter, step) !== null) fail();
      const entry = { ...step, before: null, after: null };
      record.steps.push(entry); saveRecord(adapter, record);
      if (step.kind === 'group') adapter.createGroup();
      else if (step.kind === 'user') adapter.createUser();
      else withParent(adapter, step.target, (addressed, parentFd) => {
        const mode = HOST_DIRECTORY_MODES[step.target];
        adapter.fs.mkdirSync(addressed, { mode });
        const fd = adapter.fs.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        try { adapter.fs.fchmodSync(fd, mode); adapter.fs.fchownSync(fd, 0, 0); adapter.fs.fsyncSync(fd); }
        finally { adapter.fs.closeSync(fd); }
        adapter.fs.fsyncSync(parentFd);
      });
      entry.after = stepState(adapter, step);
      if (!entry.after) fail();
      validateCreatedIdentity(adapter, step, entry.after);
      saveRecord(adapter, record);
    }
    const evidence = await inspectHostBoundary(adapter);
    if (record.predecessor) await stagedPredecessor(adapter, record.predecessor);
    record.status = 'complete'; saveRecord(adapter, record);
    return evidence;
  } catch { fail(); }
}

export async function rollbackNewHostBoundary(adapter, creationRecord) {
  try {
    root(adapter);
    const record = loadRecord(adapter);
    if (!same(record, creationRecord) || record.status === 'rolled-back' || !record.steps.length || adapter.port3002Free() !== true) fail();
    if (record.predecessor) await stagedPredecessor(adapter, record.predecessor);
    // Preflight every removal before removing anything. Incomplete post-step evidence is
    // deliberately not inferred: recovery requires operator review after a crashed command.
    for (const step of record.steps) {
      if (!step.after || !same(stepState(adapter, step), step.after)) fail();
      if (step.kind === 'directory') withParent(adapter, step.target, addressed => {
        const allowed = record.steps.filter(child => child.kind === 'directory' && path.posix.dirname(child.target) === step.target).map(child => path.posix.basename(child.target));
        if (adapter.fs.readdirSync(addressed).some(name => !allowed.includes(name))) fail();
      });
    }
    let userRemoved = false;
    for (const step of [...record.steps].reverse()) {
      if (record.predecessor) await stagedPredecessor(adapter, record.predecessor);
      // Linux userdel may also remove this user's same-named empty primary group.
      // It was attested before userdel; no separate deletion is needed if now absent.
      if (step.kind === 'group' && userRemoved && stepState(adapter, step) === null) continue;
      if (!same(stepState(adapter, step), step.after)) fail();
      if (step.kind === 'directory') withParent(adapter, step.target, (addressed, parentFd) => { adapter.fs.rmdirSync(addressed); adapter.fs.fsyncSync(parentFd); });
      else if (step.kind === 'user') { adapter.deleteUser(); userRemoved = true; }
      else adapter.deleteGroup();
    }
    record.status = 'rolled-back'; saveRecord(adapter, record);
  } catch { fail(); }
}

function parseCombined(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (/[\u0000-\u0009\u000b-\u001f\u007f\ufeff]/.test(text)) fail();
  const values = Object.create(null);
  const allowed = new Set(['DASHBOARD_AUTH_SECRET', 'PUPPETEER_EXECUTABLE_PATH']);
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) fail();
    const key = line.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || seen.has(key)) fail();
    seen.add(key);
    // Other dashboards' legacy values are not runtime inputs. Validate their
    // assignment identity, but never interpret or copy their value syntax.
    if (!allowed.has(key)) continue;
    let value = line.slice(separator + 1);
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      if (value.length < 2 || !value.endsWith(quote) || value.slice(1, -1).includes(quote)) fail();
      value = value.slice(1, -1);
    } else if (/[\s'"#]/.test(value)) fail();
    if (!value || /[$`\\]/.test(value)) fail();
    values[key] = value;
  }
  if (!values.DASHBOARD_AUTH_SECRET) fail();
  return values;
}

export async function installRuntimeSecrets(adapter, databasePasswordFd) {
  let source;
  try {
    root(adapter);
    if (!Number.isSafeInteger(databasePasswordFd) || databasePasswordFd < 3) fail();
    source = readLegacySource(adapter);
    const combined = parseCombined(source);
    const passwordBytes = readBounded(adapter.fs, databasePasswordFd, 4096);
    const password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(passwordBytes);
    const input = {
      ZARUKU_DB_HOST: '127.0.0.1', ZARUKU_DB_PORT: '3306', ZARUKU_DB_USER: 'dashboard_zaruku_reader',
      ZARUKU_DB_PASSWORD: password, ZARUKU_DB_NAME: 'report_bd', DASHBOARD_AUTH_SECRET: combined.DASHBOARD_AUTH_SECRET,
      NEXT_PUBLIC_BASE_URL: 'https://dashboards.adreports.ru',
    };
    if (Object.hasOwn(combined, 'PUPPETEER_EXECUTABLE_PATH')) input.PUPPETEER_EXECUTABLE_PATH = combined.PUPPETEER_EXECUTABLE_PATH;
    const bytes = serializeZarukuSecrets(input);
    publishPrivate(adapter, SECRET, bytes);
    const installed = stablePrivateRead(adapter, SECRET);
    if (!installed.equals(bytes)) fail();
    renderEnvironment(parseZarukuSecrets(installed));
    return { installed: true, path: SECRET, mode: '0600', singleLink: true, keys: Object.keys(input) };
  } catch { throw new Error('Failed to install Zaruku runtime secrets'); }
  finally { source?.fill(0); }
}

export function runtimeSecretBytes(adapter,password) {
  root(adapter);
  if(typeof password!=='string'||!/^[a-f0-9]{96}$/.test(password))fail();
  const source=readLegacySource(adapter);
  try {
    const combined=parseCombined(source);
    return serializeZarukuSecrets({ZARUKU_DB_HOST:'127.0.0.1',ZARUKU_DB_PORT:'3306',ZARUKU_DB_USER:'dashboard_zaruku_reader',ZARUKU_DB_PASSWORD:password,ZARUKU_DB_NAME:'report_bd',DASHBOARD_AUTH_SECRET:combined.DASHBOARD_AUTH_SECRET,NEXT_PUBLIC_BASE_URL:'https://dashboards.adreports.ru',...(combined.PUPPETEER_EXECUTABLE_PATH?{PUPPETEER_EXECUTABLE_PATH:combined.PUPPETEER_EXECUTABLE_PATH}:{})});
  }finally{source.fill(0);}
}

export function removeOwnedRuntimeSecret(adapter,identity) {
  root(adapter);
  return withParent(adapter,SECRET,(addressed,parent,verify)=>{
    const stat=adapter.fs.lstatSync(addressed,{throwIfNoEntry:false});
    if(!stat)return;
    if(!same(privateFile(stat),identity))fail();
    verify();adapter.fs.unlinkSync(addressed);adapter.fs.fsyncSync(parent);
  });
}

export function publishAnonymousRuntimeSecret(adapter,bytes,publish,onAllocated) {
  root(adapter);parseZarukuSecrets(bytes);
  return withParent(adapter,SECRET,(addressed,parent,verify)=>{
    const io=adapter.fs;directory(io.fstatSync(parent),0o700);
    if(io.lstatSync(addressed,{throwIfNoEntry:false}))fail();
    // Linux O_TMPFILE includes O_DIRECTORY: this inode has no filesystem name.
    const fd=io.openSync(adapter.anchoredPath(parent,'.'),0x410000|fs.constants.O_RDWR,0o600);
    let identity;
    try {
      io.fchmodSync(fd,0o600);io.fchownSync(fd,0,0);
      const stat=io.fstatSync(fd);if(!stat.isFile()||stat.nlink!==0)fail();
      identity={...metadata(stat),nlink:1};onAllocated(identity);
      io.writeFileSync(fd,bytes);io.fsyncSync(fd);verify();
      publish(fd,parent);verify();
      if(!same(privateFile(io.fstatSync(fd)),identity)||!same(privateFile(io.lstatSync(addressed)),identity))fail();
      io.fsyncSync(parent);
      const installed=stablePrivateRead(adapter,SECRET);try{if(!installed.equals(bytes))fail();}finally{installed.fill(0);}
      return identity;
    }catch(error){
      const stat=io.lstatSync(addressed,{throwIfNoEntry:false});
      if(stat&&identity&&same(metadata(stat),identity)){verify();io.unlinkSync(addressed);io.fsyncSync(parent);}
      throw error;
    }finally{io.closeSync(fd);}
  });
}

/** Inject OS boundaries for disposable tests; the CLI constructs this with no overrides. */
export function createHostAdapter(options = {}) {
  const adapter = {
    fs: options.fs ?? fs,
    platform: options.platform ?? process.platform,
    currentIdentity: options.identity ?? (() => ({ uid: process.getuid(), euid: process.geteuid() })),
    anchoredPath: options.anchoredPath ?? ((fd, name) => `/proc/self/fd/${fd}/${name}`),
  };
  const execute = (bin, args, absent = false) => {
    const result = (options.commandRunner ?? spawnSync)(bin, args, { encoding: 'utf8', env: safeEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 1048576 });
    if (result.error || result.signal || result.stderr || result.status !== 0 && !(absent && result.status === 2 && !result.stdout)) fail();
    return result.status === 2 ? null : result.stdout.trim();
  };
  const parseGroup = result => {
    const fields = result.split(':');
    if (fields.length !== 4 || !fields[0] || /[\s\u0000-\u001f\u007f]/.test(fields[0]) || !/^\d+$/.test(fields[2]) || !Number.isSafeInteger(Number(fields[2]))) fail();
    return { name: fields[0], gid: Number(fields[2]), members: fields[3] ? fields[3].split(',') : [] };
  };
  adapter.serviceGroupIdentity = () => {
    const result = execute('/usr/bin/getent', ['group', NAME], true);
    if (result === null) return null;
    const group = parseGroup(result);
    if (group.name !== NAME || group.gid <= 0) fail();
    // Permissions follow the numeric GID. A safe-looking named entry must neither
    // reverse-resolve to another group nor share its GID with another NSS name.
    const primary = parseGroup(execute('/usr/bin/getent', ['group', String(group.gid)]));
    if (!same(primary, group)) fail();
    const matching = execute('/usr/bin/getent', ['group']).split('\n').map(parseGroup).filter(entry => entry.gid === group.gid);
    if (matching.length !== 1 || !same(matching[0], group)) fail();
    return group;
  };
  adapter.serviceIdentity = () => {
    const result = execute('/usr/bin/getent', ['passwd', NAME], true);
    if (result === null) return null;
    const parsePasswd = text => {
      const fields = text.split(':');
      if (fields.length !== 7 || !/^[a-z_][a-z0-9_-]*[$]?$/i.test(fields[0]) || fields.some(field => /[\u0000-\u001f\u007f]/.test(field)) || !/^(?:0|[1-9]\d*)$/.test(fields[2]) || !/^(?:0|[1-9]\d*)$/.test(fields[3]) || !Number.isSafeInteger(Number(fields[2])) || !Number.isSafeInteger(Number(fields[3]))) fail();
      return fields;
    };
    const fields = parsePasswd(result);
    if (fields[0] !== NAME || Number(fields[2]) <= 0) fail();
    if (!same(parsePasswd(execute('/usr/bin/getent', ['passwd', fields[2]])), fields)) fail();
    const entries = execute('/usr/bin/getent', ['passwd']).split('\n').map(parsePasswd);
    if (new Set(entries.map(entry => entry[0])).size !== entries.length) fail();
    const matching = entries.filter(entry => entry[2] === fields[2]);
    if (matching.length !== 1 || !same(matching[0], fields)) fail();
    const groups = execute('/usr/bin/id', ['-G', NAME]);
    if (!/^\d+( \d+)*$/.test(groups)) fail();
    return { name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5], shell: fields[6], groups: groups.split(' ').map(Number) };
  };
  adapter.port3002Free = () => execute('/usr/bin/ss', ['-H', '-ltn', 'sport = :3002']) === '';
  adapter.createGroup = () => execute('/usr/sbin/groupadd', ['--system', NAME]);
  adapter.createUser = () => execute('/usr/sbin/useradd', ['--system', '--gid', NAME, '--shell', '/usr/sbin/nologin', '--home-dir', '/nonexistent', '--no-create-home', '--no-user-group', NAME]);
  adapter.deleteUser = () => execute('/usr/sbin/userdel', [NAME]);
  adapter.deleteGroup = () => execute('/usr/sbin/groupdel', [NAME]);
  adapter.stagedPredecessor = async () => {
    const { attestStagedPredecessor } = await import('./zaruku-shadow-dispatch.mjs');
    return attestStagedPredecessor();
  };
  adapter.publishDescriptor = bytes => {
    root(adapter);
    publishPrivate(adapter, AUTH, bytes, { emptyOnly: true });
    if (!stablePrivateRead(adapter, AUTH).equals(bytes)) fail();
  };
  return adapter;
}
