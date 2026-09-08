import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CONTROL_FILES, stageReviewedShadowControl, receiveControlPayload, prepareReviewedControl } from './stage-zaruku-shadow-control.mjs';

const sha = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const destination = `/var/www/.dashboard-zaruku-shadow/control/${sha}`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-control-'));
  t.after(() => {
    function writable(directory) { fs.chmodSync(directory, 0o700); for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) writable(path.join(directory, entry.name)); }
    writable(root); fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'var/www'), { recursive: true });
  const opened = new Map();
  const io = new Proxy(fs, { get(target, key) {
    if (key === 'openSync') return (filename, ...args) => { const fd = target.openSync(filename, ...args); opened.set(fd, filename); return fd; };
    if (key === 'fstatSync' || key === 'lstatSync') return (...args) => Object.assign(target[key](...args), { uid: 0, gid: 0 });
    if (key === 'fchownSync') return () => {};
    return target[key];
  } });
  const runtime = { fs: io, root, identity: { uid: 0, euid: 0 }, anchor: (fd, name) => path.join(opened.get(fd), name) };
  let payload, outerDigest;
  const adapter = {
    async source() { return { sha, branch: 'codex/reviewed', clean: true }; },
    async readFile(name) { return { bytes: Buffer.from(`${name}\n`), mode: 0o644, regular: true, singleLink: true, safeAncestors: true }; },
    async transfer(bytes, digest) { payload = bytes; outerDigest = digest; return receiveControlPayload(bytes, digest, runtime); },
  };
  return { adapter, runtime, root, payload: () => payload, digest: () => outerDigest };
}

test('fixed inventory is dependency-free authority and provisioning closure only', () => {
  assert.deepEqual(CONTROL_FILES, [
    'deploy/zaruku/mysql-read-tables.json', 'deploy/zaruku/production-shadow.json', 'deploy/zaruku/release.json',
    'scripts/install-zaruku-shadow-auth.mjs', 'scripts/install-zaruku-shadow-inventory.mjs', 'scripts/runtime-release-remote.mjs', 'scripts/verify-zaruku-shadow.sh',
    'scripts/zaruku-production-shadow-authority.mjs', 'scripts/zaruku-production-shadow-preflight.mjs',
    'scripts/zaruku-production-shadow-worker.mjs', 'scripts/zaruku-shadow-coverage.mjs', 'scripts/zaruku-shadow-db.mjs', 'scripts/zaruku-shadow-dispatch.mjs', 'scripts/zaruku-shadow-evidence-lock.py', 'scripts/zaruku-shadow-host.mjs',
    'scripts/zaruku-shadow-mysql.py', 'scripts/zaruku-xlsx-semantic.py',
  ]);
});

test('read-only preparation constructs identical reviewed bytes without a transfer',async t=>{
  const f=fixture(t);let calls=0;const original=f.adapter.transfer;f.adapter.transfer=(...args)=>{calls++;return original(...args);};
  const prepared=await prepareReviewedControl(f.adapter,sha);assert.equal(calls,0);
  await stageReviewedShadowControl(f.adapter,sha);assert.deepEqual(prepared.bytes,f.payload());assert.equal(prepared.digest,f.digest());
});

test('orchestrator inspection cannot implicitly stage a missing control bundle', async t => {
  const f = fixture(t);
  await stageReviewedShadowControl(f.adapter, sha);
  const inspected = await receiveControlPayload(f.payload(), f.digest(), f.runtime, true);
  assert.equal(inspected.sourceSha, sha);
  const missing = JSON.parse(f.payload()); missing.sourceSha = missing.manifest.sourceSha = 'b'.repeat(40);
  const bytes = Buffer.from(JSON.stringify(missing));
  await assert.rejects(() => receiveControlPayload(bytes, hash(bytes), f.runtime, true), /control/i);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'var/www/.dashboard-zaruku-shadow/control')), [sha]);
});

test('every staged byte is manifested and root-owned immutable under exact reviewed SHA', async t => {
  const f = fixture(t);
  const result = await stageReviewedShadowControl(f.adapter, sha);
  const payload = JSON.parse(f.payload());
  assert.equal(f.digest(), hash(f.payload()));
  assert.equal(result.sourceSha, sha);
  assert.equal(result.destination.path, destination);
  assert.equal(result.destination.uid, 0);
  assert.equal(result.destination.mode, '0500');
  assert.equal(result.fileCount, CONTROL_FILES.length);
  assert.deepEqual(payload.manifest.files.map(file => file.path), CONTROL_FILES);
  for (const file of payload.manifest.files) {
    const bytes = Buffer.from(payload.files.find(row => row.path === file.path).data, 'base64');
    assert.equal(file.sha256, hash(bytes)); assert.equal(file.size, bytes.length); assert.equal(file.mode, 0o400);
    const staged = path.join(f.root, destination, file.path);
    assert.deepEqual(fs.readFileSync(staged), bytes);
    assert.equal(fs.statSync(staged).mode & 0o777, 0o400);
  }
  assert.deepEqual(await stageReviewedShadowControl(f.adapter, sha), result);
});

test('replaced existing file inode fails even when byte-identical', async t => {
  const f = fixture(t); await stageReviewedShadowControl(f.adapter, sha);
  const filename = path.join(f.root, destination, CONTROL_FILES[0]);
  fs.chmodSync(path.dirname(filename), 0o700);
  const bytes = fs.readFileSync(filename); fs.unlinkSync(filename); fs.writeFileSync(filename, bytes, { mode: 0o400 });
  fs.chmodSync(path.dirname(filename), 0o500);
  await assert.rejects(() => stageReviewedShadowControl(f.adapter, sha), /control/i);
});

test('staged predecessor rejects replaced directory inodes with unchanged child files', async t => {
  for (const suffix of ['scripts', 'deploy/zaruku', '']) {
    const f = fixture(t); await stageReviewedShadowControl(f.adapter, sha);
    const filename = path.join(f.root, destination, suffix), old = filename + '-old';
    fs.chmodSync(path.dirname(filename), 0o700);
    fs.chmodSync(filename, 0o700);
    fs.renameSync(filename, old); fs.mkdirSync(filename, { mode: 0o700 });
    fs.chmodSync(old, 0o700);
    for (const name of fs.readdirSync(old)) {
      const child = path.join(old, name), mode = fs.statSync(child).mode & 0o777;
      if (fs.statSync(child).isDirectory()) fs.chmodSync(child, 0o700);
      fs.renameSync(child, path.join(filename, name));
      fs.chmodSync(path.join(filename, name), mode);
    }
    fs.rmdirSync(old); fs.chmodSync(filename, 0o500);
    fs.chmodSync(path.dirname(filename), suffix ? 0o500 : 0o700);
    await assert.rejects(() => receiveControlPayload(f.payload(), f.digest(), f.runtime, true), /control/i);
  }
});

test('outer payload digest and exact inventory are verified before any directory creation', async t => {
  const f = fixture(t); await stageReviewedShadowControl(f.adapter, sha);
  const original = JSON.parse(f.payload());
  for (const mutate of [
    value => { value.sourceSha = '../dashboard'; },
    value => { value.files[0].path = '/var/www/dashboard/.env'; },
    value => { value.files.push({ path: 'extra', data: '' }); },
    value => { value.files[0].data = Buffer.from('tampered').toString('base64'); },
  ]) {
    const value = structuredClone(original); mutate(value); const bytes = Buffer.from(JSON.stringify(value));
    await assert.rejects(() => receiveControlPayload(bytes, hash(bytes), f.runtime), /control/i);
  }
  await assert.rejects(() => receiveControlPayload(Buffer.from('not JSON SECRET_SENTINEL'), f.digest(), f.runtime), error => /control/i.test(error.message) && !error.message.includes('SECRET_SENTINEL'));
});

test('unsafe source, dirty/detached checkout and mismatched reviewed SHA never transfer', async t => {
  for (const fault of ['link', 'hardlink', 'ancestor', 'dirty', 'detached', 'sha']) {
    const f = fixture(t); let transferred = false;
    f.adapter.transfer = () => { transferred = true; throw new Error('must not reach transport'); };
    if (['dirty', 'detached', 'sha'].includes(fault)) f.adapter.source = async () => ({ sha: fault === 'sha' ? 'b'.repeat(40) : sha, branch: fault === 'detached' ? '' : 'codex/reviewed', clean: fault !== 'dirty' });
    else f.adapter.readFile = async () => ({ bytes: Buffer.from('source'), mode: 0o644, regular: fault !== 'link', singleLink: fault !== 'hardlink', safeAncestors: fault !== 'ancestor' });
    await assert.rejects(() => stageReviewedShadowControl(f.adapter, sha), /control|source|reviewed/i);
    assert.equal(transferred, false);
  }
});

test('stager cannot invoke runtime, secret, SQL, proxy or release-ref operations', async t => {
  const f = fixture(t);
  for (const method of ['deploy', 'pm2', 'nginx', 'mysql', 'installSecrets', 'updateReleaseRef']) f.adapter[method] = () => assert.fail(method);
  await stageReviewedShadowControl(f.adapter, sha);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'var/www')), ['.dashboard-zaruku-shadow']);
  for (const arg of ['--host=other', '--path=/var/www/dashboard', '--files=x', sha]) {
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'stage-zaruku-shadow-control.mjs'), arg], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});

test('pure runtime authority loads without TS or any node_modules dependency', () => {
  const script = fs.readFileSync(path.join(import.meta.dirname, 'zaruku-production-shadow-authority.mjs'), 'utf8');
  assert.doesNotMatch(script, /from ['"](?:typescript|.*\.ts)['"]/);
  for (const name of ['zaruku-shadow-host.mjs', 'zaruku-shadow-db.mjs', 'zaruku-shadow-dispatch.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(import.meta.dirname, name), 'utf8'), /from ['"](?:typescript|.*\.ts)['"]/);
});
