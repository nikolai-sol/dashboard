import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUTHORITY = path.join(ROOT, 'deploy/zaruku/linux-fixture.json');
const DOCKERFILE = path.join(ROOT, 'deploy/zaruku/linux-fixture.Dockerfile');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Refusing Zaruku Linux fixture authority'); };
const EXECUTABLES = ['/usr/bin/python3', '/usr/bin/setpriv', '/usr/bin/timeout', '/usr/sbin/useradd', '/usr/sbin/groupadd'];

export function validateFixtureAuthority(authority, unlocked = false) {
  if (!authority || Object.keys(authority).sort().join(',') !== 'base,dockerfileSha256,imageId,packageManifestSha256,packages,platform,requiredExecutables,snapshot' || JSON.stringify(authority.requiredExecutables)!==JSON.stringify(EXECUTABLES) || !/^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/.test(authority.base) || authority.platform !== 'linux/amd64' || !/^\d{8}T\d{6}Z$/.test(authority.snapshot) || Object.keys(authority.packages ?? {}).sort().join(',') !== 'passwd,python3,util-linux' || Object.values(authority.packages).some(value => typeof value !== 'string' || !/^[0-9][a-zA-Z0-9.:+~_-]*$/.test(value)) || !/^[a-f0-9]{64}$/.test(authority.dockerfileSha256)) fail();
  if (!(unlocked && authority.imageId === null && authority.packageManifestSha256 === null) && (!/^sha256:[a-f0-9]{64}$/.test(authority.imageId) || !/^[a-f0-9]{64}$/.test(authority.packageManifestSha256))) fail();
  return authority;
}

export async function verifyFixtureImage(adapter, authority) {
  validateFixtureAuthority(authority);
  const observed = await adapter.inspect(authority);
  for (const field of ['imageId', 'dockerfileSha256', 'packageManifestSha256','platform']) if (observed[field] !== authority[field]) fail();
  if (JSON.stringify(observed.executables) !== JSON.stringify(EXECUTABLES)) fail();
  return { passed: true, imageId: authority.imageId, packageManifestSha256: authority.packageManifestSha256 };
}

export function validatePrivateFixtureRoot(metadata, mountInfo) {
  const mounts = mountInfo.split('\n').map(line => line.split(' ')).filter(fields => fields[4] === '/root');
  const mount = mounts[0], options = mount?.[5]?.split(',') ?? [];
  if (!metadata.directory || metadata.uid !== 0 || metadata.gid !== 0 || metadata.mode !== 0o700 ||
      mounts.length !== 1 || mount[mount.indexOf('-') + 1] !== 'tmpfs' ||
      !['rw', 'nosuid', 'nodev', 'noexec'].every(option => options.includes(option))) {
    throw new Error('Refusing Zaruku Linux fixture root');
  }
}

export function fixtureRunArguments(authority, checkout) {
  validateFixtureAuthority(authority);
  if (!path.isAbsolute(checkout) || /[,\n\r\0]/.test(checkout) || checkout === '/var/www' || checkout.startsWith('/var/www/')) fail();
  const code = `const fs=require('node:fs'),cp=require('node:child_process');
const privateRoot=fs.lstatSync('/root');
(${validatePrivateFixtureRoot.toString()})({directory:privateRoot.isDirectory(),uid:privateRoot.uid,gid:privateRoot.gid,mode:privateRoot.mode&0o7777},fs.readFileSync('/proc/self/mountinfo','utf8'));
fs.cpSync('/opt/fixture-system/etc','/etc',{recursive:true,preserveTimestamps:true,filter:src=>!['/opt/fixture-system/etc/hosts','/opt/fixture-system/etc/hostname','/opt/fixture-system/etc/resolv.conf'].includes(src)});
fs.cpSync('/opt/fixture-system/usr-bin','/usr/bin',{recursive:true,preserveTimestamps:true});
for(const [bin,args,label] of [['/usr/bin/python3',['-I','-B','/src/scripts/stamp-runtime-artifact.test.py'],'linux-build-helper-fixture'],['/usr/local/bin/node',['/src/scripts/boot-zaruku-service.linux.test.mjs'],'linux-privilege-drop-fixture'],['/usr/bin/python3',['-I','-B','/src/scripts/zaruku-shadow-mysql.linux.test.py'],'linux-mysql-descriptor-fixture'],['/usr/local/bin/node',['/src/scripts/zaruku-shadow-evidence.linux.test.mjs'],'linux-evidence-writer-fixture']]){
 const r=cp.spawnSync(bin,args,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin',LC_ALL:'C'},timeout:225000});
 if(r.status!==0||r.error||r.signal){process.stderr.write(label+' failed\\n');process.exit(1)}process.stdout.write(label+' passed\\n');}
`;
  return ['run', '--rm', '--pull', 'never', '--platform', authority.platform, '--network', 'none', '--read-only', '--cap-add', 'SYS_PTRACE',
    '--mount', `type=bind,src=${checkout},dst=/src,readonly`,
    '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=268435456',
    '--tmpfs', '/root:rw,nosuid,nodev,noexec,mode=0700,size=1048576',
    '--tmpfs', '/etc:rw,nosuid,nodev,mode=0755,size=33554432',
    '--tmpfs', '/usr/bin:rw,nosuid,nodev,exec,mode=0755,size=268435456',
    '--tmpfs', '/var/log:rw,nosuid,nodev,mode=0755,size=8388608',
    '--tmpfs', '/var/www:rw,nosuid,nodev,mode=0755,size=33554432',
    '--entrypoint', '/usr/local/bin/node', authority.imageId, '-e', code];
}

function command(bin, args, options = {}) {
  const commandArgs = bin === 'docker' ? ['--config', '/var/empty', ...args] : args;
  const result = spawnSync(bin, commandArgs, { cwd: ROOT, encoding: 'utf8', stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 8388608, ...options });
  if (result.status !== 0 || result.error || result.signal) fail();
  return result.stdout.trim();
}

function sourceInputs(unlocked = false) {
  for (const filename of [AUTHORITY, DOCKERFILE]) {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.nlink !== 1 || fs.realpathSync(filename) !== filename) fail();
  }
  const authority = validateFixtureAuthority(JSON.parse(fs.readFileSync(AUTHORITY)), unlocked), dockerfile = fs.readFileSync(DOCKERFILE);
  if (hash(dockerfile) !== authority.dockerfileSha256) fail();
  const text = dockerfile.toString('utf8');
  if (!text.startsWith(`FROM ${authority.base}\n`) || !text.includes(`https://snapshot.debian.org/archive/debian/${authority.snapshot} bookworm main`) || !text.includes('--no-install-recommends') || /\b(?:COPY|ADD|ARG)\b|apt-get upgrade|deb\.debian\.org|security\.debian\.org/.test(text)) fail();
  for (const [name, version] of Object.entries(authority.packages)) if (!text.includes(`${name}=${version}`)) fail();
  if (command('/usr/bin/git', ['status', '--porcelain', '--untracked-files=all', '--', 'deploy/zaruku/linux-fixture.json', 'deploy/zaruku/linux-fixture.Dockerfile'])) fail();
  return authority;
}

function inspect(imageId, dockerfileSha256) {
  const identity = JSON.parse(command('docker', ['image', 'inspect', imageId, '--format', '{{json .}}']));
  if (identity.Id !== imageId || identity.Os !== 'linux' || identity.Architecture !== 'amd64') fail();
  const format = '-f=${binary:Package}\t${Version}\n';
  const code = `const c=require('node:child_process'),fs=require('node:fs'),crypto=require('node:crypto');const paths=${JSON.stringify(EXECUTABLES)};for(const p of paths)fs.accessSync(p,fs.constants.X_OK);const data=c.execFileSync('/usr/bin/dpkg-query',['-W',${JSON.stringify(format)}],{env:{LC_ALL:'C'}}).toString().trim().split('\\n').sort().join('\\n')+'\\n';process.stdout.write(JSON.stringify({packageManifestSha256:crypto.createHash('sha256').update(data).digest('hex'),executables:paths}));`;
  const value = JSON.parse(command('docker', ['run', '--rm', '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none', '--read-only', '--entrypoint', '/usr/local/bin/node', imageId, '-e', code]));
  return { ...value, imageId: identity.Id, dockerfileSha256,platform:`${identity.Os}/${identity.Architecture}` };
}

async function main(args) {
  if (Object.keys(process.env).some(key => key !== 'GIT_PAGER' && (/^(?:DOCKER_|BUILDX_|ZARUKU_|GIT_)/.test(key) || ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV'].includes(key)))) fail();
  const mode = args.join(' ');
  if (!['build', 'build --lock', 'run'].includes(mode)) fail();
  const authority = sourceInputs(mode === 'build --lock');
  if (mode === 'build --lock') {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-fixture-build-'));
    try {
      const result = command('docker', ['build', '--platform', authority.platform, '--pull', '--no-cache', '--network', 'default', '--iidfile', path.join(temporary, 'image-id'), '-'], { input: fs.readFileSync(DOCKERFILE), timeout: 1200000 });
      if (result.includes('SECRET_SENTINEL')) fail();
      const imageId = fs.readFileSync(path.join(temporary, 'image-id'), 'utf8').trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail();
      const observed = inspect(imageId, authority.dockerfileSha256);
      if (authority.packageManifestSha256 !== null && authority.packageManifestSha256 !== observed.packageManifestSha256) fail();
      const locked = { ...authority, packageManifestSha256: observed.packageManifestSha256, imageId };
      validateFixtureAuthority(locked);
      // This is the one explicit lock-file mutation; normal verification cannot write.
      fs.writeFileSync(AUTHORITY, JSON.stringify(locked, null, 2) + '\n');
      process.stdout.write('Zaruku Linux fixture image locked\n');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    return;
  }
  await verifyFixtureImage({ inspect: a => inspect(a.imageId, hash(fs.readFileSync(DOCKERFILE))) }, authority);
  if (mode === 'run') process.stdout.write(command('docker', fixtureRunArguments(authority, ROOT)) + '\n');
  else process.stdout.write('Zaruku Linux fixture image verified\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write('Refusing Zaruku Linux fixture authority\n'); process.exitCode = 1; });
}
