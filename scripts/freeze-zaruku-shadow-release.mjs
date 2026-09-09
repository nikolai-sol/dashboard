import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { reviewedSource, rejectShadowOverrides } from './stage-zaruku-shadow-control.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REF = 'refs/heads/release/zaruku';
const BASE = 'ee950f3917d0f8616b6229d4049410a0afb7e380';
export const REPOSITORY_AUTHORITY = Object.freeze({version:2,url:'git@github.com:nikolai-sol/dashboard.git',ref:REF,base:BASE,approvedPredecessor:'00e5b33a22d567f6f17a6966a2a1f8d6a8b849da'});
const fail = () => { throw new Error('Zaruku exact release authority refused'); };

function validSource(source, expected) {
  if (!source || source.clean !== true || typeof source.branch !== 'string' || !source.branch || !/^[a-f0-9]{40}$/.test(source.sha) || expected && source.sha !== expected) fail();
  return source;
}

async function inspect(adapter) {
  const value = await adapter.command(['ls-remote', '--exit-code', '--refs', '--', adapter.destination ?? REPOSITORY_AUTHORITY.url, REF]);
  if (value.error || value.signal || value.stderr) fail();
  if (value.status === 2 && value.stdout === '') return null;
  const match = /^([a-f0-9]{40})\trefs\/heads\/release\/zaruku\n?$/.exec(value.stdout);
  if (value.status !== 0 || !match) fail();
  return match[1];
}

export async function requireExactShadowRelease(adapter, sourceSha) {
  const before = validSource(await adapter.source(), sourceSha);
  return withRepository(adapter,before,async isolated=>{
    if (await inspect(isolated) !== sourceSha || !isDeepStrictEqual(await adapter.source(), before)) fail();
    return { passed: true, sourceSha };
  });
}

export async function freezeShadowRelease(adapter, createIfAbsent = false) {
  const before = validSource(await adapter.source());
  return withRepository(adapter,before,async isolated=>{
    await isolated.verifyBase(before.sha);
    const observed = await inspect(isolated);
    if (!isDeepStrictEqual(await adapter.source(), before)) fail();
    if (observed !== null && observed !== before.sha || observed === null && !createIfAbsent) fail();
    let created = false;
    if (observed === null) {
      const result = await isolated.command(['push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no', '--atomic', `--force-with-lease=${REF}:`, '--', isolated.destination ?? REPOSITORY_AUTHORITY.url, `${before.sha}:${REF}`]);
      if (result.status !== 0 || result.signal || result.error) fail();
      created = true;
    }
    if (await inspect(isolated) !== before.sha || !isDeepStrictEqual(await adapter.source(), before)) fail();
    return { sourceSha: before.sha, ref: REF, created };
  });
}

export async function advanceApprovedSuccessor(adapter) {
  const before = validSource(await adapter.source());
  const predecessorSha = REPOSITORY_AUTHORITY.approvedPredecessor;
  if (before.sha === predecessorSha) fail();
  return withRepository(adapter, before, async isolated => {
    await isolated.verifyBase(before.sha);
    try { await isolated.verifyAncestor(predecessorSha, before.sha); } catch { fail(); }
    if (await inspect(isolated) !== predecessorSha ||
        !isDeepStrictEqual(await adapter.source(), before)) fail();
    const result = await isolated.command([
      'push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no',
      '--atomic', `--force-with-lease=${REF}:${predecessorSha}`, '--',
      isolated.destination ?? REPOSITORY_AUTHORITY.url,
      `${before.sha}:${REF}`,
    ]);
    if (result.status !== 0 || result.signal || result.error) fail();
    if (await inspect(isolated) !== before.sha ||
        !isDeepStrictEqual(await adapter.source(), before)) fail();
    return {ref:REF, predecessorSha, successorSha:before.sha, advanced:true};
  });
}

async function withRepository(adapter,source,action) {
  const isolated=adapter.open ? await adapter.open(source) : adapter;
  try {return await action(isolated);} finally {if(adapter.open)await isolated.close();}
}

const checked=result=>{if(result.status!==0||result.signal||result.error)fail();return result;};
// OpenSSH's route must not inherit Host/Match/Include, proxies or connection
// sharing from either user or system config. Only existing default keys, the
// owner's known_hosts and a validated local agent remain authentication inputs.
const SSH_COMMAND = ['/usr/bin/ssh','-F','/dev/null',
  '-o','HostName=github.com','-o','User=git','-o','Port=22','-o','HostKeyAlias=github.com',
  '-o','CanonicalizeHostname=no','-o','ProxyCommand=none','-o','ProxyJump=none',
  '-o','PermitLocalCommand=no','-o','LocalCommand=none','-o','RemoteCommand=none',
  '-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ForwardX11Trusted=no','-o','Tunnel=no',
  '-o','ControlMaster=no','-o','ControlPath=none','-o','ControlPersist=no',
  '-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=/dev/null',
  '-o','UserKnownHostsFile=~/.ssh/known_hosts','-o','KnownHostsCommand=none','-o','VerifyHostKeyDNS=no','-o','UpdateHostKeys=no'].join(' ');

export function releaseAuthorityGitEnvironment(protocol) {
  if(!['ssh','file'].includes(protocol))fail();
  let home,agent={};
  try {
    home=os.userInfo().homedir;
    const stat=fs.lstatSync(home);
    if(!path.isAbsolute(home)||fs.realpathSync(home)!==home||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o022))fail();
    if(protocol==='ssh'&&process.env.SSH_AUTH_SOCK) {
      const socket=process.env.SSH_AUTH_SOCK,stat=fs.lstatSync(socket),parent=fs.lstatSync(path.dirname(socket));
      if(!path.isAbsolute(socket)||fs.realpathSync(socket)!==socket||!stat.isSocket()||stat.uid!==process.getuid()||!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o022))fail();
      agent={SSH_AUTH_SOCK:socket};
    }
  } catch {fail();}
  return Object.freeze({PATH:'/usr/bin:/bin',HOME:home,...agent,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null',GIT_PAGER:'/bin/cat',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:protocol,
    GIT_SSH_COMMAND:SSH_COMMAND,GIT_SSH_VARIANT:'ssh'});
}

export function assertReleaseAuthorityInvocation(args = []) {
  const invocationEnvironment = { ...process.env };
  if (Object.hasOwn(invocationEnvironment, 'SSH_AUTH_SOCK')) {
    const approved = releaseAuthorityGitEnvironment('ssh').SSH_AUTH_SOCK;
    if (approved !== invocationEnvironment.SSH_AUTH_SOCK) fail();
    delete invocationEnvironment.SSH_AUTH_SOCK;
  }
  rejectShadowOverrides(args, invocationEnvironment);
}

const gitEnvironment = releaseAuthorityGitEnvironment;
function localGit(repo,args,protocol='ssh') {
  return spawnSync('/usr/bin/git',['--no-replace-objects','-C',repo,'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{env:gitEnvironment(protocol),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1048576});
}
function assertSourceDestination(repo,destination,protocol) {
  const text=checked(localGit(repo,['config','--null','--no-includes','--list'],protocol)).stdout;
  if(!text.endsWith('\0'))fail();
  const entries=text.slice(0,-1).split('\0').map(row=>{const at=row.indexOf('\n');if(at<1)fail();return [row.slice(0,at).toLowerCase(),row.slice(at+1)];});
  if(!isDeepStrictEqual(entries.filter(([key])=>key==='remote.origin.url').map(([,value])=>value),[destination]))fail();
  if(entries.some(([key])=>key==='remote.origin.pushurl'||/^url\..*\.(?:insteadof|pushinsteadof)$/.test(key)||/^include(?:if)?\./.test(key)))fail();
}

/** Remote Git never reads this checkout's config, refs, tags, hooks or remotes. */
function isolatedAdapter(repo,destination,source,base,protocol) {
  return {source,destination,open(before) {
    assertSourceDestination(repo,destination,protocol);
    const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-git-authority-')));
    const pin=fs.lstatSync(temporary),bare=path.join(temporary,'authority.git'),pack=path.join(temporary,'candidate.pack');
    const verify=()=>{const current=fs.lstatSync(temporary);if(!current.isDirectory()||current.dev!==pin.dev||current.ino!==pin.ino||current.uid!==process.getuid()||(current.mode&0o7777)!==0o700||fs.realpathSync(temporary)!==temporary)fail();};
    const close=()=>{verify();fs.rmSync(temporary,{recursive:true});};
    const env=gitEnvironment(protocol);
    const execute=(args,options={})=>spawnSync('/usr/bin/git',['--no-replace-objects',`--git-dir=${bare}`,'-c','core.hooksPath=/dev/null','-c','push.followTags=false','-c','push.recurseSubmodules=no','-c','submodule.recurse=false',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300000,maxBuffer:1048576,...options});
    let config;
    try {
      verify();checked(spawnSync('/usr/bin/git',['init','--bare','--template=','-q',bare],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));
      config=fs.readFileSync(path.join(bare,'config'));
      const objects=checked(localGit(repo,['rev-parse','--path-format=absolute','--git-path','objects'],protocol)).stdout.trim();
      if(!path.isAbsolute(objects)||!fs.statSync(objects).isDirectory())fail();
      // Import only the candidate's reachable object closure: no refs, tags, local
      // config, alternates configuration, hooks or fetch/push actions are copied.
      let fd=fs.openSync(pack,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
      try {checked(execute(['pack-objects','--stdout','--revs'],{env:{...env,GIT_OBJECT_DIRECTORY:objects},input:before.sha+'\n',stdio:['pipe',fd,'pipe']}));}finally{fs.closeSync(fd);}
      fd=fs.openSync(pack,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try {checked(execute(['index-pack','--stdin','--strict'],{stdio:[fd,'pipe','pipe']}));}finally{fs.closeSync(fd);fs.unlinkSync(pack);}
      if(checked(execute(['rev-parse','--verify',before.sha+'^{commit}'])).stdout.trim()!==before.sha||checked(execute(['for-each-ref'])).stdout)fail();
      const command=args=>{
        verify();if(!fs.readFileSync(path.join(bare,'config')).equals(config))fail();
        assertSourceDestination(repo,destination,protocol);
        return execute(args);
      };
      return {destination,command,
        verifyBase:sha=>{checked(command(['merge-base','--is-ancestor',base,sha]));},
        verifyAncestor:(ancestor,descendant)=>{checked(command(['merge-base','--is-ancestor',ancestor,descendant]));},
        close};
    } catch {close();fail();}
  }};
}

export function createReleaseAuthorityAdapter(...args) {
  if(args.length)fail();
  const filename=path.join(ROOT,'deploy/zaruku/repository.json'),stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.nlink!==1||fs.realpathSync(filename)!==filename||!isDeepStrictEqual(JSON.parse(fs.readFileSync(filename)),REPOSITORY_AUTHORITY))fail();
  return isolatedAdapter(ROOT,REPOSITORY_AUTHORITY.url,reviewedSource,BASE,'ssh');
}

/** Tests may target only the two fixed paths in an ownership-known mktemp root. */
export function createFixtureReleaseAuthorityAdapter(directory) {
  const parent=fs.realpathSync(os.tmpdir()),root=fs.realpathSync(directory),stat=fs.lstatSync(directory);
  if(root!==directory||path.dirname(root)!==parent||!/^zaruku-freeze-[A-Za-z0-9-]+$/.test(path.basename(root))||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o7777)!==0o700)fail();
  const repo=path.join(root,'candidate'),destination=path.join(root,'authority.git');
  for(const target of [repo,destination])if(fs.realpathSync(target)!==target||!fs.lstatSync(target).isDirectory())fail();
  const source=()=>({sha:checked(localGit(repo,['rev-parse','HEAD'],'file')).stdout.trim(),branch:checked(localGit(repo,['branch','--show-current'],'file')).stdout.trim(),clean:checked(localGit(repo,['status','--porcelain','--untracked-files=normal'],'file')).stdout===''});
  return isolatedAdapter(repo,destination,source,source().sha,'file');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assertReleaseAuthorityInvocation([]);
    if (args.length !== 1 || !['check','create-if-absent','advance-approved-successor'].includes(args[0])) fail();
    const result = args[0] === 'advance-approved-successor'
      ? await advanceApprovedSuccessor(createReleaseAuthorityAdapter())
      : await freezeShadowRelease(createReleaseAuthorityAdapter(), args[0] === 'create-if-absent');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch { process.stderr.write('Zaruku exact release authority refused\n'); process.exitCode = 1; }
}
