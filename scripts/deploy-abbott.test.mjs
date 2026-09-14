import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
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
  let processProof = null, serial = 10, healthFailure = false;
  const events = [];
  const platform = {
    account: () => ({ uid: 1001, gid: 1001 }),
    chown: () => {},
    secrets: () => Object.fromEntries(Object.entries(runtime).filter(([key]) => !['NODE_ENV','HOSTNAME','PORT','INTERNAL_BASE_URL'].includes(key))),
    verify: async artifact => {
      assert.equal(fs.existsSync(map(artifact + '/.env')), false, 'sealed artifact verification must never include runtime secrets');
    },
    snapshot: () => processProof,
    async start(control) { events.push(['start', control]); processProof = { bootId: 'a'.repeat(36), cwd: '/var/www/dashboard-abbott/apps/abbott', gid: 1001, listener: '127.0.0.1:3004', pid: ++serial, pmId: serial, startTime: String(serial), uid: 1001 }; },
    async stop(pmId) { assert.equal(pmId, processProof.pmId); events.push(['stop', pmId]); processProof = null; },
    async health() { if (healthFailure) { healthFailure = false; throw new Error('fixture failed health'); } },
  };
  function payload(sourceSha) {
    const values = { '.release-source-sha': sourceSha + '\n', '.release-runtime-scope': 'abbott\n', 'apps/abbott/server.js': 'test fixture only\n' };
    const entries = Object.entries(values).map(([name, data]) => ({ path: name, type: 'file', required: true, mode: 0o644, size: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') }));
    const manifest = JSON.stringify({ version: 1, scope: 'abbott', sourceSha, files: entries });
    return { scope: 'abbott', sourceSha, manifest, manifestDigest: createHash('sha256').update(manifest).digest('hex'), control: [], files: entries.map(entry => ({ path: entry.path, mode: entry.mode, data: Buffer.from(values[entry.path]).toString('base64') })) };
  }
  return { installer: context.installer, platform, events, map, payload, failHealth: () => { healthFailure = true; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

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
