import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/index.ts';
import { assertRuntimeArtifact, verifyRuntimeArtifactBoot } from './runtime-artifact-policy.mjs';
import { readPinned, safeRelative } from './runtime-release-remote.mjs';

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
]);
const fail = message => { throw new Error(message); };

export function validateAuthority(filename) {
  if (path.resolve(filename) !== AUTHORITY || fs.realpathSync(filename) !== AUTHORITY || !fs.lstatSync(filename).isFile() || fs.lstatSync(filename).nlink !== 1) fail('Invalid repository release authority');
  const parsed = JSON.parse(fs.readFileSync(filename));
  if (!isDeepStrictEqual(parsed, RUNTIME_MANIFESTS.zaruku)) fail('Release authority differs from compiled runtime contract');
  return parsed;
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function verifySource(repo, activeSha) {
  if (git(repo, 'status', '--porcelain', '--untracked-files=normal')) fail('Zaruku source must be clean');
  if (!git(repo, 'branch', '--show-current')) fail('Zaruku source must be on a named branch');
  const sha = git(repo, 'rev-parse', 'HEAD');
  for (const [ref, label] of [['refs/remotes/origin/release/zaruku', 'origin/release/zaruku'], ...(activeSha ? [[activeSha, 'active Zaruku SHA']] : [])]) {
    if (activeSha && !/^[a-f0-9]{40}$/.test(activeSha)) fail('Invalid active Zaruku SHA');
    try { git(repo, 'rev-parse', '--verify', `${ref}^{commit}`); git(repo, 'merge-base', '--is-ancestor', ref, sha); }
    catch { fail(`Candidate does not contain ${label}`); }
  }
  return sha;
}

function transfer(request) {
  const input = Buffer.from(JSON.stringify(request));
  const digest = hash(input);
  // No remotely evaluated value comes from an environment override. Payload bytes
  // travel on stdin; the immutable digest and reviewed worker travel in SSH argv.
  const worker = fs.readFileSync(path.join(ROOT, 'scripts/runtime-release-remote.mjs'), 'utf8');
  const code = `${worker}\nawait remoteMain(${JSON.stringify(digest)});`;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin node --input-type=module -e ${quote(code)}`;
  const result = spawnSync(SSH, ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '--', 'beget', command], { input, encoding: 'utf8', maxBuffer: 1048576 });
  if (result.status !== 0) fail(`Zaruku remote operation failed${result.stderr?.trim() ? `: ${result.stderr.trim().slice(0, 2000)}` : ''}`);
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
  execFileSync('npm', ['ci'], { cwd: ROOT, stdio: 'inherit' });
  // test:release-runtime builds the isolated workspace before its real packaging
  // fixture; the remainder of the existing gate also verifies the combined app.
  execFileSync('npm', ['run', 'predeploy:verify'], { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  for (const key of Object.keys(process.env)) if (FORBIDDEN_ENV.includes(key) || /^GIT_(?:CONFIG|DIR|WORK_TREE|INDEX|OBJECT)/.test(key)) fail('Fixed release authority override rejected');
  const [filename, action, ...extra] = process.argv.slice(2);
  if (!filename || extra.length || !['deploy', 'rollback'].includes(action)) fail('Invalid fixed authority invocation');
  validateAuthority(filename);
  // Clean tracked helpers are the deploy authority, including rollback invocations.
  if (git(ROOT, 'status', '--porcelain', '--untracked-files=normal') || !git(ROOT, 'branch', '--show-current')) fail('Release authority must be a clean named checkout');
  const active = transfer({ action: 'inspect' });
  if (action === 'rollback') {
    const result = transfer({ action, expectedActiveSha: active?.sourceSha ?? null });
    process.stdout.write(`Zaruku rollback attested: ${result.sourceSha}\n`); return;
  }
  git(ROOT, 'fetch', '--quiet', 'origin', '+refs/heads/release/zaruku:refs/remotes/origin/release/zaruku');
  const sourceSha = verifySource(ROOT, active?.sourceSha ?? null);
  // Build itself prepares external authority from clean build inputs; packaging
  // never calls --prepare or trusts a replacement artifact-generated allow-list.
  buildVerifiedRelease();
  await verifyRuntimeArtifactBoot(ARTIFACT, 'zaruku', { trustedManifestPath: MANIFEST });
  const payload = preparePayload(sourceSha);
  {
    // Snapshot selected bytes and the external authority in memory before remote
    // staging; a second source check binds this immutable request to the checkout.
    const latest = transfer({ action: 'inspect' });
    git(ROOT, 'fetch', '--quiet', 'origin', '+refs/heads/release/zaruku:refs/remotes/origin/release/zaruku');
    if (verifySource(ROOT, latest?.sourceSha ?? null) !== sourceSha) fail('Clean source changed after build');
    validateAuthority(filename);
    const result = transfer({ action, expectedActiveSha: latest?.sourceSha ?? null, payload });
    if (result.sourceSha !== sourceSha || result.scope !== 'zaruku' || result.manifestDigest !== payload.manifestDigest) fail('Active Zaruku attestation mismatch');
    process.stdout.write(`Zaruku release attested: ${sourceSha}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`Refusing Zaruku operation: ${error.message}\n`); process.exitCode = 1; });
}
