import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const modulePath = new URL('./deploy-runtime.mjs', import.meta.url);

test('Abbott authority is exact and repository ref is pinned', async () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/release.json')), 'fixed Abbott manifest is missing');
  assert.deepEqual(JSON.parse(read('deploy/abbott/release.json')), RUNTIME_MANIFESTS.abbott);
  const repository = JSON.parse(read('deploy/abbott/repository.json'));
  assert.deepEqual(repository, { version: 1, url: 'git@github.com:nikolai-sol/dashboard.git', ref: 'refs/heads/release/abbott', base: '8f389a28df1c4b741ec33b7538f0354b74f5a40e' });
  const { validateAuthority } = await import(modulePath);
  assert.deepEqual(validateAuthority(path.join(root, 'deploy/abbott/release.json')), RUNTIME_MANIFESTS.abbott);
  for (const filename of ['deploy/zaruku/release.json', 'deploy/medroche/release.json', '/tmp/release.json']) assert.throws(() => validateAuthority(filename));
});

test('wrappers reject arguments before any deployment and cannot forward overrides', () => {
  for (const name of ['deploy-abbott', 'rollback-abbott']) {
    assert.ok(fs.existsSync(path.join(root, `scripts/${name}.sh`)), 'fixed wrapper is missing');
    const source = read(`scripts/${name}.sh`);
    assert.doesNotMatch(source, /\$\{?(?:APP_NAME|APP_PORT|APP_DIR|RELEASE_BRANCH)/);
    assert.doesNotMatch(source, /\$@/);
    const result = spawnSync('/bin/bash', [path.join(root, `scripts/${name}.sh`), 'dashboard-next'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /arguments/);
  }
});

test('authority overrides are rejected before network or subprocess dispatch', async () => {
  assert.ok(fs.existsSync(modulePath), 'runtime installer is missing');
  const { validateInvocation, FORBIDDEN_ENV } = await import(modulePath);
  const args = [path.join(root, 'deploy/abbott/release.json'), 'deploy'];
  assert.equal(validateInvocation(args, {}).action, 'deploy');
  for (const key of [...FORBIDDEN_ENV, 'GIT_CONFIG_COUNT', 'GIT_DIR', 'GIT_SSH_COMMAND']) assert.throws(() => validateInvocation(args, { [key]: '' }), /override/);
  assert.throws(() => validateInvocation([...args, 'other'], {}));
  assert.throws(() => validateInvocation([args[0], 'stop-all'], {}));
});

function launch(text, inherited = { METRIKA_TOKEN: 'discard', ARBITRARY: 'discard', NODE_OPTIONS: 'discard' }) {
  const loaded = [];
  const environment = { ...inherited };
  vm.runInNewContext(read('deploy/abbott/start.cjs'), {
    process: { env: environment },
    require(name) {
      if (name === 'node:fs') return { readFileSync(filename) { assert.equal(filename, '/var/www/dashboard-abbott/.env'); return text; } };
      loaded.push(name);
    },
  });
  return { loaded, environment };
}
const runtime = { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3004', DB_HOST: 'localhost', DB_PORT: '3306', DB_USER: 'reader', DB_PASSWORD: 'test-only', DB_NAME: 'report_bd', DASHBOARD_AUTH_SECRET: 'test-only', ABBOTT_DASHBOARD_EMBED_KEY: 'test-only', INTERNAL_BASE_URL: 'http://127.0.0.1:3004', NEXT_PUBLIC_BASE_URL: 'https://dashboards.adreports.ru', PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium' };
for (const prefix of ['ABBOTT_PRIVATE_DB', 'ABBOTT_EMBED_DB']) for (const field of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) runtime[`${prefix}_${field}`] = 'test-only';
const serialize = value => Object.entries(value).map(([key, value]) => `${key}='${value}'\n`).join('');

test('launcher clears inheritance, keeps required runtime keys and requires only Abbott server', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/start.cjs')), 'launcher is missing');
  const result = launch(serialize(runtime));
  assert.deepEqual(result.environment, runtime);
  assert.deepEqual(result.loaded, ['/var/www/dashboard-abbott/apps/abbott/server.js']);
});

test('launcher rejects wrong listener, environment, duplicate keys and source credentials', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/start.cjs')), 'launcher is missing');
  for (const [key, value] of [['PORT','3001'], ['HOSTNAME','0.0.0.0'], ['NODE_ENV','development'], ['METRIKA_TOKEN','x'], ['YANDEX_ACCESS_TOKEN','x'], ['GOOGLE_REFRESH_TOKEN','x'], ['ABBOTT_EMBED_KEY','x'], ['ABBOTT_PRIVATE_DB_UNKNOWN','x'], ['NODE_OPTIONS','x'], ['ARBITRARY','x']]) assert.throws(() => launch(serialize({ ...runtime, [key]: value })), /environment/);
  assert.throws(() => launch(serialize(runtime) + "PORT='3004'\n"));
  assert.throws(() => launch(serialize(runtime).trimEnd()));
});

test('PM2 owns only Abbott with a cleared environment and dedicated account', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/ecosystem.config.cjs')), 'PM2 config is missing');
  const context = { module: { exports: {} } };
  vm.runInNewContext(read('deploy/abbott/ecosystem.config.cjs'), context);
  const apps = JSON.parse(JSON.stringify(context.module.exports.apps));
  assert.equal(apps.length, 1);
  assert.equal(apps[0].name, 'dashboard-abbott');
  assert.equal(apps[0].uid, 'dashboard-abbott');
  assert.equal(apps[0].gid, 'dashboard-abbott');
  assert.equal(apps[0].cwd, '/var/www/dashboard-abbott/apps/abbott');
  assert.equal(apps[0].args[0], '-i');
  assert.equal(apps[0].env.PORT, 3004);
  assert.doesNotMatch(read('deploy/abbott/ecosystem.config.cjs'), /dashboard-(?:next|zaruku|medroche)|300[123]/);
});

test('remote worker validates paths, dedicated secrets and exact process identity without host calls', async () => {
  const worker = new URL('./runtime-release-remote.mjs', import.meta.url);
  assert.ok(fs.existsSync(worker), 'remote worker is missing');
  const { createRuntimeInstaller } = await import(worker);
  const installer = createRuntimeInstaller(RUNTIME_MANIFESTS.abbott, Object.keys(runtime));
  for (const name of ['../dashboard-next/server.js', '/var/www/dashboard-next', 'a/../../b', 'a\\b', 'a\nb']) assert.throws(() => installer.safeRelative(name));
  assert.equal(installer.safeRelative('apps/abbott/server.js'), 'apps/abbott/server.js');
  const secrets = { ...runtime };
  delete secrets.PORT; delete secrets.NODE_ENV; delete secrets.HOSTNAME; delete secrets.INTERNAL_BASE_URL;
  assert.deepEqual(installer.renderEnvironment(secrets), runtime);
  for (const key of ['METRIKA_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'YANDEX_TOKEN', 'APP_DIR']) assert.throws(() => installer.renderEnvironment({ ...secrets, [key]: 'x' }));
  const status = 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
  const account = { uid: 1001, gid: 1001 };
  installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status, () => '/var/www/dashboard-abbott/apps/abbott');
  for (const name of ['dashboard-next', 'dashboard-zaruku', 'dashboard-medroche']) assert.throws(() => installer.assertRuntimeProcess([{ name, pid: 123 }], account, () => status, () => `/var/www/${name}`));
  assert.throws(() => installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status.replaceAll('1001', '0'), () => '/var/www/dashboard-abbott/apps/abbott'));
  assert.throws(() => installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status, () => '/var/www/dashboard-next'));
});

test('source gate rejects dirty, wrong branch, nonexact ref and missing predecessor', async () => {
  const { verifySource } = await import(modulePath);
  const repository = JSON.parse(read('deploy/abbott/repository.json'));
  const sha = 'a'.repeat(40);
  const run = (...args) => args[0] === 'status' ? '' : args[0] === 'branch' ? 'release/abbott' : args[0] === 'rev-parse' ? sha : '';
  assert.equal(verifySource(RUNTIME_MANIFESTS.abbott, repository, undefined, sha, run), sha);
  for (const [command, result] of [['status', ' M package.json'], ['branch', 'release/zaruku'], ['rev-parse', 'b'.repeat(40)]]) assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, repository, undefined, sha, (...args) => args[0] === command ? result : run(...args)));
  assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, repository, 'c'.repeat(40), sha, (...args) => { if (args[0] === 'merge-base') throw new Error(); return run(...args); }));
});

test('remote Git approval ignores caller-local insteadOf redirects and config injection', () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-git-authority-test-')));
  const caller = path.join(temporary, 'caller');
  const bare = path.join(temporary, 'redirect.git');
  const literal = `file://${temporary}/literal-authority-does-not-exist`;
  const environment = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const run = (args, input) => execFileSync('/usr/bin/git', args, { env: environment, input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  const temporaryCwds = [];
  try {
    run(['init', caller]); run(['init', '--bare', bare]);
    const tree = run(['--git-dir', bare, 'mktree'], '');
    const sha = run(['--git-dir', bare, 'commit-tree', tree], 'fixture\n');
    run(['--git-dir', bare, 'update-ref', 'refs/heads/release/abbott', sha]);
    run(['-C', caller, 'config', `url.file://${bare}.insteadOf`, literal]);
    assert.equal(run(['-C', caller, 'ls-remote', literal, 'refs/heads/release/abbott']).split('\t')[0], sha, 'fixture redirect must be effective');
    const context = { fs, path, os, createHash, randomUUID, isDeepStrictEqual, testRoot: caller,
      process: { getuid: () => process.getuid(), env: { GIT_DIR: path.join(caller, '.git'), GIT_WORK_TREE: caller, GIT_CEILING_DIRECTORIES: '/', GIT_PREFIX: 'ignored/', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.private.insteadOf', GIT_CONFIG_VALUE_0: 'private' } },
      execFileSync(bin, args, options) {
        if (options.cwd) {
          temporaryCwds.push(options.cwd);
          assert.notEqual(options.cwd, caller);
          assert.equal(fs.realpathSync(options.cwd), options.cwd);
          for (const key of ['GIT_DIR','GIT_WORK_TREE','GIT_CEILING_DIRECTORIES','GIT_PREFIX','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS','GIT_SSH','GIT_SSH_COMMAND']) assert.ok(!Object.hasOwn(options.env, key));
          assert.equal(options.env.GIT_CONFIG_GLOBAL, '/dev/null');
          assert.equal(options.env.GIT_CONFIG_SYSTEM, '/dev/null');
        }
        return execFileSync(bin, args, options);
      },
    };
    vm.createContext(context);
    const source = read('scripts/deploy-runtime.mjs').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ').replace("const ROOT = path.resolve(import.meta.dirname, '..');", 'const ROOT = testRoot;').split('\nif (process.argv[1]')[0];
    vm.runInContext(source + '\nthis.lookup = approvedSource;', context);
    assert.throws(() => context.lookup({ url: literal, ref: 'refs/heads/release/abbott' }), /Fixed remote release ref unavailable/);
    assert.ok(temporaryCwds.length >= 2, 'remote discovery and query must use an isolated cwd');
    for (const cwd of temporaryCwds) assert.equal(fs.existsSync(cwd), false, 'temporary Git authority cwd must be cleaned');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('local Git checks bind the expected git-dir and worktree and refuse URL operations', () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-local-git-test-')));
  try {
    const caller = path.join(temporary, 'caller');
    const other = path.join(temporary, 'other');
    const environment = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    for (const directory of [caller, other]) execFileSync('/usr/bin/git', ['init', directory], { env: environment, stdio: 'ignore' });
    const context = { fs, path, os, execFileSync, testRoot: caller };
    vm.createContext(context);
    const source = read('scripts/deploy-runtime.mjs').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ').replace("const ROOT = path.resolve(import.meta.dirname, '..');", 'const ROOT = testRoot;').split('\nif (process.argv[1]')[0];
    vm.runInContext(source + '\nthis.local = git;', context);
    assert.equal(context.local('status', '--porcelain'), '');
    assert.throws(() => context.local('ls-remote', 'unused'), /Invalid local Git operation/);
    execFileSync('/usr/bin/git', ['-C', caller, 'config', 'core.worktree', other], { env: environment, stdio: 'ignore' });
    assert.throws(() => context.local('status', '--porcelain'), /identity mismatch/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

// Execute the real worker against an isolated filesystem adapter. All absolute
// host paths map into this test-owned temporary directory. No child process,
// SSH, PM2, network, or /var/www access is available in the VM.
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-release-test-'));
  const map = filename => path.join(directory, filename);
  const io = {};
  for (const method of ['existsSync','mkdirSync','chmodSync','readdirSync','unlinkSync','rmdirSync','chownSync']) io[method] = (filename, ...args) => fs[method](map(filename), ...args);
  for (const method of ['readFileSync','writeFileSync','openSync']) io[method] = (filename, ...args) => fs[method](typeof filename === 'number' ? filename : map(filename), ...args);
  for (const method of ['closeSync','fsyncSync']) io[method] = (...args) => fs[method](...args);
  for (const method of ['lstatSync','statSync','fstatSync']) io[method] = (filename, ...args) => {
    const stat = fs[method](typeof filename === 'number' ? filename : map(filename), ...args);
    if (stat) { stat.uid = typeof stat.uid === 'bigint' ? 0n : 0; stat.gid = typeof stat.gid === 'bigint' ? 0n : 0; }
    return stat;
  };
  io.realpathSync = filename => '/' + path.relative(directory, fs.realpathSync(map(filename)));
  io.renameSync = (from, to) => fs.renameSync(map(from), map(to));
  io.constants = fs.constants;
  for (const filename of ['/var', '/var/www']) fs.mkdirSync(map(filename), { recursive: true, mode: 0o755 });
  const noHost = () => { throw new Error('Forbidden real host operation in fixture'); };
  const context = { fs: io, path, os, createHash, randomUUID, execFileSync: noHost, spawn: noHost, createServer: noHost, fetch: noHost, isDeepStrictEqual, Buffer, TextDecoder, setTimeout, clearTimeout, process: { getuid: () => 0 }, authority: RUNTIME_MANIFESTS.abbott, environmentKeys: Object.keys(runtime) };
  vm.createContext(context);
  const source = read('scripts/runtime-release-remote.mjs').replace(/^import .*;\n/gm, '').replace('export function createRuntimeInstaller', 'function createRuntimeInstaller');
  vm.runInContext(source + '\nthis.installer = createRuntimeInstaller(authority, environmentKeys);', context);
  let processRow = null, serial = 10, healthFailure = false;
  let nextStartup = 'ready', startup = 'ready', listening = true;
  const events = [];
  const processText = filename => {
    if (filename.endsWith('/status')) return 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
    if (filename.endsWith('/stat')) return `${serial} (node) ${['S', ...Array(18).fill('0'), String(serial)].join(' ')}`;
    if (filename.endsWith('/boot_id')) return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n';
    if (filename.endsWith('/cmdline')) return '/usr/bin/node\0/var/www/.dashboard-abbott-launcher.cjs\0';
    if (filename.endsWith('/.release-source-sha')) return fs.readFileSync(map(filename), 'utf8');
    throw new Error('unexpected fixture process read');
  };
  const platform = {
    account: () => ({ uid: 1001, gid: 1001 }),
    chown: () => {},
    secrets: () => Object.fromEntries(Object.entries(runtime).filter(([key]) => !['NODE_ENV','HOSTNAME','PORT','INTERNAL_BASE_URL'].includes(key))),
    verify: async artifact => {
      assert.equal(fs.existsSync(map(artifact + '/.env')), false, 'sealed artifact verification must never include runtime secrets');
    },
    snapshot: () => processRow === null ? null : context.installer.captureRuntimeIdentity([processRow], { uid: 1001, gid: 1001 }, processText, () => '/var/www/dashboard-abbott/apps/abbott', listening ? `LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=${serial},fd=18))` : ''),
    registration: () => processRow === null ? null : ({ registration: context.installer.captureRuntimeRegistration([processRow], { uid: 1001, gid: 1001 }), pid: processRow.pid, status: processRow.pm2_env.status }),
    async assertNoListener() { assert.equal(listening, false, 'candidate listener must be absent before restoration'); events.push(['no-listener']); },
    async start(control) {
      events.push(['start', control]);
      processRow = { name: 'dashboard-abbott', pid: ++serial, pm_id: serial, pm2_env: { pm_exec_path: '/usr/bin/env', pm_cwd: '/var/www/dashboard-abbott/apps/abbott', args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/.dashboard-abbott-launcher.cjs'], uid: 'dashboard-abbott', gid: 'dashboard-abbott', RUNTIME_RELEASE_ID: path.basename(control), RUNTIME_RELEASE_SOURCE_SHA: fs.readFileSync(map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), status: 'online' } };
      startup = nextStartup; nextStartup = 'ready'; listening = startup === 'ready';
      if (startup.startsWith('early:')) {
        processRow.pid = 0;
        processRow.pm2_env.status = startup === 'early:waiting restart' ? 'waiting restart' : 'errored';
        if (startup === 'early:error mismatch') processRow.pm2_env.RUNTIME_RELEASE_ID = 'd'.repeat(32);
        if (startup.startsWith('early:error ')) throw new Error('start returned error after registration');
      }
    },
    async stop(pmId) {
      assert.equal(pmId, processRow.pm_id); events.push(['stop', pmId]);
      if (processRow.pid === 0) processRow.pm2_env.status = 'stopped';
      else processRow = null;
      listening = false;
    },
    async health() {
      if (healthFailure) { healthFailure = false; throw new Error('fixture failed health'); }
      for (let attempt = 0; attempt < 3; attempt++) {
        events.push(['readiness', serial, attempt]);
        if (startup === 'exited') { processRow = null; throw new Error('candidate exited before listener'); }
        if (['errored', 'waiting restart', 'launching'].includes(startup) || startup.startsWith('mismatched retained')) {
          processRow.pid = 0; processRow.pm2_env.status = startup.startsWith('mismatched retained') ? 'errored' : startup;
          const field = startup.split(':')[1];
          if (field === 'name') processRow.name = 'dashboard-other';
          else if (field === 'uid' || field === 'gid') processRow.pm2_env[field] = 1001;
          else if (field === 'exec') processRow.pm2_env.pm_exec_path = '/usr/bin/other';
          else if (field === 'cwd') processRow.pm2_env.pm_cwd = '/var/www/dashboard-other';
          else if (field === 'args') processRow.pm2_env.args[3] = '/var/www/other-launcher.cjs';
          else if (field === 'release') processRow.pm2_env.RUNTIME_RELEASE_ID = 'd'.repeat(32);
          else if (field === 'source') processRow.pm2_env.RUNTIME_RELEASE_SOURCE_SHA = 'd'.repeat(40);
          else if (startup.startsWith('mismatched retained')) processRow.pm_id += 100;
          throw new Error('retained candidate registration before listener');
        }
        if (startup === 'fail') throw new Error('failure before listener');
        if (startup === 'delayed' && attempt === 1) listening = true;
        if (listening) return;
      }
      throw new Error('listener readiness timeout');
    },
  };
  function payload(sourceSha) {
    const values = { '.release-source-sha': sourceSha + '\n', '.release-runtime-scope': 'abbott\n', 'apps/abbott/server.js': 'test fixture only\n' };
    const entries = Object.entries(values).map(([name, data]) => ({ path: name, type: 'file', required: true, mode: 0o644, size: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') }));
    const manifest = JSON.stringify({ version: 1, scope: 'abbott', sourceSha, files: entries });
    return { scope: 'abbott', sourceSha, manifest, manifestDigest: createHash('sha256').update(manifest).digest('hex'), control: [], files: entries.map(entry => ({ path: entry.path, mode: entry.mode, data: Buffer.from(values[entry.path]).toString('base64') })) };
  }
  return { installer: context.installer, platform, events, map, payload, nextStartup: value => { nextStartup = value; }, failHealth: () => { healthFailure = true; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

for (const mode of ['delayed', 'timeout', 'fail', 'exited']) test(`candidate ownership is established before ${mode} listener readiness`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode === 'delayed') {
      assert.equal((await operation).sourceSha, 'c'.repeat(40));
      assert.equal(f.events.filter(event => event[0] === 'readiness' && event[1] === 13).length, 2);
    } else {
      await assert.rejects(operation, /attested predecessor restored/);
      if (mode !== 'exited') assert.ok(f.events.some(event => event[0] === 'stop' && event[1] === 13), 'only proven candidate must be stopped before restoring predecessor');
      assert.equal(f.events.filter(event => event[0] === 'stop').length, mode === 'exited' ? 0 : 1);
    }
    const active = f.installer.inspectActiveRuntime();
    assert.equal(active.sourceSha, (mode === 'delayed' ? 'c' : 'b').repeat(40));
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), active.sourceSha);
    const restored = await f.installer.transact({ action: 'rollback', expectedActiveSha: active.sourceSha }, f.platform);
    assert.equal(restored.sourceSha, (mode === 'delayed' ? 'b' : 'a').repeat(40));
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, restored.sourceSha);
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')), false);
  } finally { f.cleanup(); }
});

for (const mode of ['early:errored', 'early:waiting restart', 'early:error matching', 'early:error mismatch']) test(`registration is owned before first live snapshot for ${mode}`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode === 'early:error mismatch') {
      await assert.rejects(operation, /ownership requires review/);
      assert.equal(f.events.filter(event => event[0] === 'stop').length, 0);
      assert.equal(f.events.filter(event => event[0] === 'start').length, 3);
      assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${second.id}/.release-source-sha`), 'utf8').trim(), second.sourceSha, 'sealed predecessor remains recoverable');
      assert.equal(JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'), 'utf8')).id, second.id);
      return;
    }
    await assert.rejects(operation, /attested predecessor restored/);
    assert.ok(f.events.some(event => event[0] === 'stop' && event[1] === 13));
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), second.sourceSha);
    const rollback = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(rollback.sourceSha, first.sourceSha);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
  } finally { f.cleanup(); }
});

for (const mode of ['errored', 'waiting restart', 'launching', ...['id','name','exec','cwd','args','uid','gid','release','source'].map(field => `mismatched retained:${field}`)]) test(`recovery handles ${mode} PM2 registration without an active PID`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode.startsWith('mismatched retained')) {
      await assert.rejects(operation, /ownership requires review/);
      assert.equal(f.events.filter(event => event[0] === 'stop').length, 0);
      assert.equal(f.events.filter(event => event[0] === 'start').length, 3, 'mismatched registration must not be replaced');
      return;
    }
    await assert.rejects(operation, /attested predecessor restored/);
    const stop = f.events.findIndex(event => event[0] === 'stop' && event[1] === 13);
    const listener = f.events.findIndex((event, index) => index > stop && event[0] === 'no-listener');
    const restart = f.events.findIndex((event, index) => index > stop && event[0] === 'start');
    assert.ok(stop >= 0 && listener > stop && restart > listener, 'cancel restart and verify no listener before predecessor restart');
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), second.sourceSha);
    const rollback = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(rollback.sourceSha, first.sourceSha);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
  } finally { f.cleanup(); }
});

test('immutable install, lock exclusion, rollback and failed-health recovery affect only Abbott fixture', async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    assert.equal(first.scope, 'abbott');
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')), false);
    fs.mkdirSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
    await assert.rejects(f.installer.transact({ action: 'inspect' }, f.platform), /lock/);
    fs.rmdirSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    assert.equal(second.previousId, first.id);
    f.failHealth();
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform), /predecessor restored/);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    const restored = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(restored.sourceSha, first.sourceSha);
    assert.ok(f.events.filter(event => event[0] === 'start').every(event => event[1].startsWith('/var/www/.dashboard-abbott-control/')));
    for (const name of ['dashboard-next','dashboard-zaruku','dashboard-medroche']) assert.equal(fs.existsSync(f.map('/var/www/' + name)), false);
  } finally { f.cleanup(); }
});

test('artifact digest corruption and stale active authority fail before process activation', async () => {
  const f = fixture();
  try {
    const invalid = f.payload('a'.repeat(40));
    invalid.files[2].data = Buffer.from('tampered').toString('base64');
    await assert.rejects(f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: invalid }, f.platform), /external authority/);
    assert.equal(f.events.length, 0);
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: 'b'.repeat(40) }, f.platform), /SHA changed/);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
    fs.appendFileSync(f.map('/var/www/dashboard-abbott/apps/abbott/server.js'), 'tampered');
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: first.sourceSha }, f.platform), /external authority/);
  } finally { f.cleanup(); }
});

test('real Abbott payload materializes under the unchanged sealed artifact policy', async () => {
  const { preparePayload } = await import(modulePath);
  const { assertRuntimeArtifact } = await import('./runtime-artifact-policy.mjs');
  const sha = read('apps/abbott/.next-abbott/standalone/.release-source-sha').trim();
  const payload = preparePayload(RUNTIME_MANIFESTS.abbott, sha);
  const f = fixture();
  let verified = 0;
  f.platform.verify = async (artifact, manifest) => {
    assert.equal(fs.existsSync(f.map(artifact + '/.env')), false);
    assertRuntimeArtifact(f.map(artifact), 'abbott', f.map(manifest));
    verified += 1;
  };
  try {
    const result = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload }, f.platform);
    assert.equal(result.sourceSha, sha);
    assert.equal(verified, 2);
  } finally { f.cleanup(); }
});

test('runtime env profiles and package commands retain the fixed reviewed boundaries', () => {
  const keys = JSON.parse(read('deploy/abbott/environment.json'));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('ABBOTT_DASHBOARD_EMBED_KEY'));
  assert.ok(!keys.includes('ABBOTT_EMBED_KEY'));
  const source = read('deploy/abbott/start.cjs');
  const declared = JSON.parse(/const allowed = new Set\((\[[\s\S]*?\])\);/.exec(source)[1]);
  assert.deepEqual(keys, declared);
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['deploy:abbott'], 'bash scripts/deploy-abbott.sh');
  assert.equal(scripts['deploy:abbott:rollback'], 'bash scripts/rollback-abbott.sh');
  assert.match(scripts['ci:verify'], /npm run test:abbott-runtime/);
  for (const gate of ['test:deploy-source','test:release-runtime','test:abbott-contract','security:public-assets','lint','typecheck','build','preview-builder:test']) assert.ok(scripts['ci:verify'].includes(`npm run ${gate}`));
});

test('identity proof binds launcher and release independently of listener ownership', async () => {
  const { createRuntimeInstaller } = await import('./runtime-release-remote.mjs');
  const installer = createRuntimeInstaller(RUNTIME_MANIFESTS.abbott, Object.keys(runtime));
  const row = { name: 'dashboard-abbott', pid: 123, pm_id: 7, pm2_env: { pm_exec_path: '/usr/bin/env', pm_cwd: '/var/www/dashboard-abbott/apps/abbott', args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/.dashboard-abbott-launcher.cjs'], uid: 'dashboard-abbott', gid: 'dashboard-abbott', RUNTIME_RELEASE_ID: 'b'.repeat(32), RUNTIME_RELEASE_SOURCE_SHA: 'a'.repeat(40) } };
  const readText = name => name.endsWith('/status') ? 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n' : name.endsWith('/stat') ? `123 (node) ${['S', ...Array(18).fill('0'), '300'].join(' ')}` : name.endsWith('/cmdline') ? '/usr/bin/node\0/var/www/.dashboard-abbott-launcher.cjs\0' : name.endsWith('/boot_id') ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n' : 'a'.repeat(40) + '\n';
  const args = [[row], { uid: 1001, gid: 1001 }, readText, () => '/var/www/dashboard-abbott/apps/abbott'];
  const proof = installer.captureRuntimeIdentity(...args);
  assert.equal(proof.sourceSha, 'a'.repeat(40));
  assert.equal(proof.script, '/var/www/.dashboard-abbott-launcher.cjs');
  assert.ok(!Object.hasOwn(proof, 'listener'));
  const changedTitle = installer.captureRuntimeIdentity(args[0], args[1], name => name.endsWith('/cmdline') ? 'next-server (v16.1.6)\0' : readText(name), args[3]);
  assert.deepEqual(changedTitle, proof, 'Next changes process.title; proof must use stable launcher metadata');
  const badRow = { ...row, pm2_env: { ...row.pm2_env, args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/other-launcher.cjs'] } };
  assert.throws(() => installer.captureRuntimeIdentity([badRow], args[1], readText, args[3]), /registration identity/);
  assert.deepEqual(installer.captureRuntimeRegistration([{ ...row, pid: 0, pm2_env: { ...row.pm2_env, status: 'waiting restart' } }], args[1]), proof.registration);
  assert.deepEqual(installer.releaseCommandEnvironment({ scope: 'abbott', id: 'b'.repeat(32), sourceSha: 'a'.repeat(40) }), { RUNTIME_RELEASE_ID: 'b'.repeat(32), RUNTIME_RELEASE_SOURCE_SHA: 'a'.repeat(40) });
  assert.throws(() => installer.releaseCommandEnvironment({ scope: 'other', id: 'b'.repeat(32), sourceSha: 'a'.repeat(40) }));
  assert.throws(() => installer.assertRuntimeListener(proof, ''), /listener ownership/);
  const listener = 'LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=123,fd=18))';
  installer.assertRuntimeListener(proof, listener);
  for (const invalid of [listener.replace('pid=123', 'pid=456'), listener.replace('127.0.0.1:3004', '0.0.0.0:3004'), listener + '\n' + listener]) assert.throws(() => installer.assertRuntimeListener(proof, invalid));
});
