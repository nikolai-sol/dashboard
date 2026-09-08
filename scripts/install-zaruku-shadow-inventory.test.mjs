import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installFixedInventory,inspectFixedInventory } from './zaruku-production-shadow-worker.mjs';
import { inventoryMain } from './install-zaruku-shadow-inventory.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-inventory-')),opened=new Map();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const resolve=name=>{const match=/^\/proc\/self\/fd\/(\d+)\/(.+)$/.exec(name);return match?path.join(opened.get(Number(match[1])),match[2]):path.join(root,name);};
  fs.mkdirSync(resolve('/var/www/dashboard'),{recursive:true});fs.mkdirSync(resolve('/var/www/.dashboard-zaruku-shadow'),{mode:0o700});
  fs.writeFileSync(resolve('/var/www/dashboard/.release-source-sha'),'a'.repeat(40)+'\n',{mode:0o644});
  const io=new Proxy(fs,{get(target,key){
    if(key==='openSync')return(name,...args)=>{const location=resolve(name),fd=fs.openSync(location,...args);opened.set(fd,location);return fd;};
    if(key==='lstatSync')return(name,...args)=>{const stat=fs.lstatSync(resolve(name),...args);return stat&&Object.assign(stat,{uid:0,gid:0});};
    if(key==='fstatSync')return(fd,...args)=>Object.assign(fs.fstatSync(fd,...args),{uid:0,gid:0});
    if(key==='fchownSync')return()=>{};
    return target[key];
  }});
  return {io,resolve};
}

test('explicit inventory installer only publishes the fixed row and compliant check is read-only',t=>{
  const f=fixture(t);const before=fs.readdirSync(f.resolve('/var/www'));
  assert.throws(()=>inspectFixedInventory(f.io));
  const installed=installFixedInventory(f.io,{uid:0,euid:0});
  assert.deepEqual(installed,inspectFixedInventory(f.io));
  assert.deepEqual(installFixedInventory(f.io,{uid:0,euid:0}),installed);
  assert.deepEqual(fs.readdirSync(f.resolve('/var/www')),before);
  assert.equal(fs.statSync(f.resolve('/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv')).mode&0o777,0o600);
});

test('inventory rejects replaced content, links, hardlinks, writable ancestry and malformed SHA',t=>{
  for(const fault of ['extra','link','hardlink','ancestor','sha']){
    const f=fixture(t);installFixedInventory(f.io,{uid:0,euid:0});
    const target=f.resolve('/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv');
    if(fault==='extra')fs.appendFileSync(target,'private\t/var/www/dashboard/.env\n');
    if(fault==='link'){fs.renameSync(target,target+'.saved');fs.symlinkSync(target+'.saved',target);}
    if(fault==='hardlink')fs.linkSync(target,target+'.linked');
    if(fault==='ancestor')fs.chmodSync(f.resolve('/var/www/dashboard'),0o777);
    if(fault==='sha')fs.writeFileSync(f.resolve('/var/www/dashboard/.release-source-sha'),'PRIVATE_SENTINEL');
    assert.throws(()=>inspectFixedInventory(f.io));
    assert.throws(()=>installFixedInventory(f.io,{uid:0,euid:0}));
  }
});

test('inventory CLI is check-only by default; installer action is explicit and no overrides exist',async()=>{
  const calls=[],adapter={check:()=>{calls.push('check');return {passed:true};},install:()=>{calls.push('install');return {passed:true};}};
  await inventoryMain([],adapter);await inventoryMain(['check'],adapter);await inventoryMain(['install'],adapter);
  assert.deepEqual(calls,['check','check','install']);
  for(const args of [['apply'],['--path=/tmp'],['install','other']])await assert.rejects(()=>inventoryMain(args,adapter));
});
