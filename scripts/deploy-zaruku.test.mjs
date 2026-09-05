import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const sha = 'a'.repeat(40), previousSha = 'b'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const run = (script, args = [], env = {}) => spawnSync('/bin/bash', [path.join(root, 'scripts', script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const api = await import('./deploy-runtime.mjs');
const worker = await import('./runtime-release-remote.mjs');

test('release authority exactly matches compiled contract and fixed process config', () => {
  assert.deepEqual(JSON.parse(read('deploy/zaruku/release.json')), RUNTIME_MANIFESTS.zaruku);
  const require = createRequire(import.meta.url);
  const app = require('../deploy/zaruku/ecosystem.config.cjs').apps[0];
  assert.equal(app.name, 'dashboard-zaruku');
  assert.equal(app.cwd, '/var/www/dashboard-zaruku/apps/zaruku');
  assert.equal(app.uid, 'dashboard-zaruku');
  assert.equal(app.gid, 'dashboard-zaruku');
  assert.deepEqual(app.env, { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: 3002 });
});

test('all fixed authority overrides are rejected even when empty, by all entrypoints', () => {
  for (const key of api.FORBIDDEN_ENV) for (const value of ['', 'evil;touch /tmp/task6-injection']) {
    for (const name of ['deploy-zaruku.sh', 'rollback-zaruku.sh']) {
      const result = run(name, [], { [key]: value });
      assert.notEqual(result.status, 0, `${name} accepted ${key}`);
      assert.match(result.stderr, /fixed.*authority|authority override/i);
      assert.doesNotMatch(result.stderr, /evil;touch/);
    }
  }
});

test('internal manifest substitution and shell/path arguments are refused before transport', () => {
  for (const value of ['/tmp/fake.json', '../deploy/zaruku/release.json', 'bad;touch /tmp/task6-injection']) {
    assert.notEqual(run('deploy-runtime.sh', [value]).status, 0);
    assert.notEqual(run('rollback-zaruku.sh', [value]).status, 0);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-authority-'));
  try {
    const copy = path.join(temp, 'release.json');
    fs.copyFileSync(path.join(root, 'deploy/zaruku/release.json'), copy);
    assert.throws(() => api.validateAuthority(copy), /authority/);
    fs.unlinkSync(copy); fs.symlinkSync(path.join(root, 'deploy/zaruku/release.json'), copy);
    assert.throws(() => api.validateAuthority(copy), /authority/);
    api.validateAuthority(path.join(root, 'deploy/zaruku/release.json'));
  } finally { fs.rmSync(temp, { recursive: true }); }
});

test('clean named branch must contain refreshed release/zaruku and current Zaruku SHA', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-git-'));
  const git = (...args) => execFileSync('git', ['-C', temp, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(temp, 'fact'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/release/zaruku', base);
    git('checkout', '-qb', 'candidate'); fs.writeFileSync(path.join(temp, 'fact'), 'next'); git('commit', '-qam', 'next');
    const candidate = git('rev-parse', 'HEAD');
    assert.equal(api.verifySource(temp, base), candidate);
    fs.writeFileSync(path.join(temp, 'dirty'), 'x'); assert.throws(() => api.verifySource(temp, base), /clean/); fs.unlinkSync(path.join(temp, 'dirty'));
    git('checkout', '--detach', '-q'); assert.throws(() => api.verifySource(temp, base), /named branch/);
    git('checkout', '-q', 'candidate'); git('checkout', '-qb', 'sibling', base);
    fs.writeFileSync(path.join(temp, 'fact'), 'sibling'); git('commit', '-qam', 'sibling'); const sibling = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'candidate'); assert.throws(() => api.verifySource(temp, sibling), /active Zaruku/);
    git('update-ref', 'refs/remotes/origin/release/zaruku', sibling); assert.throws(() => api.verifySource(temp, base), /release\/zaruku/);
  } finally { fs.rmSync(temp, { recursive: true }); }
});

test('environment rendering is scoped, fixed, redacted and cannot evaluate shell input', () => {
  const secret = 'fixture-only-password;$(touch nope)';
  const input = { MYSQL_HOST: 'localhost', MYSQL_PORT: '3306', MYSQL_USER: 'fixture', MYSQL_PASSWORD: secret, MYSQL_DB: 'report_bd', DASHBOARD_AUTH_SECRET: 'fixture-auth',
    MYSQL_DB_STAT: 'private_wrong', METRIKA_TOKEN: 'private-token', GOOGLE_ADS_REFRESH_TOKEN: 'private-google', ABBOTT_PRIVATE_DB_PASSWORD: 'private-abbott', DASHBOARD_ADMIN_PASSWORD: 'private-admin', AI_SUMMARY_API_KEY: 'private-ai', HOSTNAME: '0.0.0.0', PORT: '3001' };
  const output = worker.renderEnvironment(input);
  assert.deepEqual(Object.keys(output).sort(), worker.ENV_KEYS.filter(k => k !== 'PUPPETEER_EXECUTABLE_PATH').sort());
  assert.equal(output.MYSQL_DB, 'report_bd'); assert.equal(output.DB_NAME, 'report_bd');
  assert.equal(output.DB_PASSWORD, secret); assert.equal(output.HOSTNAME, '127.0.0.1'); assert.equal(output.PORT, '3002');
  assert.equal(output.INTERNAL_BASE_URL, 'http://127.0.0.1:3002');
  for (const marker of ['private_wrong', 'private-token', 'private-google', 'private-abbott', 'private-admin', 'private-ai']) assert.ok(!JSON.stringify(output).includes(marker));
  assert.throws(() => worker.renderEnvironment({ ...input, MYSQL_PASSWORD: 'private-secret\nBAD=1' }), error => !error.message.includes('private-secret'));
  assert.throws(() => worker.renderEnvironment({ ...input, MYSQL_USER: '' }), /required/);
});

test('trusted authority pins source/scope and rejects replacement, traversal, links and writable ancestry', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-trust-'));
  try {
    const name = path.join(temp, 'authority.json'); const data = JSON.stringify({ sourceSha: sha, scope: 'zaruku' });
    fs.writeFileSync(name, data, { mode: 0o600 });
    assert.equal(worker.readPinned(name, hash(data)).toString(), data);
    fs.writeFileSync(name, data + ' '); assert.throws(() => worker.readPinned(name, hash(data)), /authority|digest/);
    fs.unlinkSync(name); fs.symlinkSync('/etc/passwd', name); assert.throws(() => worker.readPinned(name, hash(data)), /unsafe/i);
    for (const p of ['../escape', '/absolute', 'a/../b', 'a//b', 'a\\b', 'a\nb', '.', 'a:bad']) assert.throws(() => worker.safeRelative(p), /path/);
    fs.unlinkSync(name); fs.writeFileSync(name, data, { mode: 0o600 }); fs.linkSync(name, path.join(temp, 'link')); assert.throws(() => worker.readPinned(name, hash(data)), /unsafe/i);
    fs.unlinkSync(path.join(temp, 'link')); fs.chmodSync(temp, 0o777); assert.throws(() => worker.readPinned(name, hash(data)), /unsafe/i);
  } finally { fs.rmSync(temp, { recursive: true }); }
});

test('owner-writable foreign ancestor cannot substitute an otherwise private manifest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-owner-'));
  const name = path.join(temp, 'manifest'); fs.writeFileSync(name, 'fixture', { mode: 0o600 });
  const original = fs.lstatSync;
  try {
    fs.lstatSync = (filename, ...args) => {
      const value = original(filename, ...args);
      if (filename === temp) value.uid = process.getuid() + 100;
      return value;
    };
    assert.throws(() => worker.readPinned(name, hash('fixture')), /unsafe/i);
  } finally { fs.lstatSync = original; fs.rmSync(temp, { recursive: true }); }
});

// Production has no path/user/command injection API. The temporary worker copy alone
// substitutes its fixed deployment root, deploy UID and OS effects for local fixtures.
async function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-lifecycle-'));
  const source = read('scripts/runtime-release-remote.mjs')
    .replace("const BASE = '/var/www';", `const BASE = ${JSON.stringify(temp)};`)
    .replace('const DEPLOY_UID = 0;', `const DEPLOY_UID = ${process.getuid()};`);
  assert.notEqual(source, read('scripts/runtime-release-remote.mjs'));
  const name = path.join(temp, 'worker.mjs'); fs.writeFileSync(name, source);
  const mod = await import(pathToFileURL(name).href);
  const calls = [];
  const platform = {
    account: () => ({ uid: process.getuid() + 1, gid: process.getgid() + 1 }),
    chown: () => {},
    verify: async (artifact, manifest, boot) => { calls.push({ artifact, manifest, boot }); },
    start: async () => {}, health: async () => {}, stop: async () => {},
    secrets: () => ({ MYSQL_USER: 'fixture', MYSQL_PASSWORD: 'fixture-password', MYSQL_DB: 'report_bd', DASHBOARD_AUTH_SECRET: 'fixture-auth' }),
  };
  function payload(sourceSha, scope = 'zaruku') {
    const files = [{ path: '.release-source-sha', data: Buffer.from(`${sourceSha}\n`).toString('base64'), mode: 0o644 }, { path: '.release-runtime-scope', data: Buffer.from(`${scope}\n`).toString('base64'), mode: 0o644 }];
    const manifest = JSON.stringify({ version: 1, sourceSha, scope, files: files.map(f => ({ path: f.path, type: 'file', mode: f.mode, size: Buffer.from(f.data, 'base64').length, sha256: hash(Buffer.from(f.data, 'base64')), required: true })) });
    return { sourceSha, scope, manifest, manifestDigest: hash(manifest), files, control: [{ path: 'scripts/runtime-artifact-policy.mjs', data: Buffer.from('fixture policy').toString('base64'), mode: 0o600 }] };
  }
  return { temp, mod, platform, calls, payload, close: () => fs.rmSync(temp, { recursive: true }) };
}

test('deploy serializes same-scope operations and leaves foreign locks and active metadata untouched', async () => {
  const f = await fixture();
  try {
    for (const name of ['.dashboard-next-deploy.lock', '.dashboard-abbott-deploy.lock', '.dashboard-advertising-deploy.lock']) fs.mkdirSync(path.join(f.temp, name));
    let entered; const held = new Promise(resolve => { entered = resolve; }); let release; const gate = new Promise(resolve => { release = resolve; });
    const first = f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(sha) }, { ...f.platform, health: async () => { entered(); await gate; } });
    await held;
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform), /lock/);
    release(); await first;
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${sha}\n`);
    assert.ok(!fs.existsSync(path.join(f.temp, '.dashboard-zaruku-deploy.lock')));
    for (const name of ['.dashboard-next-deploy.lock', '.dashboard-abbott-deploy.lock', '.dashboard-advertising-deploy.lock']) assert.ok(fs.statSync(path.join(f.temp, name)).isDirectory());
    assert.ok(f.calls.some(c => c.boot && !c.manifest.startsWith(c.artifact + '/')));
  } finally { f.close(); }
});

test('stale active SHA, foreign scope, missing metadata and absent privilege separation fail closed', async () => {
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(sha) }, f.platform);
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(previousSha) }, f.platform), /active Zaruku/i);
    for (const scope of ['combined', 'abbott', 'advertising']) await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: sha, payload: f.payload(previousSha, scope) }, f.platform), /scope/);
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: sha, payload: f.payload(previousSha) }, { ...f.platform, account: () => ({ uid: process.getuid(), gid: process.getgid() }) }), /account|separation/);
    fs.unlinkSync(path.join(f.temp, 'dashboard-zaruku/.release-runtime-scope'));
    await assert.rejects(f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform));
  } finally { f.close(); }
});

test('separate backups preserve exact predecessor; manual and failure rollbacks restore only Zaruku', async () => {
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
    await f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, f.platform);
    assert.equal(fs.readdirSync(path.join(f.temp, 'dashboard-zaruku-backups')).length, 1);
    await f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform);
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${previousSha}\n`);
    let attempts = 0;
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, { ...f.platform, health: async () => { if (++attempts === 1) throw new Error('fixture failed health'); } }), /restored/);
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${previousSha}\n`);
    assert.equal(attempts, 2);
  } finally { f.close(); }
});

test('rollback refuses foreign or replaced predecessor authority without moving active release', async () => {
  for (const attack of ['scope', 'authority', 'symlink']) {
    const f = await fixture();
    try {
      await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
      await f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, f.platform);
      const backups = path.join(f.temp, 'dashboard-zaruku-backups'); const predecessor = path.join(backups, fs.readdirSync(backups)[0]);
      if (attack === 'scope') fs.writeFileSync(path.join(predecessor, '.release-runtime-scope'), 'abbott\n');
      if (attack === 'symlink') { fs.renameSync(predecessor, predecessor + '-real'); fs.symlinkSync(predecessor + '-real', predecessor); }
      if (attack === 'authority') {
        const state = JSON.parse(fs.readFileSync(path.join(f.temp, '.dashboard-zaruku-control/current.json')));
        const manifest = path.join(f.temp, '.dashboard-zaruku-control', state.previousId, 'trusted-runtime-manifest.json');
        fs.appendFileSync(manifest, ' '); fs.writeFileSync(manifest + '.sha256', hash(fs.readFileSync(manifest)) + '\n');
      }
      await assert.rejects(f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform));
      assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${sha}\n`);
    } finally { f.close(); }
  }
});

test('authority replacement during boot and writable artifact are rejected before activation', async () => {
  for (const attack of ['authority', 'artifact', 'mode', 'environment']) {
    const f = await fixture();
    try {
      await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(sha) }, { ...f.platform, verify: async (artifact, manifest, boot) => {
        if (!boot) return;
        if (attack === 'authority') { fs.appendFileSync(manifest, ' '); fs.writeFileSync(manifest + '.sha256', hash(fs.readFileSync(manifest)) + '\n'); }
        if (attack === 'artifact') fs.writeFileSync(path.join(artifact, '.release-source-sha'), previousSha + '\n');
        if (attack === 'mode') fs.chmodSync(artifact, 0o777);
        if (attack === 'environment') fs.writeFileSync(path.join(artifact, '.env'), "METRIKA_TOKEN='fixture-never-publish'\n");
      } }));
      assert.ok(!fs.existsSync(path.join(f.temp, 'dashboard-zaruku')));
    } finally { f.close(); }
  }
});

test('PM2 clears inherited Node options before Node starts, then launcher supplies only scoped env', () => {
  const app = createRequire(import.meta.url)('../deploy/zaruku/ecosystem.config.cjs').apps[0];
  assert.equal(app.script, '/usr/bin/env');
  assert.equal(app.interpreter, 'none');
  assert.deepEqual(app.args, ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'node', '/var/www/.dashboard-zaruku-launcher.cjs']);
  const runtimeEnv = { ...worker.renderEnvironment({ MYSQL_USER: 'fixture', MYSQL_PASSWORD: 'fixture', MYSQL_DB: 'report_bd', DASHBOARD_AUTH_SECRET: 'fixture' }) };
  const inherited = { METRIKA_TOKEN: 'never-runtime', NODE_OPTIONS: '--require evil', MYSQL_DB_STAT: 'never-runtime', ...process.env };
  const processStub = { env: inherited };
  let started = false;
  vm.runInNewContext(read('deploy/zaruku/start.cjs'), { process: processStub, require: name => {
    if (name === 'node:fs') return { readFileSync: () => Object.entries(runtimeEnv).map(([key, value]) => `${key}='${value}'\n`).join('') };
    assert.equal(name, '/var/www/dashboard-zaruku/apps/zaruku/server.js');
    assert.deepEqual(processStub.env, runtimeEnv); started = true;
  } });
  assert.ok(started);
});

test('read-only active inspection also holds the scoped lock and does not require caller SHA', async () => {
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(sha) }, f.platform);
    const result = await f.mod.transact({ action: 'inspect' }, f.platform);
    assert.equal(result.sourceSha, sha);
    fs.mkdirSync(path.join(f.temp, '.dashboard-zaruku-deploy.lock'));
    await assert.rejects(f.mod.transact({ action: 'inspect' }, f.platform), /lock/);
  } finally { f.close(); }
});

test('fixed deploy commands are wired into package verification without altering combined commands', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['deploy:zaruku'], 'bash scripts/deploy-zaruku.sh');
  assert.equal(pkg.scripts['deploy:zaruku:rollback'], 'bash scripts/rollback-zaruku.sh');
  assert.match(pkg.scripts['test:release-runtime'], /bash scripts\/deploy-zaruku\.test\.sh/);
  assert.equal(pkg.scripts.deploy, 'bash scripts/deploy.sh');
  assert.equal(pkg.scripts['deploy:rollback'], 'bash scripts/rollback-release.sh');
});

test('live process attestation rejects a root process or foreign PM2 identity', () => {
  const processes = [{ name: 'dashboard-zaruku', pid: 1234 }];
  const status = 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
  worker.assertRuntimeProcess(processes, { uid: 1001, gid: 1001 }, () => status, () => '/var/www/dashboard-zaruku/apps/zaruku');
  for (const bad of ['Uid:\t0\t0\t0\t0\nGid:\t1001\t1001\t1001\t1001\n', 'Uid:\t1001\t0\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n']) {
    assert.throws(() => worker.assertRuntimeProcess(processes, { uid: 1001, gid: 1001 }, () => bad), /identity/);
  }
  for (const list of [[], [{ name: 'dashboard-next', pid: 1234 }], [...processes, ...processes]]) assert.throws(() => worker.assertRuntimeProcess(list, { uid: 1001, gid: 1001 }, () => status), /identity/);
});

test('healthy process must run in active Zaruku directory rather than a retained predecessor', () => {
  const status = 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
  assert.throws(() => worker.assertRuntimeProcess([{ name: 'dashboard-zaruku', pid: 1234 }], { uid: 1001, gid: 1001 }, () => status, () => '/var/www/dashboard-zaruku-backups/old/apps/zaruku'), /active directory/);
});

test('remote staging handles restrictive umask and requires runtime-readable files', async () => {
  const f = await fixture(); const mask = process.umask(0o077);
  try {
    const payload = f.payload(sha); payload.files.push({ path: 'apps/zaruku/readable', data: Buffer.from('x').toString('base64'), mode: 0o644 });
    const manifest = JSON.parse(payload.manifest); manifest.files.push({ path: 'apps/zaruku/readable', type: 'file', mode: 0o644, size: 1, sha256: hash('x'), required: true });
    payload.manifest = JSON.stringify(manifest); payload.manifestDigest = hash(payload.manifest);
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload }, f.platform);
    assert.equal(fs.statSync(path.join(f.temp, 'dashboard-zaruku/apps/zaruku')).mode & 0o777, 0o755);
  } finally { process.umask(mask); f.close(); }
});

test('the packaged real artifact and optional browser assets pass policy using transported external authority', async () => {
  const payload = api.preparePayload(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  assert.equal(payload.scope, 'zaruku');
  assert.ok(payload.files.some(f => f.path.includes('/static/') && /\.(js|css)$/.test(f.path)));
  assert.ok(!payload.files.some(f => f.path === '.env' || f.path.includes('trusted-runtime-manifest')));
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload }, { ...f.platform, verify: async (artifact, manifest, boot) => {
      if (boot) return; // Dedicated verify:boot below covers the real loopback process.
      execFileSync(process.execPath, [path.join(path.dirname(manifest), 'scripts/runtime-artifact-policy.mjs'), 'zaruku', artifact, '--trusted-manifest', manifest], { stdio: ['ignore', 'pipe', 'pipe'] });
    } });
  } finally { f.close(); }
});

test('transport refuses a substituted request before any OS precondition or activation', async () => {
  const f = await fixture();
  try {
    const result = spawnSync(process.execPath, [path.join(f.temp, 'worker.mjs'), hash('reviewed request')], { input: '{"action":"deploy","scope":"abbott"}', encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Transport authority mismatch/);
    assert.ok(!fs.existsSync(path.join(f.temp, 'dashboard-zaruku')));
    assert.ok(!fs.existsSync(path.join(f.temp, '.dashboard-zaruku-deploy.lock')));
  } finally { f.close(); }
});

test('active app and both immutable rollout records survive failed PM2 start and failed recovery', async () => {
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
    let stopped = false;
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, { ...f.platform, start: async () => { throw new Error('fixture start failed'); }, stop: async () => { stopped = true; } }), /restoration failed/);
    assert.ok(stopped);
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${previousSha}\n`);
    const records = fs.readdirSync(path.join(f.temp, '.dashboard-zaruku-control')).filter(name => /^[a-f0-9]{32}$/.test(name));
    assert.equal(records.length, 2);
    assert.ok(fs.readdirSync(path.join(f.temp, 'dashboard-zaruku-releases')).some(name => name.includes('-failed-')));
  } finally { f.close(); }
});

test('deploy runs locked dependency installation and full predeploy verification before preparing a request', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-build-gate-'));
  try {
    const log = path.join(temp, 'commands');
    fs.writeFileSync(path.join(temp, 'npm'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');\n`, { mode: 0o755 });
    const moduleUrl = pathToFileURL(path.join(root, 'scripts/deploy-runtime.mjs')).href;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { buildVerifiedRelease } from ${JSON.stringify(moduleUrl)}; buildVerifiedRelease();`], { cwd: root, env: { ...process.env, PATH: `${temp}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), 'ci\nrun predeploy:verify\n');
  } finally { fs.rmSync(temp, { recursive: true }); }
});
