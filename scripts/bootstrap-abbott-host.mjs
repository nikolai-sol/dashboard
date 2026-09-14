import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// This checkpoint is bound to the read-only host proof of 2026-09-15.
// Changing any source identity requires a new review, never a caller override.
export const HOST = Object.freeze({
  hostname: 'ybjqbzojln', account: 'dashboard-abbott',
  sourceDir: '/var/www/dashboard', sourceEnv: '/var/www/dashboard/.env',
  sourceStamp: '/var/www/dashboard/.release-source-sha',
  sourceSha: '8f389a28df1c4b741ec33b7538f0354b74f5a40e',
  sourcePid: 3722244, sourceStart: '122353749', sourceBoot: '1c736efb-eaa2-42d9-b247-bd1a2ef36a4e',
  targetDir: '/var/www/.dashboard-abbott-secrets',
  targetFile: '/var/www/.dashboard-abbott-secrets/runtime.env',
});
export const INPUT_KEYS = Object.freeze([
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB',
  'ABBOTT_PRIVATE_DB_HOST', 'ABBOTT_PRIVATE_DB_PORT', 'ABBOTT_PRIVATE_DB_USER', 'ABBOTT_PRIVATE_DB_PASSWORD', 'ABBOTT_PRIVATE_DB_NAME',
  'ABBOTT_EMBED_DB_HOST', 'ABBOTT_EMBED_DB_PORT', 'ABBOTT_EMBED_DB_USER', 'ABBOTT_EMBED_DB_PASSWORD', 'ABBOTT_EMBED_DB_NAME',
  'NEXT_PUBLIC_BASE_URL', 'DASHBOARD_AUTH_SECRET', 'ABBOTT_DASHBOARD_EMBED_KEY', 'PUPPETEER_EXECUTABLE_PATH',
]);

const refuse = () => { throw new Error('Abbott host bootstrap refused'); };
const REQUIRED = INPUT_KEYS.filter(key => !key.startsWith('MYSQL_') && !['NEXT_PUBLIC_BASE_URL', 'PUPPETEER_EXECUTABLE_PATH'].includes(key));
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'mtimeMs', 'ctimeMs', 'nlink'].every(key => a[key] === b[key]);
const sameDirectory = (a, b) => ['dev', 'ino', 'mode', 'uid', 'gid'].every(key => a[key] === b[key]);

export function parseCombinedEnvironment(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) refuse();
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (/[\u0000-\u0009\u000b-\u001f\u007f\ufeff]/.test(text)) refuse();
  const result = {}, seen = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export )?([A-Z][A-Z0-9_]*) *= *(.*)$/.exec(line);
    if (!match || seen.has(match[1])) refuse();
    seen.add(match[1]);
    let value = match[2];
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0], end = value.indexOf(quote, 1);
      if (end < 0 || !/^(?: *#.*)?$/.test(value.slice(end + 1))) refuse();
      value = value.slice(1, end);
    } else value = value.replace(/ +#.*$/, '').trim();
    if (/[\u0000-\u001f\u007f'"\\`]/.test(value)) refuse();
    if (INPUT_KEYS.includes(match[1])) {
      if (!value.trim()) refuse();
      result[match[1]] = value;
    }
  }
  if (REQUIRED.some(key => !result[key]) || result.DB_NAME !== 'report_bd' || result.ABBOTT_PRIVATE_DB_NAME !== 'report_bd_private' || result.ABBOTT_EMBED_DB_NAME !== 'report_bd' || result.ABBOTT_PRIVATE_DB_USER === result.ABBOTT_EMBED_DB_USER) refuse();
  return result;
}

function directory(io, name, uid, gid, mode) {
  const stat = io.lstatSync(name);
  if (!stat.isDirectory() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o7777) !== mode || io.realpathSync(name) !== name) refuse();
  return stat;
}

function privateRead(io, name, uid, gid, mode) {
  const stat = io.lstatSync(name);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536 || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o7777) !== mode) refuse();
  const fd = io.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!sameFile(stat, io.fstatSync(fd))) refuse();
    const bytes = io.readFileSync(fd);
    if (!sameFile(stat, io.fstatSync(fd)) || !sameFile(stat, io.lstatSync(name))) refuse();
    return bytes;
  } finally { io.closeSync(fd); }
}

function sourceSnapshot(platform) {
  const io = platform.fs;
  for (const name of ['/', '/var', '/var/www']) directory(io, name, 0, 0, 0o755);
  directory(io, HOST.sourceDir, 501, 0, 0o755);
  platform.verifySourceProcess();
  const stamp = privateRead(io, HOST.sourceStamp, 501, 0, 0o644);
  if (stamp.toString() !== HOST.sourceSha + '\n') refuse();
  return privateRead(io, HOST.sourceEnv, 501, 0, 0o600);
}

function validateAccounts(user, group) {
  if (group && (group.name !== HOST.account || !Number.isInteger(group.gid) || group.gid <= 0 || group.gid >= 1000 || !Array.isArray(group.members) || group.members.length)) refuse();
  if (user && (!group || user.name !== HOST.account || !Number.isInteger(user.uid) || user.uid <= 0 || user.uid === 501 || user.uid >= 1000 || user.gid !== group.gid || user.home !== '/nonexistent' || user.shell !== '/usr/sbin/nologin' || user.groups.length !== 1 || user.groups[0] !== group.gid)) refuse();
}

export function bootstrapAbbottHost(platform = realPlatform) {
  if (platform.uid() !== 0 || platform.hostname() !== HOST.hostname) refuse();
  const io = platform.fs;
  const source = sourceSnapshot(platform);
  const values = parseCombinedEnvironment(source);
  const desired = Buffer.from(INPUT_KEYS.filter(key => Object.hasOwn(values, key)).map(key => `${key}='${values[key]}'\n`).join(''));
  let user = platform.user(), group = platform.group();
  validateAccounts(user, group);
  const targetExists = io.lstatSync(HOST.targetDir, { throwIfNoEntry: false });
  if (targetExists) directory(io, HOST.targetDir, 0, 0, 0o700);
  const previous = io.lstatSync(HOST.targetFile, { throwIfNoEntry: false });
  if (previous && !privateRead(io, HOST.targetFile, 0, 0, 0o600).equals(desired)) refuse();
  if (!group) { platform.createGroup(); group = platform.group(); validateAccounts(user, group); if (!group) refuse(); }
  if (!user) { platform.createUser(); user = platform.user(); validateAccounts(user, group); if (!user) refuse(); }
  if (!sourceSnapshot(platform).equals(source)) refuse();
  if (previous) {
    if (!privateRead(io, HOST.targetFile, 0, 0, 0o600).equals(desired)) refuse();
    source.fill(0); desired.fill(0);
    return 'unchanged';
  }
  if (!targetExists) io.mkdirSync(HOST.targetDir, { mode: 0o700 });
  const stat = directory(io, HOST.targetDir, 0, 0, 0o700);
  const fd = io.openSync(HOST.targetDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let temporary;
  try {
    if (!sameDirectory(stat, io.fstatSync(fd))) refuse();
    // Production paths below the retained root-only directory descriptor cannot
    // follow a subsequently replaced lexical directory. Fixture seam is local-only.
    const retained = platform.directoryPath(fd);
    const candidate = `${retained}/.runtime-${randomUUID()}.tmp`;
    const output = io.openSync(candidate, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    temporary = candidate;
    try {
      io.fchownSync(output, 0, 0); io.fchmodSync(output, 0o600);
      io.writeFileSync(output, desired); io.fsyncSync(output);
    } finally { io.closeSync(output); }
    if (!sameDirectory(stat, io.lstatSync(HOST.targetDir)) || !sourceSnapshot(platform).equals(source)) refuse();
    // link is atomic and refuses an existing destination. Bootstrap never
    // replaces or rotates a prior secret input, even with different source bytes.
    io.linkSync(temporary, `${retained}/runtime.env`);
    io.unlinkSync(temporary); temporary = undefined;
    io.fsyncSync(fd);
    if (!sameDirectory(stat, io.lstatSync(HOST.targetDir)) || !privateRead(io, HOST.targetFile, 0, 0, 0o600).equals(desired)) refuse();
    return 'created';
  } finally {
    try { if (temporary) io.unlinkSync(temporary); } finally { io.closeSync(fd); }
    source.fill(0); desired.fill(0);
  }
}

function command(binary, args, missing = false) {
  try { return execFileSync(binary, args, { env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }).trim(); }
  catch (error) { if (missing && error.status === 2) return null; refuse(); }
}

const realPlatform = {
  fs, uid: () => process.getuid(), hostname: () => os.hostname(),
  directoryPath: fd => `/proc/self/fd/${fd}`,
  verifySourceProcess() {
    const stat = fs.readFileSync(`/proc/${HOST.sourcePid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    if (start !== HOST.sourceStart || fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() !== HOST.sourceBoot || fs.realpathSync(`/proc/${HOST.sourcePid}/cwd`) !== HOST.sourceDir) refuse();
  },
  user() {
    const entry = command('/usr/bin/getent', ['passwd', HOST.account], true);
    if (entry === null) return null;
    const fields = entry.split(':');
    if (fields.length !== 7 || entry.includes('\n') || command('/usr/bin/getent', ['passwd', fields[2]]) !== entry) refuse();
    return { name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5], shell: fields[6], groups: command('/usr/bin/id', ['-G', HOST.account]).split(/\s+/).map(Number) };
  },
  group() {
    const entry = command('/usr/bin/getent', ['group', HOST.account], true);
    if (entry === null) return null;
    const fields = entry.split(':');
    if (fields.length !== 4 || entry.includes('\n') || command('/usr/bin/getent', ['group', fields[2]]) !== entry) refuse();
    return { name: fields[0], gid: Number(fields[2]), members: fields[3] ? fields[3].split(',') : [] };
  },
  createGroup() { command('/usr/sbin/groupadd', ['--system', HOST.account]); },
  createUser() { command('/usr/sbin/useradd', ['--system', '--gid', HOST.account, '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', HOST.account]); },
};

export function runBootstrap(platform, args, environment, emit) {
  try {
    if (args.length || Object.keys(environment).length) refuse();
    emit(`Abbott host prerequisites: ${bootstrapAbbottHost(platform)}\n`);
    return 0;
  } catch { emit('Abbott host bootstrap refused\n'); return 1; }
}

if (process.argv.length === 1 || process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runBootstrap(realPlatform, process.argv.slice(2), process.env, text => process.stdout.write(text));
}
