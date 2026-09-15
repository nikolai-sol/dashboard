import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';
import { assertRuntimeArtifact, verifyRuntimeArtifactBoot } from './runtime-artifact-policy.mjs';
import { createRuntimeInstaller } from './runtime-release-remote.mjs';
import { deriveBrowserContract } from './abbott-browser-prerequisite.mjs';
import { runAbbottDeployWithEvidence } from './abbott-deploy-session.mjs';
import { formatAbbottDeployResult } from './abbott-deploy-transport.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const SOURCE = /^[a-f0-9]{40}$/;
let abbottFailure;
export const FORBIDDEN_ENV = Object.freeze([
  'RUNTIME_SCOPE', 'APP_NAME', 'APP_PORT', 'APP_DIR', 'RELEASE_BRANCH', 'DEPLOY_LOCK_DIR',
  'RELEASES_DIR', 'BACKUPS_DIR', 'RELEASE_ID', 'KEEP_BACKUPS', 'VPS', 'PUBLIC_APP_HOST', 'TARGET_BACKUP',
  'DEPLOY_REMOTE', 'DEPLOY_BASE_BRANCH', 'DEPLOY_ACTIVE_RELEASE_READER', 'DASHBOARD_DEPLOY_LOCK_DIR',
  'SSH_BIN', 'DEPLOY_SSH_BIN', 'GIT_SSH', 'GIT_SSH_COMMAND', 'RSYNC_RSH', 'REMOTE_ENV_PATH',
  'TRUSTED_MANIFEST', 'TRUSTED_MANIFEST_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV',
]);

function regular(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink !== 1 || fs.realpathSync(filename) !== filename) fail('Unsafe runtime control file');
  return fs.readFileSync(filename);
}

export function validateAuthority(filename) {
  const absolute = path.resolve(filename);
  const expected = Object.values(RUNTIME_MANIFESTS).find(value => path.join(ROOT, 'deploy', value.scope, 'release.json') === absolute);
  if (!expected || !isDeepStrictEqual(JSON.parse(regular(absolute)), expected)) fail('Invalid fixed runtime authority');
  return expected;
}

export function validateInvocation(args, environment) {
  for (const key of Object.keys(environment)) if (FORBIDDEN_ENV.includes(key) || key.startsWith('GIT_') && key !== 'GIT_PAGER') fail('Fixed runtime authority override rejected');
  if (args.length !== 2 || !['deploy', 'rollback'].includes(args[1])) fail('Invalid fixed runtime invocation');
  return { authority: validateAuthority(args[0]), action: args[1] };
}

function repositoryFor(authority) {
  const record = JSON.parse(regular(path.join(ROOT, 'deploy', authority.scope, 'repository.json')));
  if (Object.keys(record).sort().join(',') !== 'base,ref,url,version' || record.version !== 1 || record.url !== 'git@github.com:nikolai-sol/dashboard.git' || record.ref !== `refs/heads/${authority.releaseBranch}` || !SOURCE.test(record.base)) fail('Invalid fixed repository authority');
  return record;
}

const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_PAGER: '/bin/cat' };
const gitOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv, timeout: 60000 };
const gitControls = ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];

function localGitIdentity() {
  if (fs.realpathSync(ROOT) !== ROOT) fail('Invalid local Git worktree identity');
  const marker = path.join(ROOT, '.git');
  const stat = fs.lstatSync(marker);
  let gitDir;
  if (stat.isDirectory() && !stat.isSymbolicLink()) gitDir = marker;
  else {
    const match = /^gitdir: ([^\r\n]+)\n?$/.exec(regular(marker).toString());
    if (!match) fail('Invalid local Git directory identity');
    gitDir = path.resolve(ROOT, match[1]);
    if (regular(path.join(gitDir, 'gitdir')).toString().trim() !== marker) fail('Git worktree backlink mismatch');
  }
  if (fs.realpathSync(gitDir) !== gitDir || !fs.lstatSync(gitDir).isDirectory()) fail('Invalid local Git directory identity');
  const found = execFileSync('/usr/bin/git', [...gitControls, '-C', ROOT, 'rev-parse', '--show-toplevel', '--absolute-git-dir'], gitOptions).trim().split('\n');
  if (found.length !== 2 || found[0] !== ROOT || found[1] !== gitDir) fail('Local Git directory/worktree identity mismatch');
  return gitDir;
}

function git(...args) {
  // This checkout-bound runner never resolves a repository URL.
  if (!['status', 'branch', 'rev-parse', 'merge-base'].includes(args[0])) fail('Invalid local Git operation');
  const gitDir = localGitIdentity();
  return execFileSync('/usr/bin/git', [...gitControls, '--git-dir', gitDir, '--work-tree', ROOT, '-C', ROOT, ...args], gitOptions).trim();
}

export function verifySource(authority, repository, activeSha, approvedSha, runGit = git) {
  if (runGit('status', '--porcelain', '--untracked-files=normal')) fail('Runtime source must be clean');
  if (repository.ref !== `refs/heads/${authority.releaseBranch}`) fail('Invalid fixed release ref');
  const sha = runGit('rev-parse', 'HEAD');
  if (!SOURCE.test(sha) || !SOURCE.test(approvedSha) || sha !== approvedSha) fail('Runtime candidate must exactly match the approved release ref');
  for (const predecessor of [repository.base, ...(activeSha ? [activeSha] : [])]) {
    if (!SOURCE.test(predecessor)) fail('Invalid runtime predecessor');
    try { runGit('merge-base', '--is-ancestor', predecessor, sha); }
    catch { fail('Runtime candidate does not contain its approved predecessor'); }
  }
  return sha;
}

function approvedSource(repository) {
  // Checkout-local and config.worktree URL rewrites must not affect authority.
  // No inherited Git environment enters either discovery or URL resolution.
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'runtime-git-authority-'));
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) fail('Unsafe remote Git authority directory');
    const options = { ...gitOptions, cwd: directory };
    let outsideRepository = false;
    try { execFileSync('/usr/bin/git', [...gitControls, 'rev-parse', '--git-dir'], options); }
    catch (error) { if (error.status === 128) outsideRepository = true; }
    if (!outsideRepository) fail('Remote Git authority must be outside every repository');
    const result = execFileSync('/usr/bin/git', [...gitControls, '-c', 'core.sshCommand=/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes', 'ls-remote', '--exit-code', repository.url, repository.ref], options).trim();
    const match = /^([a-f0-9]{40})\t([^\n]+)$/.exec(result);
    if (!match || match[2] !== repository.ref) fail('Fixed remote release ref unavailable');
    return match[1];
  } catch {
    fail('Fixed remote release ref unavailable');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function environmentFor(authority) {
  const keys = JSON.parse(regular(path.join(ROOT, 'deploy', authority.scope, 'environment.json')));
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(key)) || new Set(keys).size !== keys.length) fail('Invalid runtime environment authority');
  return keys;
}

export function preparePayload(authority, sourceSha) {
  const scope = authority.scope;
  const artifact = path.join(ROOT, `apps/${scope}/.next-${scope}/standalone`);
  const manifestPath = path.join(ROOT, `apps/${scope}/.next-${scope}/trusted-runtime-manifest.json`);
  const installer = createRuntimeInstaller(authority, environmentFor(authority));
  const digest = regular(`${manifestPath}.sha256`).toString().trim();
  const manifest = installer.readPinned(manifestPath, digest).toString();
  const parsed = JSON.parse(manifest);
  if (parsed.sourceSha !== sourceSha || parsed.scope !== scope) fail('External artifact authority does not match clean source/scope');
  assertRuntimeArtifact(artifact, scope, manifestPath);
  const control = new Map();
  const authorityFile = name => {
    installer.safeRelative(name);
    control.set(name, { path: name, data: regular(path.join(ROOT, name)).toString('base64'), mode: 0o600 });
  };
  for (const name of ['scripts/runtime-artifact-policy.mjs', 'package-lock.json', `deploy/${scope}/ecosystem.config.cjs`, `deploy/${scope}/start.cjs`]) authorityFile(name);
  const files = parsed.files.map(entry => {
    installer.safeRelative(entry.path);
    const filename = path.join(entry.required ? artifact : ROOT, entry.path);
    const bytes = regular(filename);
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256 || (fs.lstatSync(filename).mode & 0o777) !== entry.mode) fail('Artifact bytes changed after external authority generation');
    if (path.basename(entry.path) === 'package.json' && entry.path !== `apps/${scope}/.next-${scope}/package.json`) authorityFile(entry.path);
    return { path: entry.path, data: bytes.toString('base64'), mode: entry.mode };
  });
  installer.readPinned(manifestPath, digest);
  return { scope, sourceSha, manifest, manifestDigest: digest, control: [...control.values()], files };
}

export function buildAbbottDeployCapsule(worker,browserSource,browserContract,authority,environmentKeys){
  if(!isDeepStrictEqual(authority,RUNTIME_MANIFESTS.abbott)||!Buffer.isBuffer(worker)||worker.length>262144||!Buffer.isBuffer(browserSource)||browserSource.length>262144)fail('Invalid Abbott capsule');
  const source=Buffer.from(`${worker}\nconst abbottBrowser={...await import(${JSON.stringify('data:text/javascript;base64,'+browserSource.toString('base64'))}),contract:${JSON.stringify(browserContract)}};\nexport async function run(signal,request){return createRuntimeInstaller(${JSON.stringify(authority)},${JSON.stringify(environmentKeys)},abbottBrowser).transactAcknowledged(request,signal);}`);
  if(source.length>1048576){source.fill(0);fail('Invalid Abbott capsule');}return source;
}

function prepareTransport(authority) {
  // Capture the reviewed worker and profile once, then recheck the clean source
  // before dispatch. Later filesystem edits cannot replace the transported code.
  const worker = regular(path.join(ROOT, 'scripts/runtime-release-remote.mjs')).toString();
  const browserSource=authority.scope==='abbott'?regular(path.join(ROOT,'scripts/abbott-browser-prerequisite.mjs')):null;
  const browserContract=browserSource?deriveBrowserContract():null;
  const environmentKeys = environmentFor(authority);
  return async function transfer(request) {
  const input = Buffer.from(JSON.stringify(request));
  if (input.length > 536870912) fail('Runtime payload too large');
  const browserSetup=browserSource?`const abbottBrowser={...await import(${JSON.stringify('data:text/javascript;base64,'+browserSource.toString('base64'))}),contract:${JSON.stringify(browserContract)}};`:'const abbottBrowser=null;';
  if(authority.scope==='abbott'){
    const source=buildAbbottDeployCapsule(Buffer.from(worker),browserSource,browserContract,authority,environmentKeys);
    const abort=new AbortController(),stop=()=>abort.abort();for(const s of['SIGINT','SIGTERM','SIGHUP'])process.on(s,stop);
    try{const result=await runAbbottDeployWithEvidence(source,input,{signal:abort.signal});if(result.status!=='COMMITTED'){abbottFailure=result;fail('Runtime remote transaction refused');}return result.record;}
    finally{source.fill(0);input.fill(0);for(const s of['SIGINT','SIGTERM','SIGHUP'])process.removeListener(s,stop);}
  }
  const code = `${worker}\n${browserSetup}\nawait createRuntimeInstaller(${JSON.stringify(authority)}, ${JSON.stringify(environmentKeys)},abbottBrowser).remoteMain(${JSON.stringify(hash(input))});`;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(code)}`;
  const result = spawnSync('/usr/bin/ssh', ['-C', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '--', 'beget', command], { input, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', maxBuffer: 1048576, timeout: 300000 });
  if (result.status !== 0 || result.signal || result.error || result.stderr) fail('Runtime remote transaction refused');
  return JSON.parse(result.stdout);
  };
}

function build(authority) {
  if (process.getuid() === 0 || process.geteuid() === 0) fail('Runtime builds require an unprivileged account');
  const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: os.homedir(), CI: '1', NEXT_TELEMETRY_DISABLED: '1' };
  const npm = path.join(path.dirname(process.execPath), 'npm');
  for (const args of [['ci'], ['run', `test:${authority.scope}-runtime`], ['run', 'verify:artifact', '--workspace', `dashboard-${authority.scope}`]]) execFileSync(npm, args, { cwd: ROOT, env: environment, stdio: ['ignore', 'ignore', 'pipe'], timeout: 600000 });
}

async function main() {
  const { authority, action } = validateInvocation(process.argv.slice(2), process.env);
  if (process.getuid() === 0 || process.geteuid() === 0) fail('Local runtime authority requires an unprivileged account');
  const repository = repositoryFor(authority);
  if (git('status', '--porcelain', '--untracked-files=normal')) fail('Runtime source must be clean');
  const approved = approvedSource(repository);
  const candidate = verifySource(authority, repository, undefined, approved);
  const transfer = prepareTransport(authority);
  verifySource(authority, repository, undefined, approved);
  const active = await transfer({ action: 'inspect' });
  verifySource(authority, repository, active?.sourceSha, approved);
  if (action === 'rollback') {
    // Only the sealed active record chooses its predecessor; callers cannot.
    if (approvedSource(repository) !== candidate) fail('Runtime release authority changed before rollback');
    verifySource(authority, repository, active?.sourceSha, candidate);
    validateAuthority(process.argv[2]);
    const result = await transfer({ action, expectedActiveSha: active?.sourceSha ?? null });
    if (result.scope !== authority.scope || !SOURCE.test(result.sourceSha)) fail('Runtime rollback attestation mismatch');
    console.log(authority.scope==='abbott'?'ABBOTT_DEPLOY_COMMITTED stage=complete reason=none':`Runtime rollback attested: ${result.sourceSha}`);
    return;
  }
  build(authority);
  const artifact = path.join(ROOT, `apps/${authority.scope}/.next-${authority.scope}/standalone`);
  const manifest = path.join(ROOT, `apps/${authority.scope}/.next-${authority.scope}/trusted-runtime-manifest.json`);
  await verifyRuntimeArtifactBoot(artifact, authority.scope, { trustedManifestPath: manifest });
  const payload = preparePayload(authority, candidate);
  const latest = await transfer({ action: 'inspect' });
  if (approvedSource(repository) !== candidate || verifySource(authority, repository, latest?.sourceSha, candidate) !== candidate) fail('Runtime release authority changed during build');
  validateAuthority(process.argv[2]);
  const result = await transfer({ action, expectedActiveSha: latest?.sourceSha ?? null, payload, binding: { sourceSha: candidate, runId: randomUUID() } });
  if (result.scope !== authority.scope || result.sourceSha !== candidate || result.manifestDigest !== payload.manifestDigest) fail('Runtime activation attestation mismatch');
  console.log(authority.scope==='abbott'?'ABBOTT_DEPLOY_COMMITTED stage=complete reason=none':`Runtime release attested: ${candidate}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write(path.resolve(process.argv[2]??'')===path.join(ROOT,'deploy/abbott/release.json')?formatAbbottDeployResult(abbottFailure??{status:'REFUSED'}):'Refusing fixed runtime operation\n'); process.exitCode = 1; });
}
