import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadShadowAuthority } from './zaruku-production-shadow-contract.mjs';
import { parseZarukuSecrets, serializeZarukuSecrets, renderEnvironment } from './runtime-release-remote.mjs';

const NAME = 'dashboard-zaruku';
const AUTHORITY = path.resolve(import.meta.dirname, '../deploy/zaruku/production-shadow.json');
const JOURNAL = '/var/www/.dashboard-zaruku-host-creation.json';
const SOURCE = '/var/www/www-root/data/.production.env';
const SECRET = '/var/www/.dashboard-zaruku-secrets/runtime.env';
const AUTH = '/var/www/.dashboard-zaruku-shadow/auth.json';
const ROOTS = Object.freeze(['/var/www/dashboard-zaruku-releases', '/var/www/dashboard-zaruku-backups', '/var/www/.dashboard-zaruku-control', '/var/www/.dashboard-zaruku-secrets', '/var/www/.dashboard-zaruku-shadow', '/var/www/.dashboard-zaruku-shadow/evidence']);
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
    return stat ? directory(stat, 0o700) : null;
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

export async function inspectHostBoundary(adapter) {
  try {
    if (adapter.platform !== 'linux') fail();
    const user = adapter.serviceIdentity(), group = adapter.serviceGroupIdentity();
    validateIdentity(user, group);
    const directories = ROOTS.map(target => ({ target, metadata: statDirectory(adapter, target) }));
    const present = [user, group, ...directories.map(item => item.metadata)].filter(Boolean).length;
    if (present !== 0 && present !== PLAN.length) fail();
    const port3002Free = adapter.port3002Free();
    if (port3002Free !== true) fail();
    return { state: present ? 'compliant' : 'absent', user, group, directories, listener: { port3002Free } };
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
  if (!same(Object.keys(record).sort(), ['runId', 'scope', 'status', 'steps', 'version']) || record.scope !== 'zaruku' || record.version !== 1 || !/^[a-f0-9-]{36}$/.test(record.runId) || !['creating', 'complete', 'rolled-back'].includes(record.status) || !Array.isArray(record.steps) || record.steps.length > PLAN.length) fail();
  for (const [index, step] of record.steps.entries()) {
    if (!same(Object.keys(step).sort(), ['after', 'before', 'kind', 'target']) || step.kind !== PLAN[index].kind || step.target !== PLAN[index].target || step.before !== null) fail();
  }
  return record;
}

export async function applyHostBoundary(adapter) {
  try {
    root(adapter);
    const before = await inspectHostBoundary(adapter);
    if (before.state === 'compliant') return before;
    const record = { version: 1, scope: 'zaruku', runId: randomUUID(), status: 'creating', steps: [] };
    saveRecord(adapter, record, true);
    for (const step of PLAN) {
      if (stepState(adapter, step) !== null) fail();
      const entry = { ...step, before: null, after: null };
      record.steps.push(entry); saveRecord(adapter, record);
      if (step.kind === 'group') adapter.createGroup();
      else if (step.kind === 'user') adapter.createUser();
      else withParent(adapter, step.target, (addressed, parentFd) => {
        adapter.fs.mkdirSync(addressed, { mode: 0o700 });
        const fd = adapter.fs.openSync(addressed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        try { adapter.fs.fchmodSync(fd, 0o700); adapter.fs.fchownSync(fd, 0, 0); adapter.fs.fsyncSync(fd); }
        finally { adapter.fs.closeSync(fd); }
        adapter.fs.fsyncSync(parentFd);
      });
      entry.after = stepState(adapter, step);
      if (!entry.after) fail();
      validateCreatedIdentity(adapter, step, entry.after);
      saveRecord(adapter, record);
    }
    const evidence = await inspectHostBoundary(adapter);
    record.status = 'complete'; saveRecord(adapter, record);
    return evidence;
  } catch { fail(); }
}

export async function rollbackNewHostBoundary(adapter, creationRecord) {
  try {
    root(adapter);
    const record = loadRecord(adapter);
    if (!same(record, creationRecord) || record.status === 'rolled-back' || !record.steps.length || adapter.port3002Free() !== true) fail();
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
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) fail();
    let value = match[2];
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      if (value.length < 2 || !value.endsWith(quote) || value.slice(1, -1).includes(quote)) fail();
      value = value.slice(1, -1);
    } else if (/[\s'"#]/.test(value)) fail();
    if (/[$`\\]/.test(value)) fail();
    values[match[1]] = value;
  }
  return values;
}

export async function installRuntimeSecrets(adapter, databasePasswordFd) {
  try {
    root(adapter);
    if (!Number.isSafeInteger(databasePasswordFd) || databasePasswordFd < 3) fail();
    const combined = parseCombined(stablePrivateRead(adapter, SOURCE));
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
  adapter.serviceGroupIdentity = () => {
    const result = execute('/usr/bin/getent', ['group', NAME], true);
    if (result === null) return null;
    const fields = result.split(':');
    if (fields.length !== 4 || !/^\d+$/.test(fields[2])) fail();
    return { name: fields[0], gid: Number(fields[2]), members: fields[3] ? fields[3].split(',') : [] };
  };
  adapter.serviceIdentity = () => {
    const result = execute('/usr/bin/getent', ['passwd', NAME], true);
    if (result === null) return null;
    const fields = result.split(':');
    if (fields.length !== 7 || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3])) fail();
    const groups = execute('/usr/bin/id', ['-G', NAME]);
    if (!/^\d+( \d+)*$/.test(groups)) fail();
    return { name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5], shell: fields[6], groups: groups.split(' ').map(Number) };
  };
  adapter.port3002Free = () => execute('/usr/bin/ss', ['-H', '-ltn', 'sport = :3002']) === '';
  adapter.createGroup = () => execute('/usr/sbin/groupadd', ['--system', NAME]);
  adapter.createUser = () => execute('/usr/sbin/useradd', ['--system', '--gid', NAME, '--shell', '/usr/sbin/nologin', '--home-dir', '/nonexistent', '--no-create-home', '--no-user-group', NAME]);
  adapter.deleteUser = () => execute('/usr/sbin/userdel', [NAME]);
  adapter.deleteGroup = () => execute('/usr/sbin/groupdel', [NAME]);
  adapter.publishDescriptor = bytes => {
    root(adapter);
    publishPrivate(adapter, AUTH, bytes, { emptyOnly: true });
    if (!stablePrivateRead(adapter, AUTH).equals(bytes)) fail();
  };
  return adapter;
}

export async function hostMain(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || !['check', 'apply', 'rollback-created'].includes(args[0]) || args[1] !== AUTHORITY) fail();
    loadShadowAuthority(AUTHORITY);
    const adapter = createHostAdapter();
    if (args[0] === 'rollback-created') {
      await rollbackNewHostBoundary(adapter, loadRecord(adapter));
      process.stdout.write('{"status":"rolled-back"}\n');
    } else process.stdout.write(JSON.stringify(await (args[0] === 'check' ? inspectHostBoundary : applyHostBoundary)(adapter)) + '\n');
  } catch { process.stderr.write('Refusing Zaruku host boundary operation\n'); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await hostMain();
