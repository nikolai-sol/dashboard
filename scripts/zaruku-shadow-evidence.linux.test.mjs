import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { allocateEvidence, publishDecision, cleanupEvidence, openEvidenceLock, attestTimeoutBinary } from './zaruku-production-shadow-worker.mjs';
import { SHADOW_CONTROL_FILES, loadShadowAuthority, loadMysqlTableAuthority } from './zaruku-production-shadow-authority.mjs';
import { runProductionShadow } from './run-zaruku-production-shadow.mjs';

if(process.platform!=='linux'||process.getuid()!==0||!fs.readFileSync('/proc/mounts','utf8').split('\n').some(line=>line.split(' ')[1]==='/var/www'&&line.split(' ')[2]==='tmpfs'))throw new Error('Disposable Linux evidence fixture required');
fs.mkdirSync('/var/www/.dashboard-zaruku-shadow/evidence',{recursive:true,mode:0o700});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=path.resolve(import.meta.dirname,'..');
const shadow=loadShadowAuthority(path.join(root,'deploy/zaruku/production-shadow.json'));
const mysql=loadMysqlTableAuthority(path.join(root,'deploy/zaruku/mysql-read-tables.json'));

function verifyPublished(directory){
  const bytes=fs.readFileSync(directory+'/decision.json'),decision=JSON.parse(bytes);
  assert.equal(decision.decision,'NO-GO');assert.equal(decision.publicCutover,false);
  for(const record of decision.evidenceFiles){
    assert.equal(digest(fs.readFileSync(directory+'/'+record.name)),record.sha256,'published hash changed after survivor write');
    assert.equal(fs.statSync(directory+'/'+record.name).mode&0o777,0o400);
  }
  assert.deepEqual(fs.readdirSync(directory).sort(),[...decision.evidenceFiles.map(row=>row.name),'decision.json'].sort());
  assert.doesNotMatch(bytes.toString(),/PRIVATE_|transport|cookie|password/);
  assert.equal(fs.statSync(directory).mode&0o777,0o500);
  return digest(bytes);
}

test('publication waits for a writer surviving transport-worker death and preserves final hashes/inventory',async()=>{
  const sourceSha='a'.repeat(40),runId=randomUUID(),request={sourceSha,runId,context:{}};
  const receipt=allocateEvidence(request);request.context.evidenceIdentity=receipt.evidenceIdentity;
  const directory=`/var/www/.dashboard-zaruku-shadow/evidence/${sourceSha}-${runId}`;
  const filename=directory+'/canonical-comparison.json';
  fs.writeFileSync(filename,'{"phase":1}\n',{mode:0o600});
  const dirFd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY),fileFd=fs.openSync(filename,'r+');
  const survivor=`const fs=require('node:fs');process.on('disconnect',()=>setTimeout(()=>{fs.writeSync(6,Buffer.from('{"phase":2}\\n'),0,12,0);fs.fsyncSync(6);fs.writeFileSync(process.argv[1]+'/runtime-shas.after.tsv','combined-dashboard\\t'+'b'.repeat(40)+'\\n',{mode:0o600});fs.closeSync(6);fs.closeSync(5);process.stdout.write('finished\\n');process.exit(0)},400));process.send('ready');`;
  const launcher=`const cp=require('node:child_process');const lock=cp.spawnSync('/usr/bin/python3',['-I','-B','-c','import fcntl; fcntl.flock(5, fcntl.LOCK_EX)'],{stdio:['ignore','ignore','pipe','ignore','ignore',5]});if(lock.status!==0)process.exit(2);const child=cp.spawn(process.execPath,['-e',${JSON.stringify(survivor)},process.argv[1]],{detached:true,env:{},stdio:['ignore',1,2,'ipc','ignore',5,6]});child.on('message',()=>process.exit(0));`;
  const worker=spawn(process.execPath,['-e',launcher,directory],{env:{},stdio:['ignore','pipe','pipe','ignore','ignore',dirFd,fileFd]});
  fs.closeSync(dirFd);fs.closeSync(fileFd);
  let output='',errors='';worker.stdout.on('data',chunk=>{output+=chunk;});worker.stderr.on('data',chunk=>{errors+=chunk;});
  const closed=once(worker,'close');assert.deepEqual(await once(worker,'exit'),[0,null]);
  request.decision={decision:'NO-GO',publicCutover:false,sourceSha,steps:[],checks:{},parity:{pairedReadAttempts:1,coverageAdvancedDuringFirstPair:false,stableCanonicalComparison:false},failure:'same-snapshot parity'};
  const result=publishDecision(request);
  await closed;assert.equal(errors,'');assert.equal(output,'finished\n');
  assert.equal(result.immutable,true);
  const decision=JSON.parse(fs.readFileSync(directory+'/decision.json'));
  for(const record of decision.evidenceFiles)assert.equal(digest(fs.readFileSync(directory+'/'+record.name)),record.sha256,'published hash changed after survivor write');
  assert.deepEqual(decision.evidenceFiles.map(row=>row.name).sort(),['canonical-comparison.json','runtime-shas.after.tsv']);
  assert.equal(fs.statSync(directory).mode&0o777,0o500);
});

for(const bounded of [false,true])test(`actual worker death fences surviving writer through ${bounded?'shortened fixture 2s + 5s process-group deadline (production args asserted)':'normal descendant completion'} and publishes only sanitized NO-GO`,{timeout:30000},async()=>{
  const sourceSha=digest(Buffer.from(randomUUID())).slice(0,40),runId=randomUUID(),request={sourceSha,runId,context:{timeoutIdentity:attestTimeoutBinary()}};
  const directory=`${shadow.evidenceRoot}/${sourceSha}-${runId}`,control=`/var/www/.dashboard-zaruku-shadow/control/${sourceSha}`;
  // A source-fixture control tree in disposable tmpfs. Only the reviewed helper
  // and worker run; the verifier body is an intentionally delayed fixture.
  for(const name of SHADOW_CONTROL_FILES){const filename=path.join(control,name);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});fs.writeFileSync(filename,fs.readFileSync(path.join(root,name)),{mode:0o400});}
  const python=`import os,signal,sys,time\nd=sys.argv[1]\nf=open(d+'/canonical-comparison.json','w+b')\nos.chmod(d+'/canonical-comparison.json',0o600)\nf.write(b'{"phase":1}\\n');f.flush();os.fsync(f.fileno())\n${bounded?"signal.signal(signal.SIGTERM,signal.SIG_IGN)\nos.write(6,b'PRIVATE_LIFETIME_SENTINEL')":''}\nprint('ready',flush=True)\ntime.sleep(${bounded?9:0.7})\nf.seek(0);f.write(b'{"phase":2}\\n');f.flush();os.fsync(f.fileno())\nwith open(d+'/runtime-shas.after.tsv','w') as out:out.write('combined-dashboard\\t'+'b'*40+'\\n')\nos.chmod(d+'/runtime-shas.after.tsv',0o600)\nf.close()\nos.close(5);os.close(6)\n`;
  const fixtureNode=`import {spawn} from 'node:child_process';spawn('/usr/bin/python3',['-I','-B','-c',${JSON.stringify(python)},process.argv[2]],{env:{},stdio:['ignore',1,2,'ignore','ignore',5,6]});process.exit(0);`;
  fs.chmodSync(control+'/scripts/verify-zaruku-shadow.sh',0o600);
  fs.writeFileSync(control+'/scripts/verify-zaruku-shadow.sh',`#!/bin/bash\nset -eu\n/usr/local/bin/node --input-type=module - "$3" <<'NODE'\n${fixtureNode}\nNODE\n`);
  fs.chmodSync(control+'/scripts/verify-zaruku-shadow.sh',0o400);
  const baseline={passed:true,combinedPid:101,nginxSha256:'b'.repeat(64),foreignShas:[{name:'combined-dashboard',sha:'c'.repeat(40),identity:'100:1'}]},stopped=[];
  let closed,worker,output='',errors='',start;
  const adapter={source:()=>({sha:sourceSha,branch:'codex/fixture',clean:true}),loadAuthorities:()=>({shadow,mysql}),preflight:()=>baseline,
    allocateEvidence(){request.context.evidenceIdentity=allocateEvidence(request).evidenceIdentity;return {passed:true};},
    deploy:()=>({passed:true,sourceSha}),attest:()=>({passed:true,sourceSha,pid:123,cwd:'/var/www/dashboard-zaruku/apps/zaruku',uid:1001,gid:1001,groups:[],capabilities:'0',loopbackOnly:true,port:3002,process:'dashboard-zaruku'}),recheck:()=>baseline,
    async parity(){
      const launcher=`import fs from 'node:fs';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';const request=${JSON.stringify(request)};const m=await import(${JSON.stringify('file://'+control+'/scripts/zaruku-production-shadow-worker.mjs')});const {fd}=m.openEvidenceLock(request),command=m.verifierCommand(request),auth=fs.openSync('/dev/null','r');assert.equal(command.bin,'/usr/bin/timeout');assert.deepEqual(command.args.slice(0,2),['--kill-after=5s','180s']);${bounded?"command.args[1]='2s';":''}const child=spawn(command.bin,command.args,{detached:true,env:{PATH:'/usr/local/bin:/usr/bin:/bin',ZARUKU_SHADOW_AUTH_FD:'3',ZARUKU_SHADOW_COVERAGE_FD:'4',ZARUKU_SHADOW_LOCK_FD:'5',ZARUKU_SHADOW_WRITER_FD:'6'},stdio:['pipe',1,2,auth,'ignore',fd]});child.stdin.end(JSON.stringify({sourceSha:request.sourceSha,runId:request.runId,evidenceIdentity:request.context.evidenceIdentity}));fs.closeSync(auth);fs.closeSync(fd);`;
      start=Date.now();worker=spawn(process.execPath,['--input-type=module','-e',launcher],{env:{},stdio:['ignore','pipe','pipe']});
      worker.stdout.on('data',chunk=>{output+=chunk;});worker.stderr.on('data',chunk=>{errors+=chunk;});closed=once(worker,'close');
      const exit=once(worker,'exit');
      await Promise.race([once(worker.stdout,'data'),exit.then(()=>{throw new Error('fixture worker exited before ready');})]);
      assert.equal(output,'ready\n');worker.kill('SIGKILL');assert.deepEqual(await exit,[null,'SIGKILL']);
      throw new Error('PRIVATE_BODY transport lost with surviving writer');
    },
    cleanup:()=>cleanupEvidence(request),stop:name=>{stopped.push(name);return {passed:true};},
    writeDecision:decision=>publishDecision({...request,decision}),
  };
  for(const name of ['linuxBuildHelperFixture','linuxPrivilegeFixture','hostBoundary','runtimeSecrets','managerAuth','fullPredeploy','releaseAuthority'])adapter[name]=()=>({passed:true,sourceSha});
  adapter.dbBoundary=()=>({passed:true,tableSelectCount:35});
  const result=await runProductionShadow(adapter);await closed;
  assert.equal(result.decision,'NO-GO');assert.equal(result.failure,'same-snapshot parity');assert.deepEqual(stopped,['dashboard-zaruku']);assert.equal(errors,'');
  const published=verifyPublished(directory);
  assert.equal(fs.existsSync(directory+'/runtime-shas.after.tsv'),!bounded);
  if(bounded){assert.ok(Date.now()-start>=6900,'timeout did not retain the leader after TERM');await new Promise(resolve=>setTimeout(resolve,2500));assert.equal(verifyPublished(directory),published,'post-publication delayed write changed evidence');}
  assert.throws(()=>openEvidenceLock(request));
});

test('Linux helper rejects foreign/replaced receipts and process identity input instead of signalling it',()=>{
  const request={sourceSha:'d'.repeat(40),runId:randomUUID(),context:{}};
  request.context.evidenceIdentity=allocateEvidence(request).evidenceIdentity;
  for(const change of [{sourceSha:'e'.repeat(40)},{context:{evidenceIdentity:{dev:'0',ino:'0'}}}])assert.throws(()=>openEvidenceLock({...request,...change}));
  const directory=`${shadow.evidenceRoot}/${request.sourceSha}-${request.runId}`;
  const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{for(const processIdentity of [{pid:process.pid},{pgid:process.pid,startTime:'1'},{pid:1,startTime:'0'}]){
    const result=spawnSync('/usr/bin/python3',['-I','-B',path.join(import.meta.dirname,'zaruku-shadow-evidence-lock.py'),'acquire'],{input:JSON.stringify({sourceSha:request.sourceSha,runId:request.runId,evidenceIdentity:request.context.evidenceIdentity,...processIdentity}),env:{},stdio:['pipe','pipe','pipe','ignore','ignore',fd]});
    assert.equal(result.status,1);assert.equal(result.stdout.toString(),'');assert.equal(result.stderr.toString(),'Zaruku evidence fence failed\n');
  }}finally{fs.closeSync(fd);}
  fs.renameSync(directory,directory+'-retained');fs.mkdirSync(directory,{mode:0o700});
  assert.throws(()=>cleanupEvidence(request));assert.ok(!fs.existsSync(directory+'/decision.json'));
});
