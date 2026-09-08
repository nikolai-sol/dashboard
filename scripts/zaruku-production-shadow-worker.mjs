import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { loadShadowAuthority } from './zaruku-production-shadow-authority.mjs';
import { attestStagedControl } from './zaruku-shadow-dispatch.mjs';
import { createReadOnlyPreflightAdapter, inspectShadowPrerequisites, assertShadowPrerequisites } from './zaruku-production-shadow-preflight.mjs';
import { createHostAdapter, inspectHostBoundary } from './zaruku-shadow-host.mjs';
import { validateAuthDescriptor } from './install-zaruku-shadow-auth.mjs';
import { readZarukuSecrets, inspectActiveRuntime, transact } from './runtime-release-remote.mjs';
import { verifyReaderBoundary } from './zaruku-shadow-db.mjs';
import { observeCanonicalCoverage } from './zaruku-shadow-coverage.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const AUTHORITY=loadShadowAuthority(path.join(ROOT,'deploy/zaruku/production-shadow.json'));
const ACTIONS=Object.freeze(['preflight','hostBoundary','dbBoundary','runtimeSecrets','managerAuth','allocateEvidence','attest','parity','recheck','cleanup','stop','writeDecision']);
const STEP_NAMES=['preflight-read-only','linux-build-helper-fixture','linux-privilege-drop-fixture','host-boundary-check','db-boundary-check','runtime-secret-check','manager-auth-descriptor-check','full-predeploy','release-authority-check','deploy-zaruku','process-and-listener-attestation','same-snapshot-parity','foreign-sha-and-nginx-recheck','write-final-decision'];
const FAILURES=['runtime baseline','foreign runtime authority','combined runtime authority','read-only preflight','Linux build-helper fixture','Linux privilege fixture','host boundary','DB boundary','DB table boundary','runtime secret check','manager auth descriptor check','full predeploy','release authority','reviewed source changed','deploy Zaruku','deployed source authority','process and listener attestation','same-snapshot parity','bounded parity comparison','prerequisite operation','foreign runtime or Nginx changed','foreign SHA and Nginx recheck','cleanup failed','Zaruku stop failed'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const refuse=(label='worker check')=>{throw new Error(`Zaruku shadow ${label} failed`);};
const same=(a,b)=>isDeepStrictEqual(a,b);
const snapshot=stat=>({dev:String(stat.dev),ino:String(stat.ino),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,nlink:stat.nlink,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs});

function safeAncestors(filename,io=fs) {
  for(let dir=path.dirname(filename);;dir=path.dirname(dir)){
    const stat=io.lstatSync(dir);
    if(!stat.isDirectory()||stat.uid!==0||stat.gid!==0||stat.mode&0o022)refuse();
    if(dir==='/')break;
  }
}

function readProtected(filename,mode,max=65536,io=fs) {
  safeAncestors(filename,io);
  const fd=io.openSync(filename,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);
  try {
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.uid!==0||before.gid!==0||before.mode&0o022||mode!==undefined&&(before.mode&0o777)!==mode||before.size>max)refuse();
    const bytes=io.readFileSync(fd),after=io.fstatSync(fd);
    if(!same(snapshot(before),snapshot(after))||!same(snapshot(after),snapshot(io.lstatSync(filename))))refuse();
    return {bytes,identity:snapshot(after),sha256:hash(bytes)};
  } finally {io.closeSync(fd);}
}

export function attestMysqlBinary() {
  const file=readProtected('/usr/bin/mysql',undefined,100*1024*1024);
  if(!(file.identity.mode&0o111))refuse();
  return {dev:file.identity.dev,ino:file.identity.ino,sha256:file.sha256};
}

export function attestTimeoutBinary(io=fs) {
  const file=readProtected(AUTHORITY.verifierTimeout.binary,undefined,100*1024*1024,io);
  if(!(file.identity.mode&0o111))refuse();
  return {dev:file.identity.dev,ino:file.identity.ino,sha256:file.sha256};
}

export function verifierCommand(request,io=fs) {
  if(!same(attestTimeoutBinary(io),request.context.timeoutIdentity))refuse('verifier');
  const {binary,seconds,killAfterSeconds}=AUTHORITY.verifierTimeout;
  return {bin:binary,args:[`--kill-after=${killAfterSeconds}s`,`${seconds}s`,'/usr/bin/python3','-I','-B',path.join(import.meta.dirname,'zaruku-shadow-evidence-lock.py'),'verify']};
}

export { attestStagedControl, attestStagedPredecessor } from './zaruku-shadow-dispatch.mjs';

export function validateInventory(bytes,authority=AUTHORITY) {
  const expected=authority.otherRuntimeShaEntries.map(row=>`${row.name}\t${row.path}\n`).join('');
  if(!Buffer.isBuffer(bytes)||bytes.toString('utf8')!==expected)refuse('inventory');
  return authority.otherRuntimeShaEntries;
}

export function inspectFixedInventory(io=fs) {
  const file=readProtected(AUTHORITY.otherRuntimeShas,0o600,4096,io);
  const entries=validateInventory(file.bytes);
  const foreignShas=entries.map(entry=>{
    const value=readProtected(entry.path,undefined,41,io);
    if(!/^[a-f0-9]{40}\n$/.test(value.bytes.toString()))refuse('inventory');
    return {name:entry.name,sha:value.bytes.toString().trim(),identity:Object.values(value.identity).map(String).join(':')};
  });
  return {foreignShas,inventoryIdentity:file.identity,inventorySha256:file.sha256};
}

/** Explicit installer only; never called by the production state machine. */
export function installFixedInventory(io=fs,identity={uid:process.getuid(),euid:process.geteuid()}) {
  if(identity.uid!==0||identity.euid!==0)refuse('inventory');
  safeAncestors(AUTHORITY.otherRuntimeShas,io);
  const bytes=Buffer.from(AUTHORITY.otherRuntimeShaEntries.map(row=>`${row.name}\t${row.path}\n`).join(''));
  for(const entry of AUTHORITY.otherRuntimeShaEntries){const sha=readProtected(entry.path,undefined,41,io);if(!/^[a-f0-9]{40}\n$/.test(sha.bytes.toString()))refuse('inventory');}
  if(io.lstatSync(AUTHORITY.otherRuntimeShas,{throwIfNoEntry:false}))return inspectFixedInventory(io);
  const parent=io.openSync(path.dirname(AUTHORITY.otherRuntimeShas),io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);
  try {
    const before=snapshot(io.fstatSync(parent));
    const target=`/proc/self/fd/${parent}/other-runtime-shas.tsv`;
    const fd=io.openSync(target,io.constants.O_WRONLY|io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_NOFOLLOW,0o600);
    try {io.fchownSync(fd,0,0);io.writeFileSync(fd,bytes);io.fchmodSync(fd,0o600);io.fsyncSync(fd);}finally{io.closeSync(fd);}
    io.fsyncSync(parent);
    const after=snapshot(io.lstatSync(path.dirname(AUTHORITY.otherRuntimeShas)));
    if(before.dev!==after.dev||before.ino!==after.ino)refuse('inventory');
  } finally {io.closeSync(parent);}
  return inspectFixedInventory(io);
}

export function bindReadOnlySql(sql,params=[]) {
  if(typeof sql!=='string'||sql.length>64000||/[;\r\n\0]/.test(sql)||!Array.isArray(params)||!/^(?:SELECT |SHOW GRANTS FOR |UPDATE `report_bd`\.`canonical_fact_site_analytics_daily` SET `visits` = `visits` WHERE 1 = 0$)/.test(sql))throw new Error('Zaruku MySQL check failed');
  let index=0;
  const bound=sql.replaceAll('?',()=>{
    const value=params[index++];
    if(typeof value!=='string'||value.length>4096)throw new Error('Zaruku MySQL check failed');
    return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
  });
  if(index!==params.length)throw new Error('Zaruku MySQL check failed');return bound;
}

export function createMysqlAdapters(toolIdentity,password,runner=spawnSync) {
  const adapter=mode=>({query:async(sql,params=[])=>{
    // The existing verifier brackets the zero-row probe; the helper performs
    // that probe's START/UPDATE/ROLLBACK inside one disposable connection.
    if(mode==='reader'&&['START TRANSACTION','ROLLBACK'].includes(sql)&&!params.length)return [];
    const input=JSON.stringify({mode,password:mode==='reader'?password:null,sql:bindReadOnlySql(sql,params),toolIdentity});
    const result=runner('/usr/bin/python3',['-I','-B',path.join(import.meta.dirname,'zaruku-shadow-mysql.py')],{input,env:{},stdio:['pipe','pipe','pipe'],timeout:10000,maxBuffer:131072});
    try {
      if(result.status!==0||result.error||result.signal||result.stderr?.length)throw new Error();
      const value=JSON.parse(result.stdout);
      if(same(Object.keys(value),['errno'])&&[1044,1045,1142].includes(value.errno)){const error=new Error('Zaruku MySQL access denied');error.errno=value.errno;throw error;}
      if(!same(Object.keys(value),['rows'])||!Array.isArray(value.rows)||value.rows.length>1024)throw new Error();return value.rows;
    } catch(error){if([1044,1045,1142].includes(error.errno))throw error;throw new Error('Zaruku MySQL check failed');}
  }});
  return {admin:adapter('admin'),reader:adapter('reader')};
}

export function attestLiveProcess(value,expectedSha) {
  const {processes,account,status,cwd,listeners,sourceSha}=value;
  const candidates=processes.filter(row=>row.name==='dashboard-zaruku');
  if(candidates.length!==1||!Number.isSafeInteger(candidates[0].pid)||candidates[0].pid<=0||sourceSha!==expectedSha||cwd!=='/var/www/dashboard-zaruku/apps/zaruku')refuse('process attestation');
  for(const [key,id]of [['Uid',account.uid],['Gid',account.gid]]){
    const match=new RegExp(`^${key}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`,'m').exec(status);
    if(!Number.isSafeInteger(id)||id<=0||!match||match.slice(1).some(value=>Number(value)!==id))refuse('process attestation');
  }
  const groups=/^Groups:[\t ]*([^\r\n]*)$/m.exec(status);
  if(!groups||groups[1].trim().split(/\s+/).filter(Boolean).some(group=>Number(group)!==account.gid))refuse('process attestation');
  for(const name of ['CapInh','CapPrm','CapEff','CapAmb'])if(!new RegExp(`^${name}:[\\t ]*0+$`,'m').test(status))refuse('process attestation');
  const owned=listeners.filter(row=>row.port===3002);
  if(!owned.length||owned.some(row=>row.host!=='127.0.0.1'||row.pid!==candidates[0].pid))refuse('process attestation');
  return {passed:true,sourceSha,pid:candidates[0].pid,cwd,uid:account.uid,gid:account.gid,groups:[],capabilities:'0',loopbackOnly:true,port:3002,process:'dashboard-zaruku'};
}

export function sanitizeDecision(value,sha) {
  const extra=value&&Object.hasOwn(value,'baselines')?['baselines','processAttestation']:[];
  if(!value||!same(Object.keys(value).sort(),[...extra,'checks','decision','failure','parity','publicCutover','sourceSha','steps'].sort())||!['GO','NO-GO'].includes(value.decision)||value.publicCutover!==false||value.sourceSha!==sha||!Array.isArray(value.steps)||value.steps.some(step=>!STEP_NAMES.includes(step))||!value.checks||Object.entries(value.checks).some(([step,status])=>!STEP_NAMES.includes(step)||status!=='pass')||value.failure!==null&&!FAILURES.includes(value.failure))refuse('evidence');
  const p=value.parity;
  if(!p||!same(Object.keys(p).sort(),['coverageAdvancedDuringFirstPair','pairedReadAttempts','stableCanonicalComparison'])||![1,2].includes(p.pairedReadAttempts)||p.coverageAdvancedDuringFirstPair!==(p.pairedReadAttempts===2)||typeof p.stableCanonicalComparison!=='boolean')refuse('evidence');
  if(extra.length){
    if(!value.baselines||!same(Object.keys(value.baselines).sort(),['after','before']))refuse('evidence');
    for(const row of Object.values(value.baselines))if(row!==null){
      if(!same(Object.keys(row).sort(),['combinedPid','foreignShas','nginxSha256'])||!Number.isSafeInteger(row.combinedPid)||row.combinedPid<=0||!/^[a-f0-9]{64}$/.test(row.nginxSha256)||!Array.isArray(row.foreignShas)||row.foreignShas.length!==1)refuse('evidence');
      const foreign=row.foreignShas[0];if(!same(Object.keys(foreign).sort(),['identity','name','sha'])||foreign.name!=='combined-dashboard'||!/^[a-f0-9]{40}$/.test(foreign.sha)||!/^\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)*$/.test(foreign.identity))refuse('evidence');
    }
    const a=value.processAttestation;
    if(a!==null&&(!same(Object.keys(a).sort(),['capabilities','cwd','gid','groups','loopbackOnly','pid','port','process','sourceSha','uid'])||a.sourceSha!==sha||a.cwd!=='/var/www/dashboard-zaruku/apps/zaruku'||a.process!=='dashboard-zaruku'||a.port!==3002||a.capabilities!=='0'||a.loopbackOnly!==true||!same(a.groups,[])||['pid','uid','gid'].some(key=>!Number.isSafeInteger(a[key])||a[key]<=0)))refuse('evidence');
  }
  return JSON.parse(JSON.stringify(value));
}

function command(bin,args,env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2'}) {
  const result=spawnSync(bin,args,{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000,maxBuffer:1048576});
  if(result.error||result.signal||result.status!==0||result.stderr)refuse();return result.stdout.trim();
}

function runtimePid(name) {
  if(!['dashboard-next','dashboard-zaruku'].includes(name))refuse();
  const value=command('/usr/bin/env',['-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/root','PM2_HOME=/root/.pm2','pm2','pid',name]);
  if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))refuse();return Number(value);
}

function contextCheck(request) {
  const inventory=inspectFixedInventory();
  if(!same(inventory.inventoryIdentity,request.context.inventoryIdentity)||inventory.inventorySha256!==request.context.inventorySha256||!same(attestMysqlBinary(),request.context.mysqlIdentity)||!same(attestTimeoutBinary(),request.context.timeoutIdentity))refuse();
  return inventory;
}

function safeEvidenceDirectory(request,create=false,io=fs) {
  if(!request||!/^[a-f0-9]{40}$/.test(request.sourceSha)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.runId)||!request.context)refuse('evidence');
  const identity=request.context.evidenceIdentity;
  if(identity!==undefined&&(!identity||!same(Object.keys(identity).sort(),['dev','ino'])||!/^\d+$/.test(identity.dev)||!/^\d+$/.test(identity.ino)))refuse('evidence');
  const directory=path.join(AUTHORITY.evidenceRoot,`${request.sourceSha}-${request.runId}`);
  safeAncestors(directory,io);
  let stat=io.lstatSync(directory,{throwIfNoEntry:false});
  if(stat&&(!request.context.evidenceIdentity||String(stat.dev)!==request.context.evidenceIdentity.dev||String(stat.ino)!==request.context.evidenceIdentity.ino))refuse('evidence');
  if(!stat&&create){if(request.context.evidenceIdentity)refuse('evidence');io.mkdirSync(directory,{mode:0o700});stat=io.lstatSync(directory);}
  if(!stat||!stat.isDirectory()||stat.uid!==0||stat.gid!==0||(stat.mode&0o777)!==0o700)refuse('evidence');
  return directory;
}

/** A separate pre-deploy action owns allocation; no receipt is inferred later. */
export function allocateEvidence(request,io=fs) {
  if(request.context?.evidenceIdentity!==undefined)refuse('evidence');
  const directory=safeEvidenceDirectory(request,true,io),before=snapshot(io.lstatSync(directory));
  const fd=io.openSync(directory,io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);
  try {
    if(!same(before,snapshot(io.fstatSync(fd))))refuse('evidence');
    io.fsyncSync(fd);
    const parent=io.openSync(AUTHORITY.evidenceRoot,io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);
    try{io.fsyncSync(parent);}finally{io.closeSync(parent);}
    if(!same(before,snapshot(io.lstatSync(directory))))refuse('evidence');
    return {passed:true,sourceSha:request.sourceSha,runId:request.runId,evidenceIdentity:{dev:before.dev,ino:before.ino}};
  } finally {io.closeSync(fd);}
}

export function requireEvidenceDirectory(request,io=fs) {
  if(!request.context?.evidenceIdentity)refuse('evidence');
  return safeEvidenceDirectory(request,false,io);
}

const EVIDENCE_FILES=['artifact-attestation.json','canonical-comparison.json','endpoint-parity.json','runtime-shas.after.tsv','runtime-shas.before.tsv','summary.json','zaruku-routes.txt'];
const lockReceipt=request=>({sourceSha:request.sourceSha,runId:request.runId,evidenceIdentity:request.context.evidenceIdentity});

function lockDescriptor(fd,request) {
  const result=spawnSync('/usr/bin/python3',['-I','-B',path.join(import.meta.dirname,'zaruku-shadow-evidence-lock.py'),'acquire'],{input:JSON.stringify(lockReceipt(request)),env:{},stdio:['pipe','pipe','pipe','ignore','ignore',fd],timeout:215000,maxBuffer:1024});
  if(result.status!==0||result.error||result.signal||result.stderr?.length||result.stdout?.toString()!=='locked\n')refuse('evidence fence');
}

export function openEvidenceLock(request,io=fs,locker=lockDescriptor) {
  const directory=requireEvidenceDirectory(request,io);
  const fd=io.openSync(directory,io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);
  try {
    const stat=io.fstatSync(fd);
    if(!stat.isDirectory()||stat.uid!==0||stat.gid!==0||(stat.mode&0o777)!==0o700||String(stat.dev)!==request.context.evidenceIdentity.dev||String(stat.ino)!==request.context.evidenceIdentity.ino)refuse('evidence');
    locker(fd,request);
    // A queued writer may wake after publication or path replacement. Recheck
    // the pinned inode AND the unfinalized mode while the lock is held.
    requireEvidenceDirectory(request,io);
    return {directory,fd};
  } catch(error){io.closeSync(fd);throw error;}
}

async function pairedParity(request) {
  const {directory,fd:lock}=openEvidenceLock(request);
  let ownsLock=true,authFd,auth;
  try {
  contextCheck(request);
  auth=readProtected(AUTHORITY.authDescriptor,0o600);validateAuthDescriptor(auth.bytes);
  if(fs.readdirSync(directory).length)refuse('evidence');
  const fd=authFd=fs.openSync(AUTHORITY.authDescriptor,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  if(!same(snapshot(fs.fstatSync(fd)),auth.identity))refuse();
  const secret=readZarukuSecrets(),{admin,reader}=createMysqlAdapters(request.context.mysqlIdentity,secret.ZARUKU_DB_PASSWORD);
  let observations=0,invalid=false,stream='';
  const invocation=verifierCommand(request); // Last synchronous check before exec; no PATH lookup.
  const child=spawn(invocation.bin,invocation.args,{detached:true,env:{PATH:'/usr/bin:/bin',ZARUKU_SHADOW_AUTH_FD:'3',ZARUKU_SHADOW_COVERAGE_FD:'4',ZARUKU_SHADOW_LOCK_FD:'5',ZARUKU_SHADOW_WRITER_FD:'6',ZARUKU_SHADOW_ARTIFACT_ROOT:'/var/www/dashboard-zaruku',ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE:AUTHORITY.otherRuntimeShas,ZARUKU_SHADOW_CANONICAL_SNAPSHOT:request.sourceSha,ZARUKU_SHADOW_FROM:AUTHORITY.period.from,ZARUKU_SHADOW_TO:AUTHORITY.period.to,ZARUKU_SHADOW_HTTP_TIMEOUT_MS:String(AUTHORITY.httpTimeoutMs)},stdio:['pipe','pipe','pipe',fd,'pipe',lock]});
  child.stdin.on('error',()=>{invalid=true;});child.stdin.end(JSON.stringify(lockReceipt(request)));
  fs.closeSync(fd);authFd=undefined;auth.bytes.fill(0);
  // Transfer, do not retain an extra worker-owned lock copy during DB reads:
  // the independently bounded supervisor and its writers now own the fence.
  fs.closeSync(lock);ownsLock=false;
  // Child stdout/stderr are never forwarded: even tool diagnostics are private.
  const abortProtocol=()=>{invalid=true;child.stdio[4].destroy();};
  let outputBytes=0;for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes>65536)abortProtocol();});
  let pending=Promise.resolve();
  child.stdio[4].on('error',abortProtocol);
  child.stdio[4].on('data',chunk=>{
    stream+=chunk.toString();
    if(stream.length>64){abortProtocol();return;}
    while(stream.includes('\n')){
      const index=stream.indexOf('\n'),line=stream.slice(0,index);stream=stream.slice(index+1);
      if(line!=='observe'||++observations>2){abortProtocol();return;}
      pending=pending.then(async()=>{const token=await observeCanonicalCoverage(admin,reader);if(!child.stdio[4].destroyed)child.stdio[4].write(JSON.stringify(token)+'\n');}).catch(abortProtocol);
    }
  });
  let status;
  try{status=await new Promise(resolve=>{child.once('error',()=>{invalid=true;resolve(null);});child.once('close',resolve);});await pending;}
  finally{child.stdio[4].destroy();}
  const finalLock=openEvidenceLock(request);
  try {
  contextCheck(request);
  let comparison={pairedReadAttempts:1,coverageAdvancedDuringFirstPair:false,stableCanonicalComparison:false};
  const filename=path.join(directory,'canonical-comparison.json');
  if(fs.existsSync(filename)){
    const value=JSON.parse(readProtected(filename,0o600,4096).bytes);
    if(same(Object.keys(value).sort(),Object.keys(comparison).sort())&&[1,2].includes(value.pairedReadAttempts)&&value.coverageAdvancedDuringFirstPair===(value.pairedReadAttempts===2)&&typeof value.stableCanonicalComparison==='boolean')comparison=value;
    else invalid=true;
  }
  return {passed:!invalid&&status===0&&comparison.stableCanonicalComparison,...comparison};
  } finally {fs.closeSync(finalLock.fd);}
  } finally {if(authFd!==undefined)fs.closeSync(authFd);auth?.bytes.fill(0);if(ownsLock)fs.closeSync(lock);}
}

export function publishDecision(request,io=fs,locker=lockDescriptor) {
  const value=sanitizeDecision(request.decision,request.sourceSha);
  const {directory,fd:lock}=openEvidenceLock(request,io,locker);
  try {
  const before=snapshot(io.lstatSync(directory));
  const files=io.readdirSync(directory);
  if(files.some(name=>!EVIDENCE_FILES.includes(name)))refuse('evidence');
  if(value.decision==='GO'&&EVIDENCE_FILES.some(name=>!files.includes(name)))refuse('evidence');
  const records=[];
  for(const name of files){const file=readProtected(path.join(directory,name),0o600,65536,io);records.push({name,sha256:file.sha256});}
  const pending=path.join(directory,'.decision.pending.json');
  const fd=io.openSync(pending,io.constants.O_WRONLY|io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_NOFOLLOW,0o400);
  try{io.writeFileSync(fd,JSON.stringify({...value,evidenceFiles:records})+'\n');io.fchmodSync(fd,0o400);io.fsyncSync(fd);}finally{io.closeSync(fd);}
  for(const name of files){const fd=io.openSync(path.join(directory,name),io.constants.O_RDONLY|io.constants.O_NOFOLLOW);try{io.fchmodSync(fd,0o400);io.fsyncSync(fd);}finally{io.closeSync(fd);}}
  requireEvidenceDirectory(request,io);
  const after=snapshot(io.lstatSync(directory));if(before.dev!==after.dev||before.ino!==after.ino)refuse('evidence');
  io.renameSync(pending,path.join(directory,'decision.json'));
  const dir=io.openSync(directory,io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);try{io.fchmodSync(dir,0o500);io.fsyncSync(dir);}finally{io.closeSync(dir);}
  const parent=io.openSync(AUTHORITY.evidenceRoot,io.constants.O_RDONLY|io.constants.O_DIRECTORY|io.constants.O_NOFOLLOW);try{io.fsyncSync(parent);}finally{io.closeSync(parent);}
  return {path:directory,immutable:true};
  } finally {io.closeSync(lock);}
}

export function cleanupEvidence(request,io=fs,locker=lockDescriptor) {
  if(!request.context.evidenceIdentity){const directory=path.join(AUTHORITY.evidenceRoot,`${request.sourceSha}-${request.runId}`);if(io.lstatSync(directory,{throwIfNoEntry:false}))refuse('evidence');return {passed:true};}
  const {directory,fd}=openEvidenceLock(request,io,locker);
  try{if(io.readdirSync(directory).some(name=>!EVIDENCE_FILES.includes(name)))refuse('evidence');return {passed:true};}
  finally{io.closeSync(fd);}
}

function createWorkerAdapter() {
  const baseline=()=>{
    const preflight=createReadOnlyPreflightAdapter(), nginx=preflight.readNginx(), listeners=preflight.listeners(),pid=runtimePid('dashboard-next');
    if(nginx.text.match(/(^|[^0-9])3002([^0-9]|$)/)||!nginx.text.match(/(^|[^0-9])3001([^0-9]|$)/)||!listeners.some(row=>row.port===3001&&row.pid===pid)||listeners.filter(row=>row.port===3001).some(row=>row.host!=='127.0.0.1'))refuse();
    return {passed:true,combinedPid:pid,nginxSha256:nginx.sha256,...inspectFixedInventory()};
  };
  return {
    async preflight(){
      const timeoutIdentity=attestTimeoutBinary(),mysqlIdentity=attestMysqlBinary(),{admin}=createMysqlAdapters(mysqlIdentity,null),preflight={...createReadOnlyPreflightAdapter()};
      const identity=await admin.query('SELECT CURRENT_USER() AS currentUser');
      if(!same(identity,[{currentUser:'root@localhost'}]))refuse();
      const accounts=await admin.query("SELECT User AS user, Host AS host FROM mysql.user WHERE User = 'dashboard_zaruku_reader'");
      const schema=await admin.query("SELECT SCHEMA_NAME AS databaseName FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'report_bd'");
      if(!same(schema,[{databaseName:'report_bd'}]))refuse();
      preflight.mysql=()=>({rootSocketAdmin:true,currentUser:'root@localhost',database:'report_bd'});
      preflight.mysqlIdentity=()=>({exists:accounts.length===1,account:accounts.length===1?accounts[0].user+'@'+accounts[0].host:null});
      assertShadowPrerequisites(await inspectShadowPrerequisites(preflight));
      return {...baseline(),mysqlIdentity,timeoutIdentity};
    },
    async hostBoundary(request){contextCheck(request);const result=await inspectHostBoundary(createHostAdapter());return {passed:result.state==='compliant'};},
    async dbBoundary(request){contextCheck(request);const secret=readZarukuSecrets(),{admin,reader}=createMysqlAdapters(request.context.mysqlIdentity,secret.ZARUKU_DB_PASSWORD);const result=await verifyReaderBoundary(admin,reader);return {passed:true,tableSelectCount:result.tableSelectCount};},
    runtimeSecrets(request){contextCheck(request);readZarukuSecrets();return {passed:true};},
    managerAuth(request){contextCheck(request);const file=readProtected(AUTHORITY.authDescriptor,0o600);try{validateAuthDescriptor(file.bytes);return {passed:true};}finally{file.bytes.fill(0);}},
    allocateEvidence:request=>{contextCheck(request);return allocateEvidence(request);},
    attest(request){contextCheck(request);const record=inspectActiveRuntime();if(!record)refuse();const pid=runtimePid('dashboard-zaruku'),host=createHostAdapter(),account=host.serviceIdentity();return attestLiveProcess({processes:[{name:'dashboard-zaruku',pid}],account,status:fs.readFileSync(`/proc/${pid}/status`,'utf8'),cwd:fs.realpathSync(`/proc/${pid}/cwd`),listeners:createReadOnlyPreflightAdapter().listeners(),sourceSha:record.sourceSha},request.sourceSha);},
    parity:pairedParity,
    recheck(request){contextCheck(request);return baseline();},
    cleanup:cleanupEvidence,
    stop(request){return transact({action:'stop-owned',binding:{sourceSha:request.sourceSha,runId:request.runId}},undefined,()=>{if(attestStagedControl()!==request.sourceSha)refuse();});},
    writeDecision:publishDecision,
  };
}

export async function runShadowWorker(action,request,adapter) {
  try{
    if(!ACTIONS.includes(action)||!request||!/^[a-f0-9]{40}$/.test(request.sourceSha)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.runId)||!same(Object.keys(request).sort(),['context',...(action==='writeDecision'?['decision']:[]),'runId','sourceSha'])||!request.context)refuse();
    if(!adapter&&(process.platform!=='linux'||process.getuid()!==0||process.geteuid()!==0||ROOT!==`/var/www/.dashboard-zaruku-shadow/control/${request.sourceSha}`))refuse();
    if (!adapter && attestStagedControl() !== request.sourceSha) refuse();
    return await (adapter??createWorkerAdapter())[action](request);
  }catch{refuse();}
}
