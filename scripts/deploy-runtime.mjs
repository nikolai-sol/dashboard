import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';
import { assertRuntimeArtifact, verifyRuntimeArtifactBoot } from './runtime-artifact-policy.mjs';
import { readPinned, safeRelative } from './runtime-release-remote.mjs';
import { CONTROL_FILES, prepareReviewedControl, readControlSource, receiveControlPayload, reviewedSource } from './stage-zaruku-shadow-control.mjs';
import { requireExactShadowRelease, createReleaseAuthorityAdapter } from './freeze-zaruku-shadow-release.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUTHORITY = path.join(ROOT, 'deploy/zaruku/release.json');
const ARTIFACT = path.join(ROOT, 'apps/zaruku/.next-zaruku/standalone');
const MANIFEST = path.join(ROOT, 'apps/zaruku/.next-zaruku/trusted-runtime-manifest.json');
const SSH = '/usr/bin/ssh';
const hash = value => createHash('sha256').update(value).digest('hex');
export const FORBIDDEN_ENV = Object.freeze([
  'RUNTIME_SCOPE', 'APP_NAME', 'APP_PORT', 'APP_DIR', 'RELEASE_BRANCH', 'DEPLOY_LOCK_DIR',
  'RELEASES_DIR', 'BACKUPS_DIR', 'RELEASE_ID', 'KEEP_BACKUPS', 'VPS', 'PUBLIC_APP_HOST', 'TARGET_BACKUP',
  'DEPLOY_REMOTE', 'DEPLOY_BASE_BRANCH', 'DEPLOY_ACTIVE_RELEASE_READER', 'DASHBOARD_DEPLOY_LOCK_DIR',
  'SSH_BIN', 'DEPLOY_SSH_BIN', 'GIT_SSH', 'GIT_SSH_COMMAND', 'RSYNC_RSH', 'REMOTE_ENV_PATH',
  'TRUSTED_MANIFEST', 'TRUSTED_MANIFEST_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV',
  'GIT_REPLACE_REF_BASE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
]);
const fail = message => { throw new Error(message); };

export function validateAuthority(filename) {
  if (path.resolve(filename) !== AUTHORITY || fs.realpathSync(filename) !== AUTHORITY || !fs.lstatSync(filename).isFile() || fs.lstatSync(filename).nlink !== 1) fail('Invalid repository release authority');
  const parsed = JSON.parse(fs.readFileSync(filename));
  if (!isDeepStrictEqual(parsed, RUNTIME_MANIFESTS.zaruku)) fail('Release authority differs from compiled runtime contract');
  return parsed;
}

function git(repo, ...args) {
  if (Object.keys(process.env).some(key => key.startsWith('GIT_') && key !== 'GIT_PAGER')) fail('Fixed Git authority override rejected');
  return execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH:'/usr/bin:/bin', GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_SYSTEM:'/dev/null', GIT_CONFIG_GLOBAL:'/dev/null', GIT_OPTIONAL_LOCKS:'0', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_PAGER: '/bin/cat' },
  }).trim();
}

export function verifySource(repo, activeSha, frozenSha) {
  if (git(repo, 'status', '--porcelain', '--untracked-files=normal')) fail('Zaruku source must be clean');
  if (!git(repo, 'branch', '--show-current')) fail('Zaruku source must be on a named branch');
  const sha = git(repo, 'rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(frozenSha) || sha !== frozenSha) fail('Candidate must exactly equal frozen source binding');
  for (const [ref, label] of (activeSha ? [[activeSha, 'active Zaruku SHA']] : [])) {
    if (activeSha && !/^[a-f0-9]{40}$/.test(activeSha)) fail('Invalid active Zaruku SHA');
    try { git(repo, 'rev-parse', '--verify', `${ref}^{commit}`); git(repo, 'merge-base', '--is-ancestor', ref, sha); }
    catch { fail(`Candidate does not contain ${label}`); }
  }
  return sha;
}

export function parseDeploymentBinding(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 512) fail('Invalid deploy binding');
    const value = JSON.parse(bytes);
    if (JSON.stringify(value)!==bytes.toString('utf8') || Object.keys(value).sort().join(',') !== 'runId,sourceSha' || !/^[a-f0-9]{40}$/.test(value.sourceSha) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.runId)) fail('Invalid deploy binding');
    return value;
  } catch { fail('Invalid deploy binding'); }
}

async function frozenSource(sourceSha) {
  return requireExactShadowRelease(createReleaseAuthorityAdapter(), sourceSha);
}

async function transfer(request) {
  const source = reviewedSource();
  const prepared = await prepareReviewedControl({ source: reviewedSource, readFile: readControlSource }, source.sha);
  const input = Buffer.from(JSON.stringify({ control: prepared.bytes.toString('base64'), controlDigest: prepared.digest, request }));
  const digest = hash(input);
  // Inspect the exact already-staged closure before importing its fixed dispatcher.
  // This transport cannot stage or replace a control file.
  const code = `const CONTROL_FILES=${JSON.stringify(CONTROL_FILES)};const inspect=(${receiveControlPayload.toString()});try{const fs=await import('node:fs');const crypto=await import('node:crypto');const bytes=fs.readFileSync(0);if(bytes.length>536870912||crypto.createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(digest)})throw new Error();const input=JSON.parse(bytes);const control=await inspect(Buffer.from(input.control,'base64'),input.controlDigest,undefined,true);const dispatcher=await import('file://'+control.destination.path+'/scripts/zaruku-shadow-dispatch.mjs');process.stdout.write(JSON.stringify(await dispatcher.dispatchStaged('release',input.request))+'\\n');}catch{process.stderr.write('Zaruku staged release refused\\n');process.exitCode=1;}`;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(code)}`;
  const result = spawnSync(SSH, ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '--', 'beget', command], { input, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', maxBuffer: 1048576, timeout: 300000 });
  if (result.status !== 0 || result.signal || result.error || result.stderr) fail('Zaruku remote operation failed');
  return JSON.parse(result.stdout);
}

export function preparePayload(sourceSha) {
  const digest = fs.readFileSync(`${MANIFEST}.sha256`, 'utf8').trim();
  const manifest = readPinned(MANIFEST, digest).toString();
  const parsed = JSON.parse(manifest);
  if (parsed.sourceSha !== sourceSha || parsed.scope !== 'zaruku') fail('External build authority does not match clean source/scope');
  assertRuntimeArtifact(ARTIFACT, 'zaruku', MANIFEST);
  const control = new Map();
  function authorityFile(name) {
    safeRelative(name);
    const file = path.join(ROOT, name), s = fs.lstatSync(file);
    if (!s.isFile() || s.nlink !== 1 || fs.realpathSync(file) !== file) fail('Unsafe build-side control authority');
    control.set(name, { path: name, data: fs.readFileSync(file).toString('base64'), mode: 0o600 });
  }
  for (const name of ['scripts/runtime-artifact-policy.mjs', 'package-lock.json', 'deploy/zaruku/ecosystem.config.cjs', 'deploy/zaruku/start.cjs']) authorityFile(name);
  const files = parsed.files.map(entry => {
    safeRelative(entry.path);
    // Optional browser files come exclusively from named build-side paths and
    // are individually checked against the same pre-existing trusted authority.
    const source = path.join(entry.required ? ARTIFACT : ROOT, entry.path);
    const s = fs.lstatSync(source);
    if (!s.isFile() || s.nlink !== 1 || fs.realpathSync(source) !== source) fail('Unsafe artifact source path');
    const bytes = fs.readFileSync(source);
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256 || (s.mode & 0o777) !== entry.mode) fail('Build bytes changed after trusted authority generation');
    if (path.basename(entry.path) === 'package.json' && entry.path !== 'apps/zaruku/.next-zaruku/package.json') authorityFile(entry.path);
    return { path: entry.path, data: bytes.toString('base64'), mode: entry.mode };
  });
  authorityFile('node_modules/dotenv/lib/main.js');
  authorityFile('node_modules/dotenv/package.json');
  readPinned(MANIFEST, digest);
  return { scope: 'zaruku', sourceSha, manifest, manifestDigest: digest, control: [...control.values()], files };
}

export function buildVerifiedRelease() {
  if (process.getuid() === 0 || process.geteuid() === 0) fail('Local release build and boot verification must run as an unprivileged user');
  execFileSync('npm', ['ci'], { cwd: ROOT, stdio: ['ignore','ignore','pipe'] });
  // test:release-runtime builds the isolated workspace before its real packaging
  // fixture; the remainder of the existing gate also verifies the combined app.
  execFileSync('npm', ['run', 'predeploy:verify'], { cwd: ROOT, stdio: ['ignore','ignore','pipe'] });
}

async function main() {
  for (const key of Object.keys(process.env)) if (FORBIDDEN_ENV.includes(key) || key.startsWith('GIT_') && key !== 'GIT_PAGER') fail('Fixed release authority override rejected');
  const [filename, action, ...extra] = process.argv.slice(2);
  if (!filename || extra.length || !['deploy', 'rollback'].includes(action)) fail('Invalid fixed authority invocation');
  if (process.getuid() === 0 || process.geteuid() === 0) fail('Local release authority must run as an unprivileged user');
  validateAuthority(filename);
  let binding;
  if (action === 'deploy') {
    if(process.stdin.isTTY)fail('Orchestrator binding required');
    const bytes = Buffer.alloc(513); let length=0;
    while(length<bytes.length){const count=fs.readSync(0,bytes,length,bytes.length-length,null);if(!count)break;length+=count;}
    binding = parseDeploymentBinding(bytes.subarray(0,length));
  }
  await frozenSource(binding?.sourceSha ?? reviewedSource().sha);
  // Clean tracked helpers are the deploy authority, including rollback invocations.
  if (git(ROOT, 'status', '--porcelain', '--untracked-files=normal') || !git(ROOT, 'branch', '--show-current')) fail('Release authority must be a clean named checkout');
  const active = await transfer({ action: 'inspect' });
  if (action === 'rollback') {
    const result = await transfer({ action, expectedActiveSha: active?.sourceSha ?? null });
    process.stdout.write(`Zaruku rollback attested: ${result.sourceSha}\n`); return;
  }
  const sourceSha = verifySource(ROOT, active?.sourceSha ?? null, binding.sourceSha);
  if (sourceSha !== binding.sourceSha) fail('Child source substitution rejected');
  // Build itself prepares external authority from clean build inputs; packaging
  // never calls --prepare or trusts a replacement artifact-generated allow-list.
  buildVerifiedRelease();
  await verifyRuntimeArtifactBoot(ARTIFACT, 'zaruku', { trustedManifestPath: MANIFEST });
  const payload = preparePayload(sourceSha);
  {
    // Snapshot selected bytes and the external authority in memory before remote
    // staging; a second source check binds this immutable request to the checkout.
    const latest = await transfer({ action: 'inspect' });
    if (verifySource(ROOT, latest?.sourceSha ?? null, binding.sourceSha) !== sourceSha) fail('Clean source changed after build');
    validateAuthority(filename);
    await frozenSource(binding.sourceSha);
    const result = await transfer({ action, expectedActiveSha: latest?.sourceSha ?? null, payload, binding });
    if (result.sourceSha !== sourceSha || result.scope !== 'zaruku' || result.manifestDigest !== payload.manifestDigest) fail('Active Zaruku attestation mismatch');
    process.stdout.write(JSON.stringify(binding) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Refusing Zaruku fixed operation\n'); process.exitCode = 1; });
}
