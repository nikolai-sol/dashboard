// Real Linux/root fixture. Run in a disposable network-disabled container with
// the reviewed checkout mounted read-only at /src and a Node + util-linux image.
// Add SYS_PTRACE to the verifier container so its root parent can independently
// read the different-UID child's /proc/<pid>/cwd; application capabilities drop to 0.
// This test never uses /var/www or any production file/account outside that container.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { bootRuntimeAsService } from './runtime-release-remote.mjs';
import { prepareReviewedControl, receiveControlPayload, readControlSource } from './stage-zaruku-shadow-control.mjs';

if (process.platform !== 'linux' || process.getuid() !== 0 || !fs.existsSync('/.dockerenv')) throw new Error('This behavioral fixture requires a disposable Linux root container');
const base = fs.mkdtempSync('/tmp/zaruku-privilege-');
fs.chmodSync(base, 0o755);
const artifact = path.join(base, 'artifact');
const control = path.join(base, 'control');
const sibling = path.join(base, 'sibling');
const proof = path.join('/tmp', path.basename(base) + '-proof.json');
const stagedSha = 'a'.repeat(40);
const prepared = await prepareReviewedControl({ source: () => ({ sha: stagedSha, clean: true, branch: 'codex/linux-fixture' }), readFile: readControlSource }, stagedSha);
await receiveControlPayload(prepared.bytes, prepared.digest);
const stagedHost = await import(`/var/www/.dashboard-zaruku-shadow/control/${stagedSha}/scripts/zaruku-shadow-host.mjs`);
const host = stagedHost.createHostAdapter({ commandRunner(bin, args, options) {
  // The locked test image has no iproute2; no fixed runtime is listening in this container.
  if (bin === '/usr/bin/ss') return { status: 0, stdout: '', stderr: '' };
  return spawnSync(bin, args, options);
} });
const beforeStage = fs.statSync('/var/www/.dashboard-zaruku-shadow');
assert.equal((await stagedHost.inspectHostBoundary(host)).state, 'staged');
const boundary = await stagedHost.applyHostBoundary(host);
const { uid, gid } = boundary.user;
fs.mkdirSync(path.join(artifact, 'apps/zaruku'), { recursive: true, mode: 0o755 });
fs.mkdirSync(control, { mode: 0o700 }); fs.mkdirSync(sibling, { mode: 0o755 });
fs.writeFileSync(path.join(control, 'manifest'), 'protected', { mode: 0o600 });
const server = `const fs = require('node:fs'); const http = require('node:http');
const attempts = ${JSON.stringify([path.join(control, 'manifest'), path.join(sibling, 'foreign-write'), path.join(artifact, 'injected')])}.map(file => { try { fs.writeFileSync(file, 'bad'); return true; } catch { return false; } });
fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),egid:process.getegid(),groups:process.getgroups(),cwd:process.cwd(),env:Object.keys(process.env).sort(),attempts,status:fs.readFileSync('/proc/self/status','utf8')}));
http.createServer((req,res) => {res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,scope:'zaruku'}));}).listen(+process.env.PORT, process.env.HOSTNAME);
`;
fs.writeFileSync(path.join(artifact, 'apps/zaruku/server.js'), server, { mode: 0o644 });

test('direct mutation CLIs reject before auth input or host inspection even inside the staged bundle', () => {
  const staged = `/var/www/.dashboard-zaruku-shadow/control/${stagedSha}`;
  for (const [script, args] of [
    ['zaruku-shadow-host.mjs', ['apply', `${staged}/deploy/zaruku/production-shadow.json`]],
    ['install-zaruku-shadow-auth.mjs', []],
  ]) {
    const result = spawnSync(process.execPath, [`${staged}/scripts/${script}`, ...args], { encoding: 'utf8', env: {}, input: '{"headers":{"cookie":"opaque-test-descriptor"}}', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /staged dispatcher/);
    assert.equal(result.stdout, '');
  }
  assert.equal(fs.existsSync('/var/www/.dashboard-zaruku-shadow/auth.json'), false);
});

test('staged dispatcher checks its entire closure and rejects tampering before loading mutation dependencies', () => {
  const staged = `/var/www/.dashboard-zaruku-shadow/control/${stagedSha}`;
  const dispatcher = `${staged}/scripts/zaruku-shadow-dispatch.mjs`;
  const invoke = (action = 'attest', env = {}) => spawnSync(process.execPath, [dispatcher, action], { encoding: 'utf8', env, input: '{"headers":{"cookie":"opaque-test-descriptor"}}', timeout: 5000 });
  const valid = invoke(); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).sourceSha, stagedSha);
  assert.notEqual(invoke('attest', { NODE_OPTIONS: '--trace-warnings' }).status, 0);
  for (const name of ['scripts/zaruku-shadow-host.mjs', '.manifest.json', '.inodes.json']) {
    const file = path.join(staged, name), saved = file + '-original';
    fs.renameSync(file, saved);
    fs.copyFileSync(saved, file); fs.chmodSync(file, 0o400);
    try { const result = invoke('auth-install'); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); }
    finally { fs.unlinkSync(file); fs.renameSync(saved, file); }
  }
  const extra = `${staged}/scripts/extra.mjs`; fs.writeFileSync(extra, 'throw new Error("PRIVATE_SENTINEL")', { mode: 0o400 });
  try { assert.notEqual(invoke().status, 0); } finally { fs.unlinkSync(extra); }
  const dependency = `${staged}/scripts/zaruku-shadow-host.mjs`, bytes = fs.readFileSync(dependency);
  fs.chmodSync(dependency, 0o600); fs.writeFileSync(dependency, 'throw new Error("PRIVATE_SENTINEL")'); fs.chmodSync(dependency, 0o400);
  try { const result = invoke('auth-install'); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /PRIVATE_SENTINEL/); }
  finally { fs.chmodSync(dependency, 0o600); fs.writeFileSync(dependency, bytes); fs.chmodSync(dependency, 0o400); }
  const copied = path.join(base, 'copied-dispatch.mjs'); fs.copyFileSync(dispatcher, copied);
  assert.notEqual(spawnSync(process.execPath, [copied, 'auth-install'], { env: {}, input: '{}', timeout: 5000 }).status, 0);
  const installed = invoke('auth-install'); assert.equal(installed.status, 0); assert.equal(JSON.parse(installed.stdout).status, 'installed');
  fs.unlinkSync('/var/www/.dashboard-zaruku-shadow/auth.json');
});

test('real boot drops all privilege before app code and cannot mutate authority, sibling or artifact', async () => {
  process.env.PARENT_SENTINEL = 'PRIVATE_PARENT_ONLY';
  process.env.UV_USE_IO_URING = 'PARENT_ONLY_VALUE';
  let identity;
  try { identity = await bootRuntimeAsService(artifact); }
  finally { delete process.env.PARENT_SENTINEL; delete process.env.UV_USE_IO_URING; }
  const data = JSON.parse(fs.readFileSync(proof));
  assert.deepEqual([data.uid, data.euid, data.gid, data.egid], [uid, uid, gid, gid]);
  assert.ok(data.groups.every(group => group === gid));
  assert.match(data.status, /^Groups:[\t ]*$/m);
  assert.match(data.status, /^NoNewPrivs:[\t ]*1$/m);
  for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(data.status, new RegExp('^' + name + ':[\\t ]*0+$', 'm'));
  assert.equal(data.cwd, path.join(artifact, 'apps/zaruku'));
  assert.deepEqual(data.env, ['HOSTNAME', 'NODE_ENV', 'PORT']);
  assert.deepEqual(data.attempts, [false, false, false]);
  assert.equal(identity.uid, uid); assert.equal(identity.gid, gid);
  assert.deepEqual(identity.supplementaryGroups, []);
  assert.equal(fs.readFileSync(path.join(control, 'manifest'), 'utf8'), 'protected');
});

test('real staged and rollback boots traverse the actual provisioned roots without listing or writing them', async () => {
  for (const root of ['/var/www/dashboard-zaruku-releases', '/var/www/dashboard-zaruku-backups']) {
    const target = path.join(root, 'a'.repeat(32));
    fs.cpSync(artifact, target, { recursive: true });
    try {
      const observed = await bootRuntimeAsService(target);
      assert.equal(observed.cwd, path.join(target, 'apps/zaruku'));
      assert.equal(fs.statSync(root).mode & 0o777, 0o711);
      const checks = execFileSync('/usr/bin/setpriv', [`--reuid=${uid}`, `--regid=${gid}`, '--clear-groups', '--', process.execPath, '-e', `const fs=require('node:fs');const root=${JSON.stringify(root)}; for(const action of [()=>fs.readdirSync(root),()=>fs.writeFileSync(root+'/foreign','x')]){try{action();process.exit(1)}catch(error){if(error.code!=='EACCES')throw error;}}`]);
      assert.equal(checks.length, 0);
    } finally { fs.rmSync(target, { recursive: true }); }
  }
});

test('missing or unsafe independent env boundary fails before application execution', async () => {
  const original = '/usr/bin/env', saved = '/usr/bin/env-fixture-original';
  fs.renameSync(original, saved);
  fs.rmSync(proof, { force: true });
  try {
    await assert.rejects(bootRuntimeAsService(artifact), /env|ENOENT|unsafe/i);
    fs.symlinkSync(saved, original);
    await assert.rejects(bootRuntimeAsService(artifact), /unsafe|owned|link/i);
    assert.ok(!fs.existsSync(proof));
  } finally { fs.rmSync(original, { force: true }); fs.renameSync(saved, original); }
});

test('missing or impersonating setpriv fails before application execution', async () => {
  const original = '/usr/bin/setpriv', saved = '/usr/bin/setpriv-task6-original';
  fs.renameSync(original, saved);
  try {
    await assert.rejects(bootRuntimeAsService(artifact), /privilege|setpriv|ENOENT/i);
    fs.writeFileSync(original, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
    fs.rmSync(proof, { force: true });
    await assert.rejects(bootRuntimeAsService(artifact), /identity|boot/i);
    assert.ok(!fs.existsSync(proof));
  } finally { fs.rmSync(original, { force: true }); fs.renameSync(saved, original); }
});

test('owned host rollback removes the production-mode roots and actual created account', async () => {
  const record = JSON.parse(fs.readFileSync('/var/www/.dashboard-zaruku-host-creation.json'));
  await stagedHost.rollbackNewHostBoundary(host, record);
  assert.equal(host.serviceIdentity(), null);
  assert.equal(fs.statSync('/var/www/.dashboard-zaruku-shadow').ino, beforeStage.ino);
  assert.deepEqual(fs.readdirSync('/var/www/.dashboard-zaruku-shadow'), ['control']);
  fs.rmSync('/var/www/.dashboard-zaruku-shadow', { recursive: true });
});

process.on('exit', () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(proof, { force: true }); });
