import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { reviewedSource, rejectShadowOverrides } from './stage-zaruku-shadow-control.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REF = 'refs/heads/release/zaruku';
const BASE = 'ee950f3917d0f8616b6229d4049410a0afb7e380';
const fail = () => { throw new Error('Zaruku exact release authority refused'); };

function validSource(source, expected) {
  if (!source || source.clean !== true || typeof source.branch !== 'string' || !source.branch || !/^[a-f0-9]{40}$/.test(source.sha) || expected && source.sha !== expected) fail();
  return source;
}

async function inspect(adapter) {
  const value = await adapter.command(['ls-remote', '--exit-code', '--refs', 'origin', REF]);
  if (value.error || value.signal || value.stderr) fail();
  if (value.status === 2 && value.stdout === '') return null;
  const match = /^([a-f0-9]{40})\trefs\/heads\/release\/zaruku\n?$/.exec(value.stdout);
  if (value.status !== 0 || !match) fail();
  return match[1];
}

export async function requireExactShadowRelease(adapter, sourceSha) {
  const before = validSource(await adapter.source(), sourceSha);
  if (await inspect(adapter) !== sourceSha || !isDeepStrictEqual(await adapter.source(), before)) fail();
  return { passed: true, sourceSha };
}

export async function freezeShadowRelease(adapter, createIfAbsent = false) {
  const before = validSource(await adapter.source());
  await adapter.verifyBase(before.sha);
  const observed = await inspect(adapter);
  if (!isDeepStrictEqual(await adapter.source(), before)) fail();
  if (observed !== null && observed !== before.sha || observed === null && !createIfAbsent) fail();
  let created = false;
  if (observed === null) {
    const result = await adapter.command(['push', '--atomic', `--force-with-lease=${REF}:`, 'origin', `${before.sha}:${REF}`]);
    if (result.status !== 0 || result.signal || result.error) fail();
    created = true;
  }
  await requireExactShadowRelease(adapter, before.sha);
  if (!isDeepStrictEqual(await adapter.source(), before)) fail();
  return { sourceSha: before.sha, ref: REF, created };
}

export function createReleaseAuthorityAdapter() {
  const command = args => spawnSync('/usr/bin/git', ['--no-replace-objects', '-C', ROOT, ...args], { env: { PATH: '/usr/bin:/bin', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_PAGER: '/bin/cat' }, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000, maxBuffer: 65536 });
  return { source: reviewedSource, command, verifyBase(sourceSha) {
    const result = command(['merge-base','--is-ancestor',BASE,sourceSha]);
    if (result.status !== 0 || result.signal || result.error) fail();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    rejectShadowOverrides([]);
    if (args.length !== 1 || !['check','create-if-absent'].includes(args[0])) fail();
    process.stdout.write(JSON.stringify(await freezeShadowRelease(createReleaseAuthorityAdapter(), args[0] === 'create-if-absent')) + '\n');
  } catch { process.stderr.write('Zaruku exact release authority refused\n'); process.exitCode = 1; }
}
