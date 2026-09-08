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
const dedicatedInput = { ZARUKU_DB_HOST: 'localhost', ZARUKU_DB_PORT: '3306', ZARUKU_DB_USER: 'zaruku_fixture', ZARUKU_DB_PASSWORD: 'fixture-password', ZARUKU_DB_NAME: 'report_bd', DASHBOARD_AUTH_SECRET: 'fixture-auth' };

test('child deploy binding requires an exact SHA and run ID with no substitutions', () => {
  const binding={sourceSha:sha,runId:'00000000-0000-4000-8000-000000000000'};
  assert.deepEqual(api.parseDeploymentBinding(Buffer.from(JSON.stringify(binding))),binding);
  for (const value of [{}, {...binding,runId:'wrong'}, {...binding,sourceSha:'wrong'}, {...binding,pid:12}]) assert.throws(()=>api.parseDeploymentBinding(Buffer.from(JSON.stringify(value))));
  assert.throws(()=>api.parseDeploymentBinding(Buffer.alloc(513)));
});

test('shared dedicated serializer round-trips exact reader grammar and sanitizes rejected values', () => {
  const bytes = worker.serializeZarukuSecrets(dedicatedInput);
  assert.deepEqual(worker.parseZarukuSecrets(bytes), dedicatedInput);
  assert.equal(bytes.toString(), Object.entries(dedicatedInput).map(([key, value]) => `${key}='${value}'\n`).join(''));
  for (const value of ["invalid'value", 'invalid\\value', 'invalid`value', 'invalid\nvalue']) {
    assert.throws(() => worker.serializeZarukuSecrets({ ...dedicatedInput, DASHBOARD_AUTH_SECRET: value }), error => !error.message.includes(value));
  }
  assert.throws(() => worker.parseZarukuSecrets(Buffer.concat([bytes, bytes])), /Zaruku credential/);
});

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

test('clean named branch must equal refreshed release/zaruku and contain current Zaruku SHA', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-git-'));
  const git = (...args) => execFileSync('git', ['-C', temp, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(temp, 'fact'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/release/zaruku', base);
    git('checkout', '-qb', 'candidate'); fs.writeFileSync(path.join(temp, 'fact'), 'next'); git('commit', '-qam', 'next');
    const candidate = git('rev-parse', 'HEAD');
    assert.throws(() => api.verifySource(temp, base), /release\/zaruku/);
    git('update-ref', 'refs/remotes/origin/release/zaruku', candidate);
    assert.equal(api.verifySource(temp, base), candidate);
    fs.writeFileSync(path.join(temp, 'dirty'), 'x'); assert.throws(() => api.verifySource(temp, base), /clean/); fs.unlinkSync(path.join(temp, 'dirty'));
    git('checkout', '--detach', '-q'); assert.throws(() => api.verifySource(temp, base), /named branch/);
    git('checkout', '-q', 'candidate'); git('checkout', '-qb', 'sibling', base);
    fs.writeFileSync(path.join(temp, 'fact'), 'sibling'); git('commit', '-qam', 'sibling'); const sibling = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'candidate'); assert.throws(() => api.verifySource(temp, sibling), /active Zaruku/);
    git('update-ref', 'refs/remotes/origin/release/zaruku', sibling); assert.throws(() => api.verifySource(temp, base), /release\/zaruku/);
    git('replace', '--graft', candidate, sibling);
    assert.equal(spawnSync('git', ['--no-replace-objects', '-C', temp, 'merge-base', '--is-ancestor', sibling, candidate]).status, 1);
    assert.throws(() => api.verifySource(temp, sibling), /release\/zaruku|active Zaruku/);
    git('update-ref', 'refs/remotes/origin/release/zaruku', candidate);
    assert.throws(() => api.verifySource(temp, sibling), /active Zaruku/);
    assert.equal(api.verifySource(temp, base), candidate);
    git('replace', '-d', candidate);
    fs.writeFileSync(path.join(temp, '.git/info/grafts'), `${candidate} ${sibling}\n`);
    assert.throws(() => api.verifySource(temp, sibling), /active Zaruku/);
    assert.equal(api.verifySource(temp, base), candidate);
  } finally { fs.rmSync(temp, { recursive: true }); }
});

test('graph substitution environment is rejected by authoritative Git helpers', () => {
  for (const key of ['GIT_REPLACE_REF_BASE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
    const before = process.env[key];
    try { process.env[key] = '0'; assert.throws(() => api.verifySource(root, sha), /authority override/); }
    finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
  }
});

test('a transient manual rollback failure preserves its authoritative backup and supports retry', async () => {
  const f = await fixture();
  try {
    const previous = await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
    const active = await f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, f.platform);
    let attempts = 0;
    await assert.rejects(f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, { ...f.platform, health: async () => { if (++attempts === 1) throw new Error('transient'); } }), /restored/);
    assert.equal(attempts, 2);
    const state = JSON.parse(fs.readFileSync(path.join(f.temp, '.dashboard-zaruku-control/current.json')));
    assert.deepEqual(state, active);
    const backup = path.join(f.temp, 'dashboard-zaruku-backups', state.previousId);
    assert.equal(fs.readFileSync(path.join(backup, '.release-source-sha'), 'utf8'), previousSha + '\n');
    assert.equal((await f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform)).id, previous.id);
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), previousSha + '\n');
  } finally { f.close(); }
});

test('boot cannot proceed without an enforceable fixed service-account mechanism', async () => {
  assert.equal(typeof worker.bootRuntimeAsService, 'function');
  if (process.platform !== 'linux' || process.getuid() !== 0) await assert.rejects(worker.bootRuntimeAsService('/not-an-artifact'), /Linux.*privileged|privileged.*Linux/);
});

test('real remote verification inspects authority but refuses app boot without Linux privilege isolation', async () => {
  if (process.platform === 'linux' && process.getuid() === 0) return;
  const payload = api.preparePayload(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  const f = await fixture();
  try {
    assert.equal(typeof f.mod.verifyStagedArtifact, 'function');
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload }, { ...f.platform, verify: f.mod.verifyStagedArtifact }), /privileged Linux verifier/);
    assert.ok(!fs.existsSync(path.join(f.temp, 'dashboard-zaruku')));
  } finally { f.close(); }
});

test('rollback recovery guards a reoccupied backup slot and preserves the current release', async () => {
  for (const collision of ['directory', 'symlink']) {
    const f = await fixture();
    try {
      const previous = await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
      await f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, f.platform);
      const target = path.join(f.temp, 'dashboard-zaruku-backups', previous.id);
      let attempts = 0;
      await assert.rejects(f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, { ...f.platform, health: async () => {
        if (++attempts !== 1) return;
        if (collision === 'directory') fs.mkdirSync(target);
        else fs.symlinkSync(path.join(f.temp, 'unrelated'), target);
        throw new Error('transient with occupied recovery slot');
      } }), /backup collision.*requires recovery/);
      assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), sha + '\n');
      assert.equal(fs.lstatSync(target).isSymbolicLink(), collision === 'symlink');
      assert.ok(fs.readdirSync(path.join(f.temp, 'dashboard-zaruku-releases')).some(name => name.includes('-failed-')));
    } finally { f.close(); }
  }
});

test('a failed second directory move leaves the manual rollback candidate available for retry', async () => {
  const f = await fixture();
  const rename = fs.renameSync;
  try {
    const previous = await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
    await f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, f.platform);
    const target = path.join(f.temp, 'dashboard-zaruku-backups', previous.id);
    fs.renameSync = (source, destination) => { if (source === target) throw new Error('fixture move failure'); return rename(source, destination); };
    await assert.rejects(f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform), /restored/);
    fs.renameSync = rename;
    assert.equal(fs.readFileSync(path.join(target, '.release-source-sha'), 'utf8'), previousSha + '\n');
    assert.equal((await f.mod.transact({ action: 'rollback', expectedActiveSha: sha }, f.platform)).id, previous.id);
  } finally { fs.renameSync = rename; f.close(); }
});

test('environment rendering is scoped, fixed, redacted and cannot evaluate shell input', () => {
  const secret = 'fixture-only-password;$(touch nope)';
  const input = { ...dedicatedInput, ZARUKU_DB_PASSWORD: secret };
  const output = worker.renderEnvironment(input);
  assert.deepEqual(Object.keys(output).sort(), worker.ENV_KEYS.filter(k => k !== 'PUPPETEER_EXECUTABLE_PATH').sort());
  assert.equal(output.MYSQL_DB, 'report_bd'); assert.equal(output.DB_NAME, 'report_bd');
  assert.equal(output.DB_PASSWORD, secret); assert.equal(output.HOSTNAME, '127.0.0.1'); assert.equal(output.PORT, '3002');
  assert.equal(output.INTERNAL_BASE_URL, 'http://127.0.0.1:3002');
  assert.throws(() => worker.renderEnvironment({ ...input, ZARUKU_DB_PASSWORD: 'private-secret\nBAD=1' }), error => !error.message.includes('private-secret'));
  assert.throws(() => worker.renderEnvironment({ ...input, ZARUKU_DB_USER: '' }), /required/);
});

test('dedicated Zaruku credentials are mandatory and combined or unknown inputs fail closed', () => {
  const combined = { MYSQL_USER: 'combined-user', MYSQL_PASSWORD: 'combined-secret', MYSQL_DB: 'report_bd', DASHBOARD_AUTH_SECRET: 'fixture-auth' };
  assert.throws(() => worker.renderEnvironment(combined), error => /Zaruku/.test(error.message) && !/combined-user|combined-secret/.test(error.message));
  for (const key of ['ZARUKU_DB_HOST', 'ZARUKU_DB_PORT', 'ZARUKU_DB_USER', 'ZARUKU_DB_PASSWORD', 'ZARUKU_DB_NAME']) {
    const missing = { ...dedicatedInput }; delete missing[key];
    assert.throws(() => worker.renderEnvironment(missing), /required/);
  }
  for (const key of ['MYSQL_PASSWORD', 'DB_USER', 'MYSQL_DB_STAT', 'METRIKA_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN', 'ABBOTT_PRIVATE_DB_PASSWORD', 'DASHBOARD_ADMIN_PASSWORD', 'AI_SUMMARY_API_KEY', 'HOSTNAME', 'PORT', 'secret-in-key']) {
    assert.throws(() => worker.renderEnvironment({ ...dedicatedInput, [key]: 'never-echo-value' }), error => /Zaruku/.test(error.message) && !/never-echo-value|secret-in-key/.test(error.message));
  }
});

test('fixed dedicated secret file is bounded, exact, private and never falls back to combined secrets', async () => {
  const f = await fixture();
  try {
    const directory = path.join(f.temp, '.dashboard-zaruku-secrets');
    fs.mkdirSync(directory, { mode: 0o700 });
    const filename = path.join(directory, 'runtime.env');
    assert.throws(() => f.mod.readZarukuSecrets(), /Zaruku credential file/);
    const valid = Object.entries(dedicatedInput).map(([key, value]) => `${key}='${value}'\n`).join('');
    fs.writeFileSync(filename, valid, { mode: 0o600 });
    assert.deepEqual(f.mod.readZarukuSecrets(), dedicatedInput);
    for (const invalid of [valid + "MYSQL_USER='combined-secret'\n", valid + "ZARUKU_DB_USER='duplicate-secret'\n", "BAD='private-secret\n", 'x'.repeat(65537)]) {
      fs.writeFileSync(filename, invalid);
      assert.throws(() => f.mod.readZarukuSecrets(), error => /Zaruku credential file/.test(error.message) && !/combined-secret|duplicate-secret|private-secret/.test(error.message));
    }
    fs.writeFileSync(filename, valid); fs.chmodSync(filename, 0o644);
    assert.throws(() => f.mod.readZarukuSecrets(), /Zaruku credential file/);
    fs.chmodSync(filename, 0o600); fs.linkSync(filename, path.join(directory, 'alias'));
    assert.throws(() => f.mod.readZarukuSecrets(), /Zaruku credential file/);
    assert.doesNotMatch(read('scripts/runtime-release-remote.mjs'), /\.production\.env/);
  } finally { f.close(); }
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
    .replace('const DEPLOY_UID = 0;', `const DEPLOY_UID = ${process.getuid()};`)
    .replace('const DEPLOY_GID = 0;', `const DEPLOY_GID = ${process.getgid()};`);
  assert.notEqual(source, read('scripts/runtime-release-remote.mjs'));
  const name = path.join(temp, 'worker.mjs'); fs.writeFileSync(name, source);
  const mod = await import(pathToFileURL(name).href);
  const calls = [];
  let processState=null, sequence=100;
  const platform = {
    account: () => ({ uid: process.getuid() + 1, gid: process.getgid() + 1 }),
    chown: () => {},
    verify: async (artifact, manifest, boot) => { calls.push({ artifact, manifest, boot }); },
    snapshot: () => processState && structuredClone(processState),
    start: async () => { processState={pid:++sequence,pmId:7,startTime:String(sequence),bootId:'00000000-0000-4000-8000-000000000000',uid:process.getuid()+1,gid:process.getgid()+1,cwd:`${temp}/dashboard-zaruku/apps/zaruku`,listener:'127.0.0.1:3002'}; }, health: async () => {}, stop: async () => { processState=null; },
    secrets: () => ({ ...dedicatedInput }),
  };
  function payload(sourceSha, scope = 'zaruku') {
    const files = [{ path: '.release-source-sha', data: Buffer.from(`${sourceSha}\n`).toString('base64'), mode: 0o644 }, { path: '.release-runtime-scope', data: Buffer.from(`${scope}\n`).toString('base64'), mode: 0o644 }];
    const manifest = JSON.stringify({ version: 1, sourceSha, scope, files: files.map(f => ({ path: f.path, type: 'file', mode: f.mode, size: Buffer.from(f.data, 'base64').length, sha256: hash(Buffer.from(f.data, 'base64')), required: true })) });
    return { sourceSha, scope, manifest, manifestDigest: hash(manifest), files, control: [{ path: 'scripts/runtime-artifact-policy.mjs', data: Buffer.from('fixture policy').toString('base64'), mode: 0o600 }] };
  }
  return { temp, mod, platform, calls, payload, close: () => fs.rmSync(temp, { recursive: true }) };
}

test('deployment cleanup requires durable run ownership and rejects successors and PID reuse',async()=>{
  const binding={sourceSha:sha,runId:'00000000-0000-4000-8000-000000000001'};
  const f=await fixture();let stops=0;
  const platform={...f.platform,stop:async id=>{assert.equal(id,7);stops++;}};
  try {
    assert.deepEqual(await f.mod.transact({action:'stop-owned',binding},platform),{passed:true,stopped:false});
    await assert.rejects(f.mod.transact({action:'deploy',expectedActiveSha:null,binding,payload:f.payload(sha)},{...platform,verify:async()=>{throw new Error();}}));
    assert.deepEqual(await f.mod.transact({action:'stop-owned',binding},platform),{passed:true,stopped:false});
    await f.mod.transact({action:'deploy',expectedActiveSha:null,binding,payload:f.payload(sha)},platform);
    const receipt=path.join(f.temp,'.dashboard-zaruku-control',`ownership-${binding.runId}.json`);
    assert.equal(fs.statSync(receipt).mode&0o777,0o600);
    assert.equal(JSON.parse(fs.readFileSync(receipt)).binding.runId,binding.runId);
    for(const change of [{pid:999},{startTime:'reused'},{uid:9},{gid:9},{cwd:'/foreign'},{listener:'0.0.0.0:3002'},{bootId:'other'},{pmId:8}]) {
      await assert.rejects(f.mod.transact({action:'stop-owned',binding},{...platform,snapshot:()=>({...platform.snapshot(),...change})}));
      assert.equal(stops,0);
    }
    assert.deepEqual(await f.mod.transact({action:'stop-owned',binding},platform),{passed:true,stopped:true});
    assert.equal(stops,1);
    const successor={sourceSha:previousSha,runId:'00000000-0000-4000-8000-000000000002'};
    await f.mod.transact({action:'deploy',expectedActiveSha:sha,binding:successor,payload:f.payload(previousSha)},platform);
    await assert.rejects(f.mod.transact({action:'stop-owned',binding},platform));assert.equal(stops,1);
    fs.mkdirSync(path.join(f.temp,'.dashboard-zaruku-deploy.lock'));
    await assert.rejects(f.mod.transact({action:'stop-owned',binding:successor},platform),/lock/);assert.equal(stops,1);
  } finally {f.close();}
});

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
  const runtimeEnv = { ...worker.renderEnvironment(dedicatedInput) };
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

test('failed PM2 start preserves the unchanged owned predecessor without guessed stop or restart', async () => {
  const f = await fixture();
  try {
    await f.mod.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload(previousSha) }, f.platform);
    let stopped = false;
    await assert.rejects(f.mod.transact({ action: 'deploy', expectedActiveSha: previousSha, payload: f.payload(sha) }, { ...f.platform, start: async () => { throw new Error('fixture start failed'); }, stop: async () => { stopped = true; } }), /predecessor restored/);
    assert.equal(stopped,false);
    assert.equal(fs.readFileSync(path.join(f.temp, 'dashboard-zaruku/.release-source-sha'), 'utf8'), `${previousSha}\n`);
    const records = fs.readdirSync(path.join(f.temp, '.dashboard-zaruku-control')).filter(name => /^[a-f0-9]{32}$/.test(name));
    assert.equal(records.length, 2);
    assert.ok(fs.readdirSync(path.join(f.temp, 'dashboard-zaruku-releases')).some(name => name.includes('-failed-')));
  } finally { f.close(); }
});

test('ambiguous startup and unchanged process identity never grant cleanup ownership',async()=>{
  for(const reply of ['lost','unchanged']) {
    const f=await fixture();let stops=0;
    try {
      if(reply==='unchanged')await f.mod.transact({action:'deploy',expectedActiveSha:null,payload:f.payload(previousSha)},f.platform);
      await assert.rejects(f.mod.transact({action:'deploy',expectedActiveSha:reply==='unchanged'?previousSha:null,payload:f.payload(sha)},{...f.platform,stop:async()=>{stops++;},start:async()=>{if(reply==='lost'){await f.platform.start();throw new Error('lost reply');}}}),/ownership|restoration/);
      assert.equal(stops,0);
    } finally {f.close();}
  }
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
    fs.unlinkSync(log);
    const privileged = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { buildVerifiedRelease } from ${JSON.stringify(moduleUrl)}; process.getuid = () => 0; buildVerifiedRelease();`], { cwd: root, env: { ...process.env, PATH: `${temp}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.notEqual(privileged.status, 0);
    assert.match(privileged.stderr, /unprivileged/);
    assert.ok(!fs.existsSync(log));
  } finally { fs.rmSync(temp, { recursive: true }); }
});
