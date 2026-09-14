import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { bootstrapAbbottHost, parseCombinedEnvironment, INPUT_KEYS, HOST, runBootstrap } from './bootstrap-abbott-host.mjs';
import { createRuntimeInstaller } from './runtime-release-remote.mjs';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';

const root = path.resolve(import.meta.dirname, '..');
const allowed = JSON.parse(fs.readFileSync(path.join(root, 'deploy/abbott/environment.json')));
const generated = ['NODE_ENV', 'HOSTNAME', 'PORT', 'INTERNAL_BASE_URL'];
const values = Object.fromEntries(INPUT_KEYS.map(key => [key, `fixture-${key.toLowerCase()}`]));
Object.assign(values, { DB_NAME: 'report_bd', ABBOTT_PRIVATE_DB_NAME: 'report_bd_private', ABBOTT_EMBED_DB_NAME: 'report_bd', ABBOTT_PRIVATE_DB_USER: 'private-reader', ABBOTT_EMBED_DB_USER: 'embed-reader' });
const source = () => Object.entries({ ...values, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3001', INTERNAL_BASE_URL: 'http://127.0.0.1:3001', METRIKA_TOKEN: 'private-source-canary' }).map(([key, value], i) => `${key}=${i % 3 === 0 ? `'${value}'` : i % 3 === 1 ? `"${value}"` : value}`).join('\n') + '\n';

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-bootstrap-test-')));
  const resolve = name => path.join(directory, name);
  const metadata = new Map();
  const descriptors = new Map();
  const io = { constants: fs.constants };
  for (const method of ['lstatSync', 'fstatSync']) io[method] = (name, ...args) => {
    const mapped = typeof name === 'number' ? name : resolve(name);
    const stat = fs[method](mapped, ...args);
    if (!stat) return stat;
    const key = typeof name === 'number' ? descriptors.get(name) : name;
    const meta = metadata.get(key) ?? { uid: 0, gid: 0 };
    stat.uid = meta.uid; stat.gid = meta.gid;
    if (key === '/') stat.mode = (stat.mode & ~0o777) | 0o755;
    return stat;
  };
  io.openSync = (name, ...args) => { const fd = fs.openSync(resolve(name), ...args); descriptors.set(fd, name); return fd; };
  io.closeSync = fd => { descriptors.delete(fd); fs.closeSync(fd); };
  io.fchownSync = (fd, uid, gid) => metadata.set(descriptors.get(fd), { uid, gid });
  for (const method of ['readFileSync', 'writeFileSync', 'mkdirSync', 'unlinkSync', 'chmodSync']) io[method] = (name, ...args) => fs[method](typeof name === 'number' ? name : resolve(name), ...args);
  io.linkSync = (from, to) => { fs.linkSync(resolve(from), resolve(to)); metadata.set(to, metadata.get(from) ?? { uid: 0, gid: 0 }); };
  io.fchmodSync = fs.fchmodSync; io.fsyncSync = fs.fsyncSync;
  io.realpathSync = name => fs.realpathSync(resolve(name)).slice(directory.length) || '/';
  for (const name of ['/var', '/var/www', HOST.sourceDir, '/proc/sys/kernel/random', `/proc/${HOST.sourcePid}`]) fs.mkdirSync(resolve(name), { recursive: true, mode: 0o755 });
  fs.writeFileSync(resolve(HOST.sourceEnv), source(), { mode: 0o600 });
  fs.writeFileSync(resolve(HOST.sourceStamp), HOST.sourceSha + '\n', { mode: 0o644 });
  metadata.set(HOST.sourceDir, { uid: 501, gid: 0 });
  metadata.set(HOST.sourceEnv, { uid: 501, gid: 0 });
  metadata.set(HOST.sourceStamp, { uid: 501, gid: 0 });
  const events = [];
  let user = null, group = null;
  const platform = { fs: io, uid: () => 0, hostname: () => HOST.hostname,
    verifySourceProcess: () => {},
    user: () => user, group: () => group,
    createGroup() { events.push('group'); group = { name: HOST.account, gid: 991, members: [] }; },
    createUser() { events.push('user'); user = { name: HOST.account, uid: 991, gid: 991, home: '/nonexistent', shell: '/usr/sbin/nologin', groups: [991] }; },
    directoryPath: fd => descriptors.get(fd),
  };
  return { platform, events, resolve, metadata, setUser: value => { user = value; }, setGroup: value => { group = value; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('copies only the existing Abbott input allowlist and preserves worker-generated runtime values', () => {
  assert.deepEqual(INPUT_KEYS, allowed.filter(key => !generated.includes(key)));
  const parsed = parseCombinedEnvironment(Buffer.from(source()));
  assert.deepEqual(parsed, values);
  assert.ok(!Object.hasOwn(parsed, 'METRIKA_TOKEN'));
  const renderer = createRuntimeInstaller(RUNTIME_MANIFESTS.abbott, allowed);
  const rendered = renderer.renderEnvironment(parsed);
  assert.deepEqual(generated.map(key => rendered[key]), ['production', '127.0.0.1', '3004', 'http://127.0.0.1:3004']);
  assert.deepEqual(renderer.parseRuntimeSecrets(renderer.serializeRuntimeSecrets(parsed)), values);
});

test('bootstrap is idempotent and writes only a root-only credential input without rotating values', () => {
  const f = fixture();
  try {
    assert.equal(bootstrapAbbottHost(f.platform), 'created');
    const before = fs.readFileSync(f.resolve(HOST.targetFile));
    const inode = fs.statSync(f.resolve(HOST.targetFile)).ino;
    assert.equal(fs.statSync(f.resolve(HOST.targetDir)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(f.resolve(HOST.targetFile)).mode & 0o777, 0o600);
    assert.deepEqual(f.metadata.get(HOST.targetFile), { uid: 0, gid: 0 });
    assert.equal(bootstrapAbbottHost(f.platform), 'unchanged');
    assert.equal(fs.statSync(f.resolve(HOST.targetFile)).ino, inode);
    assert.deepEqual(fs.readFileSync(f.resolve(HOST.targetFile)), before);
    assert.deepEqual(f.events, ['group', 'user']);
    assert.deepEqual(fs.readdirSync(f.resolve(HOST.targetDir)), ['runtime.env']);
    assert.ok(!before.includes(Buffer.from('private-source-canary')));
  } finally { f.cleanup(); }
});

test('invalid source inputs never create an account or credentials', () => {
  const invalid = [source().replace(/^DB_HOST=.*\n/m, ''), source() + "DB_HOST='duplicate'\n", source().replace(/^DB_HOST=.*$/m, "DB_HOST='broken"), source().replace(/^DB_HOST=.*$/m, "DB_HOST='quote'bad'"), source().replace(/^DB_HOST=.*$/m, 'DB_HOST=bad\\value'), source().replace(/^DB_HOST=.*$/m, 'DB_HOST=bad`value'), source() + 'INVALID LINE\n', source() + '\u0000', 'x'.repeat(65537), source().replace('report_bd_private', 'report_bd')];
  for (const body of invalid) {
    const f = fixture();
    try {
      fs.writeFileSync(f.resolve(HOST.sourceEnv), body);
      assert.throws(() => bootstrapAbbottHost(f.platform));
      assert.deepEqual(f.events, []);
      assert.equal(fs.existsSync(f.resolve(HOST.targetFile)), false);
    } finally { f.cleanup(); }
  }
});

test('source identity, symlink, ownership and permission drift fail closed', () => {
  const changes = [
    f => { f.platform.hostname = () => 'different-host'; },
    f => { f.platform.uid = () => 501; },
    f => { f.platform.verifySourceProcess = () => { throw Error('changed'); }; },
    f => fs.writeFileSync(f.resolve(HOST.sourceStamp), 'a'.repeat(40) + '\n'),
    f => f.metadata.set(HOST.sourceEnv, { uid: 0, gid: 0 }),
    f => fs.chmodSync(f.resolve(HOST.sourceEnv), 0o644),
    f => fs.linkSync(f.resolve(HOST.sourceEnv), f.resolve(HOST.sourceEnv + '.linked')),
    f => { fs.renameSync(f.resolve(HOST.sourceEnv), f.resolve(HOST.sourceEnv + '.saved')); fs.symlinkSync(f.resolve(HOST.sourceEnv + '.saved'), f.resolve(HOST.sourceEnv)); },
    f => { fs.renameSync(f.resolve(HOST.sourceDir), f.resolve(HOST.sourceDir + '.saved')); fs.symlinkSync(f.resolve(HOST.sourceDir + '.saved'), f.resolve(HOST.sourceDir)); },
  ];
  for (const change of changes) { const f = fixture(); try { change(f); assert.throws(() => bootstrapAbbottHost(f.platform)); assert.deepEqual(f.events, []); } finally { f.cleanup(); } }
});

test('wrong existing service-account or group identity is never repaired', () => {
  const changes = [
    f => f.setUser({ name: HOST.account, uid: 0, gid: 991, home: '/nonexistent', shell: '/usr/sbin/nologin', groups: [991] }),
    f => f.setUser({ name: HOST.account, uid: 991, gid: 991, home: '/root', shell: '/bin/bash', groups: [991] }),
    f => f.setUser({ name: HOST.account, uid: 991, gid: 991, home: '/nonexistent', shell: '/usr/sbin/nologin', groups: [991, 0] }),
    f => f.setGroup({ name: HOST.account, gid: 0, members: [] }),
    f => f.setGroup({ name: HOST.account, gid: 991, members: ['other'] }),
  ];
  for (const change of changes) { const f = fixture(); try { change(f); assert.throws(() => bootstrapAbbottHost(f.platform)); assert.deepEqual(f.events, []); } finally { f.cleanup(); } }
});

test('the dedicated account cannot reuse the combined source owner UID', () => {
  const f = fixture();
  try {
    f.setGroup({ name: HOST.account, gid: 991, members: [] });
    f.setUser({ name: HOST.account, uid: 501, gid: 991, home: '/nonexistent', shell: '/usr/sbin/nologin', groups: [991] });
    assert.throws(() => bootstrapAbbottHost(f.platform));
    assert.deepEqual(f.events, []);
    assert.equal(fs.existsSync(f.resolve(HOST.targetFile)), false);
  } finally { f.cleanup(); }
});

test('failures preserve an existing input file byte-for-byte and never repair its permissions', () => {
  const changes = [
    f => fs.writeFileSync(f.resolve(HOST.sourceEnv), source().replace('fixture-db_host', 'new-host')),
    f => fs.chmodSync(f.resolve(HOST.targetFile), 0o644),
    f => f.metadata.set(HOST.targetFile, { uid: 501, gid: 0 }),
    f => fs.chmodSync(f.resolve(HOST.targetDir), 0o750),
    f => { fs.renameSync(f.resolve(HOST.targetDir), f.resolve(HOST.targetDir + '.saved')); fs.symlinkSync(f.resolve(HOST.targetDir + '.saved'), f.resolve(HOST.targetDir)); },
    f => { fs.renameSync(f.resolve(HOST.targetFile), f.resolve(HOST.targetFile + '.saved')); fs.symlinkSync(f.resolve(HOST.targetFile + '.saved'), f.resolve(HOST.targetFile)); },
  ];
  for (const change of changes) { const f = fixture(); try { bootstrapAbbottHost(f.platform); const before = fs.readFileSync(f.resolve(HOST.targetFile)); change(f); assert.throws(() => bootstrapAbbottHost(f.platform)); assert.deepEqual(fs.readFileSync(f.resolve(HOST.targetFile)), before); } finally { f.cleanup(); } }
});

test('real host adapter uses only fixed account commands and verifies the pinned live source identity', () => {
  const f = fixture();
  try {
    const stat = `${HOST.sourcePid} (next-server) ${['S', ...Array(18).fill('0'), HOST.sourceStart].join(' ')}`;
    fs.writeFileSync(f.resolve(`/proc/${HOST.sourcePid}/stat`), stat);
    fs.writeFileSync(f.resolve('/proc/sys/kernel/random/boot_id'), HOST.sourceBoot + '\n');
    fs.symlinkSync(f.resolve(HOST.sourceDir), f.resolve(`/proc/${HOST.sourcePid}/cwd`));
    let user = false, group = false;
    const calls = [];
    const userRow = `${HOST.account}:x:991:991::/nonexistent:/usr/sbin/nologin`;
    const groupRow = `${HOST.account}:x:991:`;
    const context = { fs: f.platform.fs, os: { hostname: () => HOST.hostname }, path, randomUUID, Buffer, TextDecoder,
      process: { getuid: () => 0 },
      execFileSync(binary, args, options) {
        calls.push([binary, Array.from(args)]);
        assert.deepEqual(JSON.parse(JSON.stringify(options.env)), { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' });
        assert.deepEqual(Array.from(options.stdio), ['ignore', 'pipe', 'pipe']);
        if (binary === '/usr/bin/getent') {
          assert.ok([HOST.account, '991'].includes(args[1]));
          if (args[0] === 'passwd' && user) return userRow;
          if (args[0] === 'group' && group) return groupRow;
          throw Object.assign(Error('not found'), { status: 2 });
        }
        if (binary === '/usr/bin/id') { assert.deepEqual(Array.from(args), ['-G', HOST.account]); return '991'; }
        if (binary === '/usr/sbin/groupadd') { assert.deepEqual(Array.from(args), ['--system', HOST.account]); group = true; return ''; }
        if (binary === '/usr/sbin/useradd') { assert.deepEqual(Array.from(args), ['--system', '--gid', HOST.account, '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', HOST.account]); user = true; return ''; }
        throw Error('unapproved host command');
      },
    };
    vm.createContext(context);
    const moduleSource = fs.readFileSync(path.join(root, 'scripts/bootstrap-abbott-host.mjs'), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ').split('\nif (process.argv.length')[0];
    vm.runInContext(moduleSource + '\nthis.hostPlatform = realPlatform; this.bootstrap = bootstrapAbbottHost;', context);
    context.hostPlatform.directoryPath = f.platform.directoryPath;
    assert.equal(context.bootstrap(), 'created');
    assert.equal(context.bootstrap(), 'unchanged');
    assert.equal(calls.filter(([binary]) => binary === '/usr/sbin/useradd').length, 1);
    assert.equal(calls.filter(([binary]) => binary === '/usr/sbin/groupadd').length, 1);
    const before = fs.readFileSync(f.resolve(HOST.targetFile));
    fs.writeFileSync(f.resolve(`/proc/${HOST.sourcePid}/stat`), stat.replace(HOST.sourceStart, '999'));
    assert.throws(() => context.bootstrap());
    assert.deepEqual(fs.readFileSync(f.resolve(HOST.targetFile)), before);
  } finally { f.cleanup(); }
});

test('failed atomic publication removes only its temporary file and preserves a competing target', () => {
  const f = fixture();
  try {
    f.platform.fs.linkSync = () => { fs.writeFileSync(f.resolve(HOST.targetFile), 'existing-private-sentinel', { mode: 0o600 }); throw Error('publication failed'); };
    assert.throws(() => bootstrapAbbottHost(f.platform));
    assert.equal(fs.readFileSync(f.resolve(HOST.targetFile), 'utf8'), 'existing-private-sentinel');
    assert.deepEqual(fs.readdirSync(f.resolve(HOST.targetDir)), ['runtime.env']);
  } finally { f.cleanup(); }
});

test('failed exclusive temporary open never removes a file it did not create', () => {
  const f = fixture();
  let competing;
  try {
    const open = f.platform.fs.openSync;
    f.platform.fs.openSync = (name, ...args) => {
      if (name.endsWith('.tmp')) {
        competing = name;
        fs.writeFileSync(f.resolve(name), 'unowned-private-sentinel', { mode: 0o600 });
        throw Object.assign(Error('already exists'), { code: 'EEXIST' });
      }
      return open(name, ...args);
    };
    assert.throws(() => bootstrapAbbottHost(f.platform));
    assert.equal(fs.readFileSync(f.resolve(competing), 'utf8'), 'unowned-private-sentinel');
    assert.equal(fs.existsSync(f.resolve(HOST.targetFile)), false);
  } finally { f.cleanup(); }
});

test('operator entry point emits only fixed status and refuses arguments/environment overrides', () => {
  const f = fixture();
  try {
    let output = '';
    const emit = text => { output += text; };
    assert.equal(runBootstrap(f.platform, [], {}, emit), 0);
    assert.equal(output, 'Abbott host prerequisites: created\n');
    output = '';
    f.platform.verifySourceProcess = () => { throw Error('private-source-canary'); };
    assert.equal(runBootstrap(f.platform, [], {}, emit), 1);
    assert.equal(output, 'Abbott host bootstrap refused\n');
    assert.equal(runBootstrap(f.platform, ['override'], {}, emit), 1);
    for (const key of ['PATH', 'NODE_OPTIONS', 'SOURCE_ENV', 'VPS', 'HOME', 'APP_DIR']) assert.equal(runBootstrap(f.platform, [], { [key]: 'x' }, emit), 1);
    assert.ok(!output.includes('private-source-canary'));
  } finally { f.cleanup(); }
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/bootstrap-abbott-host.mjs'), 'override'], { env: {}, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout + result.stderr, 'Abbott host bootstrap refused\n');
});
