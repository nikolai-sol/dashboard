import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { validateFixtureAuthority, fixtureRunArguments, verifyFixtureImage } from './zaruku-linux-fixture-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const load = () => JSON.parse(fs.readFileSync(path.join(root, 'deploy/zaruku/linux-fixture.json')));

test('fixture image locks every build input and final image identity', () => {
  const authority = load(); validateFixtureAuthority(authority);
  assert.match(authority.base, /^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/);
  assert.equal(authority.platform, 'linux/amd64');
  assert.match(authority.snapshot, /^\d{8}T\d{6}Z$/);
  assert.deepEqual(Object.keys(authority.packages).sort(), ['passwd', 'python3', 'util-linux']);
  assert.match(authority.dockerfileSha256, /^[a-f0-9]{64}$/);
  assert.match(authority.packageManifestSha256, /^[a-f0-9]{64}$/);
  assert.match(authority.imageId, /^sha256:[a-f0-9]{64}$/);
});

test('mutable bases, unlocked inputs, extra keys and package upgrades are rejected', () => {
  for (const mutate of [a => { a.base = 'node:22-bookworm-slim'; }, a => { a.base = 'node@sha256:' + 'a'.repeat(64); }, a => { a.snapshot = 'latest'; }, a => { a.packages.python3 = '*'; }, a => { a.imageId = 'node:fixture'; }, a => { a.packageManifestSha256 = ''; }, a => { a.privileged = true; }]) {
    const authority = load(); mutate(authority); assert.throws(() => validateFixtureAuthority(authority), /fixture/i);
  }
});

test('fixture platform must match the production amd64 architecture', () => {
  for (const platform of [undefined, 'linux/arm64', 'linux/386']) assert.throws(() => validateFixtureAuthority({ ...load(), platform }), /fixture/i);
});

test('runtime arguments are fixed to immutable isolated disposable fixture execution', () => {
  const authority = load(), args = fixtureRunArguments(authority, root);
  assert.ok(args.includes('--rm')); assert.ok(args.includes('--read-only'));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--cap-add') + 1], 'SYS_PTRACE');
  assert.equal(args.filter(x => x === '--cap-add').length, 1);
  assert.ok(args.includes(`type=bind,src=${root},dst=/src,readonly`));
  assert.ok(args.includes(authority.imageId));
  assert.doesNotMatch(args.join(' '), /--privileged|--network host|src=\/var\/www|dst=\/src,rw|apt-get|--build/);
  assert.match(args.join(' '), /stamp-runtime-artifact\.test\.py/);
  assert.match(args.join(' '), /boot-zaruku-service\.linux\.test\.mjs/);
  assert.match(args.join(' '), /zaruku-shadow-mysql\.linux\.test\.py/);
});

test('verification rejects a changed Dockerfile, package set or local image ID', async () => {
  const authority = load();
  for (const field of ['dockerfileSha256', 'packageManifestSha256', 'imageId']) {
    const adapter = { inspect: async () => ({ ...authority, [field]: field === 'imageId' ? 'sha256:' + 'f'.repeat(64) : 'f'.repeat(64), executables: ['/usr/bin/python3', '/usr/bin/setpriv', '/usr/sbin/useradd', '/usr/sbin/groupadd'] }) };
    await assert.rejects(() => verifyFixtureImage(adapter, authority), /fixture/i);
  }
});

test('inspected image platform is independently verified, including missing platform',async()=>{
  const authority=load(),observed={...authority,executables:['/usr/bin/python3','/usr/bin/setpriv','/usr/sbin/useradd','/usr/sbin/groupadd']};
  assert.equal((await verifyFixtureImage({inspect:async()=>observed},authority)).passed,true);
  for(const platform of [undefined,'linux/arm64'])await assert.rejects(()=>verifyFixtureImage({inspect:async()=>({...observed,platform})},authority));
});

test('Dockerfile has a fixed snapshot and exact direct packages with no repository copy', () => {
  const text = fs.readFileSync(path.join(root, 'deploy/zaruku/linux-fixture.Dockerfile'), 'utf8');
  assert.match(text, /FROM docker\.io\/library\/node@sha256:[a-f0-9]{64}/);
  assert.match(text, /snapshot\.debian\.org/); assert.match(text, /--no-install-recommends/);
  for (const pkg of ['python3', 'util-linux', 'passwd']) assert.match(text, new RegExp(pkg + '=[^\\s]+'));
  assert.doesNotMatch(text, /\b(?:COPY|ADD|ARG)\b|apt-get upgrade|deb\.debian\.org|security\.debian\.org/);
});
