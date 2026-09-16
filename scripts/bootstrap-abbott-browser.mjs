import fs from 'node:fs';import path from 'node:path';import{execFileSync}from'node:child_process';import{pathToFileURL}from'node:url';
import{deriveBrowserContract}from'./abbott-browser-prerequisite.mjs';
import{captureBoundedChild}from'./abbott-bounded-child.mjs';
const ROOT='/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation';
const fail=()=>{throw Error('ABBOTT_BROWSER_REFUSED');};
export function validateBrowserBootstrapInvocation(args,env){
  if(args.length||Object.keys(env).some(k=>/^(?:GIT_|NODE_|PUPPETEER_|BROWSER_|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$)/.test(k)))fail();
}

export function buildBrowserBootstrapCapsule(sources,contract){
  const url=source=>'data:text/javascript;base64,'+source.toString('base64');
  if(Object.keys(sources).sort().join(',')!=='bounded,browser,proof,worker'||Object.values(sources).some(x=>!Buffer.isBuffer(x)||x.length>262144))fail();
  const authority={scope:'abbott',releaseBranch:'release/abbott',appName:'dashboard-abbott',port:3004,appDir:'/var/www/dashboard-abbott',lockDir:'/var/www/.dashboard-abbott-deploy.lock',assetPrefix:'/_next-abbott'};
  const envKeys=JSON.parse(fs.readFileSync(new URL('../deploy/abbott/environment.json',import.meta.url)));
  const code=`import fs from 'node:fs';import {createRequire}from'node:module';import{execFileSync}from'node:child_process';
const abort=new AbortController(),stop=()=>abort.abort();for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,stop);const timer=setTimeout(stop,180000);
try{
if(process.argv.length!==1||Object.keys(process.env).some(k=>k!=='UV_USE_IO_URING'||process.env[k]!=='0')||process.getuid()!==0)throw Error();
const proof=await import(${JSON.stringify(url(sources.proof))});proof.verifyAbbottBootstrapSource();
const worker=await import(${JSON.stringify(url(sources.worker))});const installer=worker.createRuntimeInstaller(${JSON.stringify(authority)},${JSON.stringify(envKeys)});
const active=installer.inspectActiveRuntime();if(active?.id!=='1fdaecbdad47430a9d1375566abad001'||active.sourceSha!=='dfd6267a742d1c7d88ccac636b89661df9b96f9f'||active.manifestDigest!=='586533387dca0928c75d6e9807503e918d316507b6f1ec128e087e075211690e')throw Error();
const browser=await import(${JSON.stringify(url(sources.browser))});const {captureBoundedChild}=await import(${JSON.stringify(url(sources.bounded))});
const requirePackage=createRequire('/var/www/dashboard-abbott/package.json'),contract=browser.deriveBrowserContract(requirePackage);if(JSON.stringify(contract)!==JSON.stringify(${JSON.stringify(contract)}))throw Error();
const user=fs.readFileSync('/etc/passwd','utf8').split('\\n').filter(x=>x.startsWith('dashboard-abbott:'));if(user.length!==1)throw Error();const fields=user[0].split(':');if(fields[2]!=='982'||fields[3]!=='984'||fields[5]!=='/nonexistent'||fields[6]!=='/usr/sbin/nologin')throw Error();
const group=fs.readFileSync('/etc/group','utf8').split('\\n').filter(x=>x.startsWith('dashboard-abbott:'));if(group.length!==1||group[0].split(':')[2]!=='984')throw Error();
for(const p of ['/var','/var/lib']){const s=fs.lstatSync(p);if(!s.isDirectory()||s.uid!==0||s.mode&0o022||fs.realpathSync(p)!==p)throw Error();}
proof.verifyAbbottBootstrapSource();if(abort.signal.aborted)throw Error();
const parent='/var/lib/dashboard-abbott';if(!fs.lstatSync(parent,{throwIfNoEntry:false})){fs.mkdirSync(parent,{mode:0o750});fs.chmodSync(parent,0o750);fs.chownSync(parent,0,984);}const ps=fs.lstatSync(parent);if(!ps.isDirectory()||ps.uid!==0||ps.gid!==984||(ps.mode&0o7777)!==0o750||fs.realpathSync(parent)!==parent)throw Error();
const checkExecutable=executable=>{try{const script="const fs=require('node:fs'),{spawnSync}=require('node:child_process');process.setgroups([]);process.setgid(984);process.setuid(982);fs.accessSync("+JSON.stringify(executable)+",fs.constants.R_OK|fs.constants.X_OK);fs.accessSync('/tmp',fs.constants.W_OK|fs.constants.X_OK);const r=spawnSync('/usr/bin/ldd',["+JSON.stringify(executable)+"],{cwd:'/',env:{},encoding:'utf8',timeout:5000,maxBuffer:32768,stdio:['ignore','pipe','pipe']});if(r.status!==0||r.stderr||/not found/.test(r.stdout))process.exit(1);";execFileSync('/usr/bin/node',['-e',script],{cwd:'/',env:{},timeout:10000,maxBuffer:1024,stdio:['ignore','pipe','pipe']});return true;}catch{return false;}};
const unpack=async(stage,bytes,c)=>{
const childCode="import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import {createRequire,syncBuiltinESMExports}from'node:module';for(const p of [http,https])for(const name of ['get','request'])p[name]=()=>{throw Error();};syncBuiltinESMExports();const m=await import("+JSON.stringify(${JSON.stringify(url(sources.browser))})+");const b=fs.readFileSync(0);try{await m.unpackWithInstalledApi("+JSON.stringify(stage)+",b,"+JSON.stringify(c)+",createRequire('/var/www/dashboard-abbott/package.json'));}finally{b.fill(0);}";
const result=await captureBoundedChild('/usr/bin/node',['--max-old-space-size=384','--input-type=module','-e',childCode],{input:bytes,signal:abort.signal,cwd:'/',timeout:60000,maxBytes:1024});try{if(result.status!==0||result.signal||result.stdout.length||result.stderr.length)throw Error();}finally{result.stdout.fill(0);result.stderr.fill(0);}
};
const result=await browser.installBrowserPrerequisite({contract,signal:abort.signal,download:c=>browser.downloadOfficialArchive(c,{signal:abort.signal}),validateArchive:b=>browser.validateZip(b,requirePackage),unpack,checkExecutable});
if(abort.signal.aborted)throw Error();proof.verifyAbbottBootstrapSource();process.stdout.write('ABBOTT_BROWSER_'+(result.status==='created'?'CREATED':'UNCHANGED')+'\\n');
}catch{process.stderr.write('ABBOTT_BROWSER_REFUSED\\n');process.exitCode=1;}finally{clearTimeout(timer);for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,stop);}
`;
  if(Buffer.byteLength(code)>1048576)fail();return Buffer.from(code);
}

async function main(){
  validateBrowserBootstrapInvocation(process.argv.slice(2),process.env);
  if(process.getuid()===0||fs.realpathSync(process.cwd())!==ROOT||fs.realpathSync(path.resolve(import.meta.dirname,'..'))!==ROOT)fail();
  const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:ROOT,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null'},stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:262144});
  const marker=path.join(ROOT,'.git'),stat=fs.lstatSync(marker);if(!stat.isFile()||stat.nlink!==1||fs.realpathSync(marker)!==marker)fail();
  const match=/^gitdir: ([^\r\n]+)\n?$/.exec(fs.readFileSync(marker,'utf8'));if(!match)fail();const gitDir=path.resolve(ROOT,match[1]);
  if(fs.realpathSync(gitDir)!==gitDir||fs.readFileSync(path.join(gitDir,'gitdir'),'utf8').trim()!==marker||git('rev-parse','--absolute-git-dir').toString().trim()!==gitDir||git('rev-parse','--show-toplevel').toString().trim()!==ROOT)fail();
  if(git('status','--porcelain').length)fail();
  const names={browser:'abbott-browser-prerequisite.mjs',proof:'bootstrap-abbott-host.mjs',worker:'runtime-release-remote.mjs',bounded:'abbott-bounded-child.mjs'};
  const sources=Object.fromEntries(Object.entries(names).map(([key,file])=>[key,git('show','HEAD:scripts/'+file)]));
  const input=buildBrowserBootstrapCapsule(sources,deriveBrowserContract()),abort=new AbortController(),stop=()=>abort.abort();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  try{
    const r=await captureBoundedChild('/usr/bin/ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10','--','beget','/usr/bin/env -i /usr/bin/node --input-type=module'],{input,signal:abort.signal,timeout:210000,graceMs:15000,maxBytes:1024});
    try{if(r.status!==0||r.signal||r.stderr.length||!/^ABBOTT_BROWSER_(CREATED|UNCHANGED)\n$/.test(r.stdout.toString()))fail();process.stdout.write(r.stdout);}finally{r.stdout.fill(0);r.stderr.fill(0);}
  }finally{input.fill(0);for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main().catch(()=>{process.stderr.write('ABBOTT_BROWSER_REFUSED\n');process.exitCode=1;});
