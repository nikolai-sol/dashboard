import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter,getEventListeners}from'node:events';
import {spawn}from'node:child_process';
import {captureBoundedChild}from'./abbott-bounded-child.mjs';
const secret='synthetic-secret https://invalid.test/?access_token=private';

test('bounded child privately brands spawn failure without reading error fields',async()=>{
  const m=await import('./abbott-bounded-child.mjs');assert.equal(typeof m.boundedChildFailureReason,'function');
  await assert.rejects(captureBoundedChild('/fixed',[],{input:Buffer.alloc(0),timeout:10,maxBytes:32,spawnChild(){throw Error(secret);}}),e=>{assert.equal(e.message,'ABBOTT_VERIFICATION_REFUSED');assert.equal(m.boundedChildFailureReason(e),'spawn');return true;});
  for(const value of [Error(secret),{reason:'stdin'},new Proxy({},{get(){throw Error(secret);}}),null])assert.equal(m.boundedChildFailureReason(value),'unknown');
});

test('real early stdin close brands EPIPE and reaps only its owned child',async()=>{
  const m=await import('./abbott-bounded-child.mjs'),input=Buffer.alloc(2*1024*1024,120);let pid;
  try{
    await assert.rejects(captureBoundedChild(process.execPath,['-e',"require('node:fs').closeSync(0);setTimeout(()=>{},30)"],{input,timeout:1000,maxBytes:1024,spawnChild:(...args)=>{const child=spawn(...args);pid=child.pid;return child;}}),e=>{assert.equal(e.message,'ABBOTT_VERIFICATION_REFUSED');assert.equal(m.boundedChildFailureReason(e),'stdin');return true;});
    assert.ok(Number.isSafeInteger(pid)&&pid>0);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  }finally{input.fill(0);}
});

for(const cause of ['spawn','stdin','stdin_throw','timeout','abort','limit'])test(`bounded child ${cause} preserves only first closed cause and zeroes streams after reaping`,async()=>{
  const m=await import('./abbott-bounded-child.mjs'),controller=new AbortController(),stdout=Buffer.from(secret),stderr=Buffer.from(secret);let closed=false,kills=0;
  const child=new EventEmitter();Object.assign(child,{stdout:new EventEmitter(),stderr:new EventEmitter(),stdin:new EventEmitter(),exitCode:null,signalCode:null});
  const close=()=>{if(closed)return;closed=true;child.exitCode=1;child.emit('close',1,null);};
  child.kill=()=>{kills++;setImmediate(close);return true;};
  child.stdin.end=()=>{if(cause==='stdin_throw')throw Error(secret);setImmediate(()=>{child.stdout.emit('data',stdout);child.stderr.emit('data',stderr);if(cause==='spawn'){child.emit('error',Error(secret));close();}if(cause==='stdin'){child.stdin.emit('error',Object.assign(Error(secret),{code:'EPIPE',reason:secret}));close();}if(cause==='abort')controller.abort();});};
  await assert.rejects(captureBoundedChild('/fixed',[],{input:Buffer.alloc(0),timeout:15,graceMs:5,maxBytes:cause==='limit'?1:1024,signal:controller.signal,spawnChild:()=>child}),e=>{assert.equal(e.message,'ABBOTT_VERIFICATION_REFUSED');assert.equal(m.boundedChildFailureReason(e),cause==='stdin_throw'?'stdin':cause);for(const k of ['message','stack','cause','code','reason'])e[k]=secret;assert.equal(m.boundedChildFailureReason(e),cause==='stdin_throw'?'stdin':cause);return true;});
  assert.equal(closed,true);assert.equal(getEventListeners(controller.signal,'abort').length,0);if(cause!=='stdin_throw'){assert.ok(stdout.every(x=>x===0));assert.ok(stderr.every(x=>x===0));}assert.ok(kills<=2);
});
