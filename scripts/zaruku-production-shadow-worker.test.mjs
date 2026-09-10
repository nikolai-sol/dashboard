import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runShadowWorker, validateInventory, inspectFixedInventory, attestLiveProcess, createMysqlAdapters, bindReadOnlySql, sanitizeDecision } from './zaruku-production-shadow-worker.mjs';

const sha='a'.repeat(40), runId='00000000-0000-4000-8000-000000000000';
const authority=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'../deploy/zaruku/production-shadow.json')));
test('foreign SHA observation accepts a stable legacy-owned directory, not unsafe files or ancestors',()=>{
  const files=new Map([[authority.otherRuntimeShas,Buffer.from('combined-dashboard\t/var/www/dashboard/.release-source-sha\n')],['/var/www/dashboard/.release-source-sha',Buffer.from(sha+'\n')]]);
  const changes=new Map();
  const stat=name=>({dev:1,ino:name.length,uid:name==='/var/www/dashboard'?501:0,gid:name==='/var/www/dashboard'?50:0,mode:files.has(name)?(name===authority.otherRuntimeShas?0o600:0o644):0o755,nlink:1,size:files.get(name)?.length??0,mtimeMs:1,ctimeMs:1,isDirectory:()=>!files.has(name),isFile:()=>files.has(name),...changes.get(name)});
  const io={constants:fs.constants,lstatSync:stat,openSync:name=>name,fstatSync:stat,readFileSync:name=>files.get(name),closeSync:()=>{}};
  assert.equal(inspectFixedInventory(io).foreignShas[0].sha,sha);
  for(const [name,change]of [['/var/www',{uid:501}],['/var/www/dashboard',{mode:0o777}],['/var/www/dashboard',{isDirectory:()=>false}],['/var/www/dashboard/.release-source-sha',{uid:501}],[authority.otherRuntimeShas,{uid:501}]]){
    changes.set(name,change);assert.throws(()=>inspectFixedInventory(io));changes.clear();
  }
});
test('inventory accepts only the committed combined-dashboard row and no secret/path overrides',()=>{
  const valid='combined-dashboard\t/var/www/dashboard/.release-source-sha\n';
  assert.deepEqual(validateInventory(Buffer.from(valid),authority),authority.otherRuntimeShaEntries);
  for(const text of ['',valid+valid,valid.replace('combined-dashboard','other'),valid.replace('.release-source-sha','.env'),valid.replace('/dashboard/','/dashboard-abbott/'),valid.trim()])assert.throws(()=>validateInventory(Buffer.from(text),authority),/inventory/i);
});

test('live identity checks exact kernel IDs, groups, effective privilege and loopback owner without asserting PM2 bounding capabilities',()=>{
  const status='Uid:\t901\t901\t901\t901\nGid:\t902\t902\t902\t902\nGroups:\t902\nCapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\nCapAmb:\t00000000\nCapBnd:\tffffffff\nNoNewPrivs:\t0\n';
  const values={processes:[{name:'dashboard-zaruku',pid:123}],account:{uid:901,gid:902},status,cwd:'/var/www/dashboard-zaruku/apps/zaruku',listeners:[{host:'127.0.0.1',port:3002,pid:123}],sourceSha:sha};
  const good=attestLiveProcess(values,sha);assert.equal(good.capabilities,'0');assert.deepEqual(good.groups,[]);assert.equal(good.pid,123);
  for(const changes of [{status:status.replace('901\t901','0\t901')},{status:status.replace('Groups:\t902','Groups:\t0 902')},{status:status.replace('CapPrm:\t00000000','CapPrm:\t00000001')},{listeners:[{host:'0.0.0.0',port:3002,pid:123}]},{listeners:[{host:'127.0.0.1',port:3002,pid:999}]},{sourceSha:'b'.repeat(40)},{cwd:'/var/www/dashboard'}])assert.throws(()=>attestLiveProcess({...values,...changes},sha),/attestation/i);
});

test('fixed MySQL adapter passes secret input only to inherited stdin and returns sanitized driver errors',async()=>{
  const calls=[];const identity={dev:'1',ino:'2',sha256:'b'.repeat(64)};
  const runner=(bin,args,options)=>{calls.push({bin,args,options});return {status:0,signal:null,stdout:Buffer.from('{"rows":[{"currentUser":"dashboard_zaruku_reader@127.0.0.1"}]}'),stderr:Buffer.alloc(0)};};
  const {reader}=createMysqlAdapters(identity,'PRIVATE_PASSWORD_SENTINEL',runner);
  assert.deepEqual(await reader.query('SELECT CURRENT_USER() AS currentUser'),[{currentUser:'dashboard_zaruku_reader@127.0.0.1'}]);
  assert.equal(calls[0].bin,'/usr/bin/python3');assert.deepEqual(calls[0].options.env,{});assert.ok(calls[0].options.input.includes('PRIVATE_PASSWORD_SENTINEL'));
  assert.doesNotMatch(JSON.stringify([calls[0].args,calls[0].options.env]),/PRIVATE_PASSWORD_SENTINEL/);
  assert.equal(calls[0].options.timeout,10000);
  const {reader:bad}=createMysqlAdapters(identity,'PRIVATE_PASSWORD_SENTINEL',()=>({status:1,stderr:Buffer.from('PRIVATE_PASSWORD_SENTINEL'),stdout:Buffer.from('PRIVATE_ROW_SENTINEL')}));
  await assert.rejects(()=>bad.query('SELECT CURRENT_USER() AS currentUser'),error=>error.message==='Zaruku MySQL check failed');
});

test('read-only parameter binding never inserts SQL syntax or authorizes apply',()=>{
  assert.equal(bindReadOnlySql('SELECT ?',['x\'; DROP TABLE x; --']), 'SELECT CONVERT(0x78273b2044524f50205441424c4520783b202d2d USING utf8mb4)');
  for(const sql of ['DROP USER x','CREATE USER x','GRANT SELECT ON x TO y','SELECT ?; DROP TABLE x'])assert.throws(()=>bindReadOnlySql(sql,[]),/MySQL/i);
});

test('worker has no apply, cutover, release-ref or path action and suppresses raw adapter diagnostics',async()=>{
  let called=false;
  for(const action of ['apply','nginx','installSecrets','deploy','release','/tmp'])await assert.rejects(()=>runShadowWorker(action,{sourceSha:sha,runId,context:{}},{[action]:()=>{called=true;}}),/worker/i);
  assert.equal(called,false);
  await assert.rejects(()=>runShadowWorker('managerAuth',{sourceSha:sha,runId,context:{}},{managerAuth:()=>{throw new Error('PRIVATE_SENTINEL');}}),error=>error.message==='Zaruku shadow worker check failed');
});

test('decision writer rejects body/header/secret additions and unknown failure labels',()=>{
  const evidence={decision:'NO-GO',publicCutover:false,sourceSha:sha,steps:[],checks:{},parity:{pairedReadAttempts:1,coverageAdvancedDuringFirstPair:false,stableCanonicalComparison:false},failure:'same-snapshot parity'};
  assert.deepEqual(sanitizeDecision(evidence,sha),evidence);
  for(const value of [{...evidence,body:'PRIVATE_SENTINEL'},{...evidence,failure:'PRIVATE_SENTINEL'},{...evidence,checks:{PRIVATE_SENTINEL:'pass'}},{...evidence,publicCutover:true}])assert.throws(()=>sanitizeDecision(value,sha),/evidence/i);
});

test('attested verifier uses built-ins and inherited auth/XLSX bytes without credential temp copies',()=>{
  const verifier=fs.readFileSync(path.join(import.meta.dirname,'verify-zaruku-shadow.sh'),'utf8');
  assert.doesNotMatch(verifier,/from "(?!node:)[^"]+"|AUTH_FILE|auth descriptor copy|TMP_DIR/);
  assert.match(verifier,/spawnSync\('\/usr\/bin\/python3'/);
  assert.match(verifier,/writerFence \? \['pipe', 'pipe', 'pipe', 'ignore', 'ignore', 5, 6\]/);
  assert.match(verifier,/production evidence requires writer fence/);
});

test('verifier uses independently bounded inherited fencing without caller PID or recovery killing',()=>{
  const source=fs.readFileSync(path.join(import.meta.dirname,'zaruku-production-shadow-worker.mjs'),'utf8');
  const helper=fs.readFileSync(path.join(import.meta.dirname,'zaruku-shadow-evidence-lock.py'),'utf8');
  assert.match(source,/detached:true/);
  assert.doesNotMatch(source,/child\.kill\(|process\.kill\(|terminateVerifier|kill\(-/);
  assert.doesNotMatch(helper,/os\.kill|killpg|start_new_session|shell=True/);
  assert.match(helper,/pass_fds=\(3, 4, 5, 6\)/);
  assert.match(helper,/while os\.read\(reader, 65536\)/);
});
