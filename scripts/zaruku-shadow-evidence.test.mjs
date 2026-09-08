import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { publishDecision } from './zaruku-production-shadow-worker.mjs';
import * as worker from './zaruku-production-shadow-worker.mjs';
import { createProductionAdapter } from './zaruku-production-shadow-remote.mjs';
import { runProductionShadow } from './run-zaruku-production-shadow.mjs';
const sha='a'.repeat(40),runId='00000000-0000-4000-8000-000000000000',destination=`/var/www/.dashboard-zaruku-shadow/evidence/${sha}-${runId}`;
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-evidence-'));
  t.after(()=>{function chmod(dir){fs.chmodSync(dir,0o700);for(const row of fs.readdirSync(dir,{withFileTypes:true}))if(row.isDirectory())chmod(path.join(dir,row.name));}chmod(root);fs.rmSync(root,{recursive:true,force:true});});
  const resolve=name=>path.join(root,name);fs.mkdirSync(resolve('/var/www/.dashboard-zaruku-shadow/evidence'),{recursive:true,mode:0o700});
  const io=new Proxy(fs,{get(target,key){
    if(key==='lstatSync')return(name,...args)=>{const stat=fs.lstatSync(resolve(name),...args);return stat&&Object.assign(stat,{uid:0,gid:0});};
    if(key==='fstatSync')return(fd,...args)=>Object.assign(fs.fstatSync(fd,...args),{uid:0,gid:0});
    if(['openSync','mkdirSync','readdirSync'].includes(key))return(name,...args)=>fs[key](resolve(name),...args);
    return target[key];
  }});
  const request={sourceSha:sha,runId,context:{},decision:{decision:'NO-GO',publicCutover:false,sourceSha:sha,steps:[],checks:{},parity:{pairedReadAttempts:1,coverageAdvancedDuringFirstPair:false,stableCanonicalComparison:false},failure:'same-snapshot parity'}};
  return {root,resolve,io,request};
}
test('decision is exclusively created root-owned, fsynced and immutable with no private values',t=>{
  const f=fixture(t);assert.equal(typeof worker.allocateEvidence,'function');
  const receipt=worker.allocateEvidence(f.request,f.io);f.request.context.evidenceIdentity=receipt.evidenceIdentity;
  const result=publishDecision(f.request,f.io);assert.equal(result.path,destination);assert.equal(result.immutable,true);
  assert.equal(fs.statSync(f.resolve(destination)).mode&0o777,0o500);
  assert.equal(fs.statSync(f.resolve(destination+'/decision.json')).mode&0o777,0o400);
  assert.equal(JSON.parse(fs.readFileSync(f.resolve(destination+'/decision.json'))).decision,'NO-GO');
  assert.throws(()=>publishDecision(f.request,f.io));
});

test('allocation returns the exact run receipt and never reuses or recovers an existing directory',t=>{
  const f=fixture(t);assert.equal(typeof worker.allocateEvidence,'function');
  const receipt=worker.allocateEvidence(f.request,f.io),stat=fs.statSync(f.resolve(destination));
  assert.deepEqual(receipt,{passed:true,sourceSha:sha,runId,evidenceIdentity:{dev:String(stat.dev),ino:String(stat.ino)}});
  assert.equal(stat.mode&0o777,0o700);
  assert.throws(()=>worker.allocateEvidence(f.request,f.io));
  f.request.context.evidenceIdentity=receipt.evidenceIdentity;
  assert.throws(()=>worker.allocateEvidence(f.request,f.io));
  assert.equal(worker.requireEvidenceDirectory(f.request,f.io),destination);
  for(const change of [{sourceSha:'b'.repeat(40)},{runId:'00000000-0000-4000-8000-000000000001'},{sourceSha:'../foreign'},{context:{}}])assert.throws(()=>worker.requireEvidenceDirectory({...f.request,...change},f.io));
});

test('missing, foreign, replaced, linked, incorrectly owned or writable allocation fails closed',t=>{
  for(const fault of ['missing','unpinned','replacement','symlink','owner','mode','ancestor']){
    const f=fixture(t);assert.equal(typeof worker.allocateEvidence,'function');
    if(fault==='missing'){assert.throws(()=>worker.requireEvidenceDirectory(f.request,f.io));assert.throws(()=>publishDecision(f.request,f.io));continue;}
    const receipt=worker.allocateEvidence(f.request,f.io);f.request.context.evidenceIdentity=receipt.evidenceIdentity;
    if(fault==='unpinned')f.request.context={};
    if(['replacement','symlink'].includes(fault)){fs.renameSync(f.resolve(destination),f.resolve(destination+'-retained'));if(fault==='replacement')fs.mkdirSync(f.resolve(destination),{mode:0o700});else fs.symlinkSync(f.resolve(destination+'-retained'),f.resolve(destination));}
    if(fault==='mode')fs.chmodSync(f.resolve(destination),0o770);
    if(fault==='ancestor')fs.chmodSync(f.resolve('/var/www/.dashboard-zaruku-shadow/evidence'),0o770);
    const io=fault==='owner'?new Proxy(f.io,{get(target,key){if(key==='lstatSync')return(name,...args)=>{const stat=target.lstatSync(name,...args);return name===destination?Object.assign(stat,{uid:123}):stat;};return target[key];}}):f.io;
    assert.throws(()=>worker.requireEvidenceDirectory(f.request,io));
    assert.throws(()=>publishDecision(f.request,io));
    assert.ok(!fs.existsSync(f.resolve(destination+'/decision.json')));
  }
});

for(const fault of ['credential-read','final-context-recheck','lost-parity-response'])test(`${fault} after allocation still stops only Zaruku and publishes immutable sanitized NO-GO`,async t=>{
  const f=fixture(t),calls=[],stopped=[],requests=[];
  let allocated,publishedPath;
  const baseline={passed:true,combinedPid:101,nginxSha256:'b'.repeat(64),foreignShas:[{name:'combined-dashboard',sha:'c'.repeat(40),identity:'100:1'}]};
  const adapter=createProductionAdapter({
    source:()=>({sha,branch:'codex/reviewed',clean:true}),
    readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),
    commandRunner:(bin,args)=>{
      if(args.some(arg=>arg.endsWith('deploy-zaruku.sh')))calls.push('deploy');
      return {status:0,signal:null,stderr:'',stdout:args.includes('ls-remote')?sha+'\trefs/heads/release/zaruku\n':args.some(arg=>arg.endsWith('run-zaruku-linux-fixtures.sh'))?'linux-build-helper-fixture passed\nlinux-privilege-drop-fixture passed\nlinux-mysql-descriptor-fixture passed\n':''};
    },
    remoteRunner:async(action,request)=>{
      calls.push(action);requests.push({action,request:structuredClone(request)});
      const directory=`/var/www/.dashboard-zaruku-shadow/evidence/${request.sourceSha}-${request.runId}`;
      if(action==='preflight')return {...baseline,mysqlIdentity:{dev:'1',ino:'2',sha256:'b'.repeat(64)},inventoryIdentity:{dev:'3',ino:'4'},inventorySha256:'b'.repeat(64)};
      if(action==='allocateEvidence'){allocated=worker.allocateEvidence(request,f.io);return allocated;}
      if(action==='dbBoundary')return {passed:true,tableSelectCount:35};
      if(action==='attest')return {passed:true,sourceSha:sha,pid:123,cwd:'/var/www/dashboard-zaruku/apps/zaruku',uid:1001,gid:1001,groups:[],capabilities:'0',loopbackOnly:true,port:3002,process:'dashboard-zaruku'};
      if(action==='parity'){
        // Reproduce the old worker's allocation-before-throw path when no
        // independent receipt has been obtained by the real source adapter.
        if(!allocated)fs.mkdirSync(f.resolve(directory),{mode:0o700});
        else worker.requireEvidenceDirectory(request,f.io);
        if(fault==='credential-read')throw new Error('PRIVATE_SECRET credential read failed');
        fs.writeFileSync(f.resolve(directory+'/canonical-comparison.json'),JSON.stringify({pairedReadAttempts:1,coverageAdvancedDuringFirstPair:false,stableCanonicalComparison:true})+'\n',{mode:0o600});
        if(fault==='final-context-recheck')throw new Error('PRIVATE_HEADER final context changed');
        throw new Error('PRIVATE_BODY parity response lost after remote work');
      }
      if(action==='recheck')return baseline;
      if(action==='cleanup'){if(allocated)worker.requireEvidenceDirectory(request,f.io);return {passed:true};}
      if(action==='stop'){stopped.push('dashboard-zaruku');return {passed:true};}
      if(action==='writeDecision'){publishedPath=directory;return publishDecision(request,f.io);}
      return {passed:true};
    },
  });
  const result=await runProductionShadow(adapter);
  assert.equal(result.decision,'NO-GO');assert.equal(result.failure,'same-snapshot parity');
  assert.deepEqual(stopped,['dashboard-zaruku']);assert.ok(calls.indexOf('allocateEvidence')<calls.indexOf('deploy'));
  assert.equal(calls.filter(action=>action==='allocateEvidence').length,1);
  for(const row of requests.filter(row=>['parity','cleanup','writeDecision'].includes(row.action)))assert.deepEqual(row.request.context.evidenceIdentity,allocated.evidenceIdentity);
  const decision=JSON.parse(fs.readFileSync(f.resolve(publishedPath+'/decision.json')));
  assert.equal(decision.decision,'NO-GO');assert.equal(fs.statSync(f.resolve(publishedPath)).mode&0o777,0o500);
  assert.equal(fs.statSync(f.resolve(publishedPath+'/decision.json')).mode&0o777,0o400);
  assert.doesNotMatch(JSON.stringify([result,decision]),/PRIVATE_|credential read|response lost/);
});
test('existing unpinned directory, replaced inode and unexpected files cannot be published',t=>{
  for(const fault of ['unpinned','replacement','unexpected']){
    const f=fixture(t);fs.mkdirSync(f.resolve(destination),{mode:0o700});
    const stat=fs.statSync(f.resolve(destination));
    if(fault!=='unpinned')f.request.context.evidenceIdentity={dev:String(stat.dev),ino:String(stat.ino)};
    if(fault==='replacement')f.request.context.evidenceIdentity.ino='0';
    if(fault==='unexpected')fs.writeFileSync(f.resolve(destination+'/PRIVATE_BODY'), 'PRIVATE_SENTINEL',{mode:0o600});
    assert.throws(()=>publishDecision(f.request,f.io));assert.ok(!fs.existsSync(f.resolve(destination+'/decision.json')));
  }
});
