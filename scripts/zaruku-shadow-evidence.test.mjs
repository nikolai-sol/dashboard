import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { publishDecision } from './zaruku-production-shadow-worker.mjs';
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
  const f=fixture(t),result=publishDecision(f.request,f.io);assert.equal(result.path,destination);assert.equal(result.immutable,true);
  assert.equal(fs.statSync(f.resolve(destination)).mode&0o777,0o500);
  assert.equal(fs.statSync(f.resolve(destination+'/decision.json')).mode&0o777,0o400);
  assert.equal(JSON.parse(fs.readFileSync(f.resolve(destination+'/decision.json'))).decision,'NO-GO');
  assert.throws(()=>publishDecision(f.request,f.io));
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
