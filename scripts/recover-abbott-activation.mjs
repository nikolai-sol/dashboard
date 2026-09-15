import fs from'node:fs';import path from'node:path';import{execFileSync}from'node:child_process';import{pathToFileURL}from'node:url';
import{runRecoveryTransport}from'./abbott-recovery-transport.mjs';
import{formatRecoveryDiagnostic,safeRecoveryDiagnostic}from'./abbott-recovery-diagnostics.mjs';
import{createRecoveryEvidence}from'./abbott-recovery-evidence.mjs';
const ROOT='/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation';
const fail=()=>{throw Error('ABBOTT_RECOVERY_REFUSED');};
export async function runWithRecoveryEvidence(input,{signal,transport=runRecoveryTransport,evidence}={}){
  let result={status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:{stage:'unknown',reason:'unknown'}},summary;
  try{
    if(!evidence){try{evidence=createRecoveryEvidence();}catch{return{status:'ABBOTT_RECOVERY_REFUSED',diagnostic:{stage:'local_evidence',reason:'failed'}};}}
    const raw=await transport(input,{signal,onEvidence:row=>evidence.record(row)});
    result={status:['ABBOTT_RECOVERY_RESTORED','ABBOTT_RECOVERY_REFUSED','ABBOTT_RECOVERY_REVIEW_REQUIRED','ABBOTT_RECOVERY_UNACKNOWLEDGED'].includes(raw.status)?raw.status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:safeRecoveryDiagnostic(raw.diagnostic)};
    summary=evidence.finish();evidence=null;
    if(summary.exitVerified!==raw.sshExitVerified||raw.status==='ABBOTT_RECOVERY_RESTORED'&&(!raw.remoteAcknowledged||!summary.identityCaptured||!summary.exitObserved||!summary.exitVerified))result={status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:{stage:'local_evidence',reason:'failed'}};
  }catch{result={status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:{stage:'local_evidence',reason:'failed'}};}
  finally{if(evidence)try{summary=evidence.finish();}catch{result={status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:{stage:'local_evidence',reason:'failed'}};}}
  return result;
}
export function validateRecoveryInvocation(args,env){
  // macOS inserts this non-authority key even after env -i. Nothing else may
  // enter the local invocation; SSH receives its own fixed minimal environment.
  if(args.length||Object.keys(env).some(k=>k!=='__CF_USER_TEXT_ENCODING'))fail();
}
export function buildRecoveryCapsule(sources,keys){
  if(Object.keys(sources).sort().join(',')!=='proof,recovery,worker'||Object.values(sources).some(b=>!Buffer.isBuffer(b)||b.length>262144))fail();
  const url=b=>'data:text/javascript;base64,'+b.toString('base64');let recovery=sources.recovery.toString();
  for(const[name,file]of[['worker','runtime-release-remote.mjs'],['proof','bootstrap-abbott-host.mjs']]){
    const needle=`'./${file}'`;if(recovery.split(needle).length!==2)fail();recovery=recovery.replace(needle,JSON.stringify(url(sources[name])));
  }
  const code=`export async function run(signal){if(process.getuid()!==0||process.argv.length!==1||Object.keys(process.env).some(k=>k!=='UV_USE_IO_URING'||process.env[k]!=='0'))throw Error('ABBOTT_RECOVERY_REFUSED');const m=await import(${JSON.stringify(url(Buffer.from(recovery)))});return m.runRecoverySteps(m.createRecoveryAdapter(${JSON.stringify(keys)},signal));}`;
  if(Buffer.byteLength(code)>1048576)fail();return Buffer.from(code);
}
export function verifyRecoveryLocalAuthority(expectedArgs=[]){
  if(expectedArgs.length&&!(expectedArgs.length===1&&['ssh','node','loader'].includes(expectedArgs[0])))fail();
  if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(expectedArgs))fail();
  validateRecoveryInvocation([],process.env);
  if(process.getuid()===0||fs.realpathSync(process.cwd())!==ROOT||fs.realpathSync(path.resolve(import.meta.dirname,'..'))!==ROOT)fail();
  if(process.execPath!=='/opt/homebrew/Cellar/node/25.6.1_1/bin/node')fail();
  for(const[p,privateKey]of[['/Users/nafanya/.ssh/beget_ed25519',true],['/Users/nafanya/.ssh/known_hosts',false]]){
    const s=fs.lstatSync(p);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||fs.realpathSync(p)!==p||(privateKey?![0o400,0o600].includes(s.mode&0o7777):Boolean(s.mode&0o022)))fail();
  }
  const git=(...args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:ROOT,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null'},stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:262144});
  const marker=path.join(ROOT,'.git'),s=fs.lstatSync(marker);if(!s.isFile()||s.nlink!==1||fs.realpathSync(marker)!==marker)fail();
  const match=/^gitdir: ([^\r\n]+)\n?$/.exec(fs.readFileSync(marker,'utf8'));if(!match)fail();const gitDir=path.resolve(ROOT,match[1]);
  if(gitDir!=='/Users/nafanya/ReportingDash/dashboard-next/.git/worktrees/abbott-runtime-isolation'||fs.realpathSync(gitDir)!==gitDir||fs.readFileSync(path.join(gitDir,'gitdir'),'utf8').trim()!==marker||git('rev-parse','--absolute-git-dir').toString().trim()!==gitDir||git('rev-parse','--show-toplevel').toString().trim()!==ROOT||git('status','--porcelain').length)fail();
  git('merge-base','--is-ancestor','9aaed34feeb9b73b4d177dccab5a2b750776b4c3','HEAD');
  return git;
}
async function main(){
  const git=verifyRecoveryLocalAuthority();
  const names={worker:'runtime-release-remote.mjs',proof:'bootstrap-abbott-host.mjs',recovery:'abbott-interrupted-recovery.mjs'};
  const sources=Object.fromEntries(Object.entries(names).map(([key,file])=>[key,git('show','HEAD:scripts/'+file)]));
  const input=buildRecoveryCapsule(sources,JSON.parse(git('show','HEAD:deploy/abbott/environment.json'))),abort=new AbortController(),stop=()=>abort.abort();
  for(const s of['SIGINT','SIGTERM'])process.on(s,stop);
  try{
    const result=await runWithRecoveryEvidence(input,{signal:abort.signal});
    const success=result.status==='ABBOTT_RECOVERY_RESTORED';
    (success?process.stdout:process.stderr).write(formatRecoveryDiagnostic(result));if(!success)process.exitCode=1;
  }finally{input.fill(0);for(const s of['SIGINT','SIGTERM'])process.removeListener(s,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main().catch(()=>{process.stderr.write(formatRecoveryDiagnostic({status:'ABBOTT_RECOVERY_REFUSED'}));process.exitCode=1;});
