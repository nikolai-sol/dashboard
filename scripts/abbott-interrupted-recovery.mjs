import fs from 'node:fs';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createRuntimeInstaller} from './runtime-release-remote.mjs';
import {verifyAbbottBootstrapSource} from './bootstrap-abbott-host.mjs';

const APP='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control';
const LOCK='/var/www/.dashboard-abbott-deploy.lock';
export const RECOVERY_PINS=Object.freeze({
  hostname:'ybjqbzojln',boot:'1c736efb-eaa2-42d9-b247-bd1a2ef36a4e',daemon:1316,
  candidate:'e9e548a6414c4d8c836c7715c66f37ad',candidateSha:'9aaed34feeb9b73b4d177dccab5a2b750776b4c3',candidateHash:'a62b6297cdc903ed4d0e94357e7dfbe8d552ed4bf76db95be6582d913433c74b',
  old:'6cd2f12e245a47dcbd5f6ce928c4ed83',oldSha:'f80607fbc8a693aa2c720b0976938e88732cdf1a',oldHash:'7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f',
  pmId:5,pid:714550,start:'162192969',uid:982,gid:984,
  nginx:'1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c',
});
const P=RECOVERY_PINS,BACKUP=`/var/www/dashboard-abbott-backups/${P.old}`;
const PARK=`/var/www/dashboard-abbott-releases/${P.candidate}-interrupted-recovery`;
const JOURNAL=`${CONTROL}/interrupted-recovery-${P.candidate}.json`;
const refusal=()=>{throw Error('ABBOTT_RECOVERY_REFUSED');};
const review=()=>{throw Error('ABBOTT_RECOVERY_REVIEW_REQUIRED');};
export function validateRecoveryPins(value){if(!isDeepStrictEqual(value,P))refusal();}

// Small explicit state machine: after any possible process mutation there is
// no success/unlock path except complete predecessor attestation. Compensation
// never restarts candidate code. A failed compensation preserves the lock.
export async function runRecoverySteps(adapter){
  let mutation=false;
  const check=()=>{if(adapter.signal?.aborted)refusal();};
  const step=async name=>{check();await adapter.step(name);check();};
  try{
    check();await adapter.verify('initial');check();await step('lock');
    await adapter.verify('locked');await step('journal:prepared');
    check();mutation=true;await step('stop');await step('journal:stopped');await adapter.verify('stopped');
    await step('move:candidate');await step('journal:candidate_parked');
    await step('move:backup');await step('journal:backup_active');await adapter.verify('old_tree');
    await step('restart');await adapter.verify('restored');check();
    await step('journal:restored');check();await adapter.step('unlock');return 'ABBOTT_RECOVERY_RESTORED';
  }catch{
    if(!mutation)refusal();
    // Ignore cancellation only while making the owned process safe and
    // preserving both trees. Every real adapter operation remains bounded.
    let stopped=false;
    try{await adapter.step('stop:owned_after_failure');stopped=true;}catch{}
    if(stopped)try{await adapter.step('compensate');}catch{}
    try{await adapter.step('journal:review_required');}catch{}
    review();
  }
}

const hash=b=>createHash('sha256').update(b).digest('hex');
function regular(p,mode,gid=0,dir=false){
  const s=fs.lstatSync(p);if(fs.realpathSync(p)!==p||s.uid!==0||s.gid!==gid||(s.mode&0o7777)!==mode||(dir?!s.isDirectory():!s.isFile()||s.nlink!==1))refusal();return s;
}
function read(p,mode=0o600,max=4096,gid=0){
  const before=regular(p,mode,gid),same=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const a=fs.fstatSync(fd);if(a.size>max||!same(before,a))refusal();const b=fs.readFileSync(fd);if(a.size!==b.length||!same(a,fs.fstatSync(fd))||!same(a,fs.lstatSync(p))){b.fill(0);refusal();}return b;}finally{fs.closeSync(fd);}
}
const identity=p=>{const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(p)!==p||s.uid!==0||s.gid!==0||s.mode&0o022)refusal();return{dev:s.dev,ino:s.ino};};
function sameDirectory(p,expected){if(!isDeepStrictEqual(identity(p),expected))refusal();}
function kernel(pid,start,cwd,uid,gid){
  const stat=()=>{const v=fs.readFileSync(`/proc/${pid}/stat`,'utf8');return v.slice(v.lastIndexOf(')')+2).trim().split(/\s+/)[19];};
  const before=stat();if(start!==null&&before!==start)refusal();
  const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
  for(const[field,value]of[['Uid',uid],['Gid',gid]])if(!new RegExp(`^${field}:\\s+(${value}\\s+){3}${value}\\s*$`,'m').test(status))refusal();
  if(fs.realpathSync(`/proc/${pid}/cwd`)!==cwd||stat()!==before)refusal();return before;
}
function absent(p){if(fs.lstatSync(p,{throwIfNoEntry:false}))refusal();}

export function createRecoveryAdapter(environmentKeys,signal){
  const authority={scope:'abbott',releaseBranch:'release/abbott',appName:'dashboard-abbott',port:3004,appDir:APP,lockDir:LOCK,assetPrefix:'/_next-abbott'};
  const installer=createRuntimeInstaller(authority,environmentKeys);
  const {readRecord,attestTree,platform}=installer.interruptedRecoveryTools();
  let old,candidate,original,candidateDirectory,backupDirectory,ownedProcess,locked=false;
  const environmentDigests=new Map();
  const owner=randomUUID();let parked=false,restored=false,started=false;
  const stablePointer=()=>{const b=read(`${CONTROL}/current.json`),r=read(`${CONTROL}/${P.old}/record.json`);try{if(!b.equals(r)||!b.equals(original))refusal();}finally{b.fill(0);r.fill(0);}};
  const tree=(p,r)=>{
    if(!isDeepStrictEqual(readRecord(r.id),r))refusal();
    attestTree(p,r);const b=read(`${p}/.env`,0o640,65536,P.gid);
    try{
      if(b.length>65536)refusal();const digest=hash(b),previous=environmentDigests.get(r.id);if(previous&&previous!==digest)refusal();environmentDigests.set(r.id,digest);
      const lines=b.toString().split('\n').filter(l=>l.startsWith('PUPPETEER_EXECUTABLE_PATH='));
      if(r.id===P.candidate){if(lines.length!==1||lines[0]!=="PUPPETEER_EXECUTABLE_PATH='/var/lib/dashboard-abbott/browser-cache-chrome/chrome/linux-146.0.7680.76/chrome-linux64/chrome'")refusal();}
      else if(lines.length)refusal();
    }finally{b.fill(0);}
  };
  function perimeter(){
    if(process.getuid()!==0||process.geteuid()!==0||os.hostname()!==P.hostname)refusal();
    verifyAbbottBootstrapSource();
    if(fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()!==P.boot||fs.readFileSync('/root/.pm2/pm2.pid','utf8').trim()!==String(P.daemon))refusal();
    for(const[name,id,pid,start,cwd,uid,gid]of[
      ['dashboard-next',1,3722244,'122353749','/var/www/dashboard',0,0],
      ['dashboard-zaruku',2,791065,'131477500','/var/www/dashboard-zaruku/apps/zaruku',984,991],
      ['dashboard-medroche',4,1870897,'139126198','/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone/apps/site-seo',983,983]]){
      if(fs.readFileSync(`/root/.pm2/pids/${name}-${id}.pid`,'utf8').trim()!==String(pid))refusal();kernel(pid,start,cwd,uid,gid);
    }
    for(const[p,sha]of[['/var/www/dashboard/.release-source-sha','8f389a28df1c4b741ec33b7538f0354b74f5a40e'],['/var/www/dashboard-zaruku/.release-source-sha','af1948c8b9a0f70d8696afb9c8abc254408a5daa']])if(fs.readFileSync(p,'utf8').trim()!==sha)refusal();
    if(fs.realpathSync('/var/www/dashboard-medroche')!=='/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone')refusal();
    const nginx='/etc/nginx/conf.d/dashboard-next.conf';regular(nginx,0o644);if(hash(read(nginx,0o644,1048576))!==P.nginx)refusal();
    regular(CONTROL,0o700,0,true);for(const id of[P.old,P.candidate])regular(`${CONTROL}/${id}`,0o700,0,true);
    regular('/var/www/dashboard-abbott-releases',0o711,0,true);regular('/var/www/dashboard-abbott-backups',0o711,0,true);
    const account=platform.account();if(account.uid!==P.uid||account.gid!==P.gid)refusal();
    const fields=fs.readFileSync('/etc/passwd','utf8').split('\n').filter(x=>x.startsWith('dashboard-abbott:'));if(fields.length!==1||fields[0].split(':')[5]!=='/nonexistent'||fields[0].split(':')[6]!=='/usr/sbin/nologin')refusal();
  }
  function registration(){
    const value=platform.registration(P.pmId);if(!value||value.registration.pmId!==P.pmId||value.registration.releaseId!==P.old||value.registration.sourceSha!==P.oldSha)refusal();return value;
  }
  function capture(initial=false){
    const r=registration();if(!Number.isSafeInteger(r.pid)||r.pid<=0||r.status!=='online')refusal();
    if(initial&&r.pid!==P.pid)refusal();const start=kernel(r.pid,initial?P.start:null,`${APP}/apps/abbott`,P.uid,P.gid);
    const again=registration();if(!isDeepStrictEqual(r,again))refusal();return{pid:r.pid,start,registration:r.registration};
  }
  function checkOwned(){const now=capture();if(!isDeepStrictEqual(now,ownedProcess))refusal();}
  async function initialReadiness(){
    checkOwned();
    const sockets=new Set(fs.readdirSync(`/proc/${P.pid}/fd`).map(n=>{try{return fs.readlinkSync(`/proc/${P.pid}/fd/${n}`);}catch{return '';}}).filter(x=>x.startsWith('socket:[')).map(x=>x.slice(8,-1)));
    const listeners=[];for(const table of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(table,'utf8').trim().split('\n').slice(1)){const v=line.trim().split(/\s+/);if(v[3]==='0A'&&v[1].endsWith(':0BBC')){if(!sockets.has(v[9]))refusal();listeners.push(v[1]);}}
    if(JSON.stringify(listeners)!==JSON.stringify(['0100007F:0BBC']))refusal();
    const response=await fetch('http://127.0.0.1:3004/api/health',{redirect:'error',signal:AbortSignal.timeout(1000)});
    if(response.status!==200)refusal();const reader=response.body.getReader();let size=0;const parts=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256)refusal();parts.push(Buffer.from(value));}if(Buffer.concat(parts).toString()!=='{"ok":true,"scope":"abbott","database":"connected"}')refusal();}finally{await reader.cancel().catch(()=>{});for(const b of parts)b.fill(0);}
    checkOwned();
  }
  async function noProcess(){
    const r=registration();if(r.pid!==0||r.status!=='stopped')refusal();
    if(ownedProcess){try{fs.statSync(`/proc/${ownedProcess.pid}`);refusal();}catch(e){if(e.code!=='ENOENT')throw e;}}
    await platform.assertNoListener();
  }
  async function readiness(){
    checkOwned();const proof=platform.snapshot();if(proof.pid!==ownedProcess.pid||proof.startTime!==ownedProcess.start||proof.sourceSha!==P.oldSha)refusal();
    await platform.health(proof);checkOwned();
  }
  function lockOwned(){regular(LOCK,0o700,0,true);if(read(`${LOCK}/owner`).toString()!==owner)refusal();}
  function journal(state){
    lockOwned();const value=Buffer.from(JSON.stringify({version:1,owner,state,candidate:P.candidate,predecessor:P.old,originalPid:P.pid,originalStart:P.start})+'\n');
    // First publication is exclusive; subsequent atomic updates use one fixed
    // sibling after verifying the previous journal belongs to this lock.
    if(fs.existsSync(JOURNAL)){const prior=JSON.parse(read(JOURNAL));if(prior.owner!==owner)refusal();}
    const next=JOURNAL+'.next';absent(next);const fd=fs.openSync(next,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);value.fill(0);}
    fs.renameSync(next,JOURNAL);
  }
  async function verify(stage){
    perimeter();if(locked)lockOwned();
    if(stage==='initial'){
      absent(LOCK);absent(JOURNAL);absent(JOURNAL+'.next');absent(PARK);
      old=readRecord(P.old);candidate=readRecord(P.candidate);
      if(old.sourceSha!==P.oldSha||old.manifestDigest!==P.oldHash||old.previousId!==null||candidate.sourceSha!==P.candidateSha||candidate.manifestDigest!==P.candidateHash||candidate.previousId!==P.old)refusal();
      original=read(`${CONTROL}/current.json`);stablePointer();tree(APP,candidate);tree(BACKUP,old);
      candidateDirectory=identity(APP);backupDirectory=identity(BACKUP);ownedProcess=capture(true);
      await initialReadiness();
    }else{
      stablePointer();
      if(stage==='locked'){sameDirectory(APP,candidateDirectory);sameDirectory(BACKUP,backupDirectory);tree(APP,candidate);tree(BACKUP,old);await initialReadiness();}
      if(stage==='stopped'){await noProcess();sameDirectory(APP,candidateDirectory);sameDirectory(BACKUP,backupDirectory);tree(APP,candidate);tree(BACKUP,old);}
      if(stage==='old_tree'||stage==='restored'){sameDirectory(APP,backupDirectory);sameDirectory(PARK,candidateDirectory);tree(APP,old);tree(PARK,candidate);absent(BACKUP);}
      if(stage==='old_tree')await noProcess();
      if(stage==='restored'){await readiness();if(!isDeepStrictEqual(installer.inspectActiveRuntime(),old))refusal();}
    }
  }
  async function step(name){
    if(name==='lock'){perimeter();absent(LOCK);fs.mkdirSync(LOCK,{mode:0o700});fs.chmodSync(LOCK,0o700);fs.writeFileSync(`${LOCK}/owner`,owner,{flag:'wx',mode:0o600});fs.chmodSync(`${LOCK}/owner`,0o600);locked=true;return;}
    lockOwned();
    if(name.startsWith('journal:')){journal(name.slice(8));return;}
    if(name==='stop'){perimeter();stablePointer();await initialReadiness();await platform.stop(P.pmId);await noProcess();return;}
    if(name==='move:candidate'){perimeter();stablePointer();await noProcess();sameDirectory(APP,candidateDirectory);sameDirectory(BACKUP,backupDirectory);absent(PARK);tree(APP,candidate);fs.renameSync(APP,PARK);parked=true;return;}
    if(name==='move:backup'){perimeter();stablePointer();await noProcess();sameDirectory(PARK,candidateDirectory);sameDirectory(BACKUP,backupDirectory);absent(APP);tree(BACKUP,old);fs.renameSync(BACKUP,APP);restored=true;return;}
    if(name==='restart'){perimeter();stablePointer();await noProcess();sameDirectory(APP,backupDirectory);tree(APP,old);started=true;await platform.start(`${CONTROL}/${P.old}`);ownedProcess=capture();return;}
    if(name==='stop:owned_after_failure'){
      // If start returned an error after spawning, establish the fixed old
      // registration/kernel identity before stopping. Never stop a replacement.
      const r=registration();if(r.pid===0){await noProcess();return;}
      if(started){const now=capture();if(ownedProcess.pid!==P.pid&&!isDeepStrictEqual(now,ownedProcess))refusal();ownedProcess=now;}else checkOwned();
      await platform.stop(P.pmId);await noProcess();return;
    }
    if(name==='compensate'){
      await noProcess();stablePointer();
      if(restored){sameDirectory(APP,backupDirectory);sameDirectory(PARK,candidateDirectory);tree(APP,old);tree(PARK,candidate);absent(BACKUP);fs.renameSync(APP,BACKUP);restored=false;}
      if(parked){absent(APP);sameDirectory(PARK,candidateDirectory);sameDirectory(BACKUP,backupDirectory);tree(PARK,candidate);tree(BACKUP,old);fs.renameSync(PARK,APP);parked=false;}
      return;
    }
    if(name==='unlock'){perimeter();stablePointer();await readiness();regular(JOURNAL,0o600);if(JSON.parse(read(JOURNAL)).state!=='restored')refusal();if(fs.readdirSync(LOCK).join()!=='owner')refusal();fs.unlinkSync(`${LOCK}/owner`);fs.rmdirSync(LOCK);locked=false;return;}
    refusal();
  }
  return{signal,verify,step};
}
