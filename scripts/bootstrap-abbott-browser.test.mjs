import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {execFileSync}from'node:child_process';
const api=()=>import('./bootstrap-abbott-browser.mjs').catch(()=>({}));
test('browser bootstrap capsule uses fixed host proof, active release, bounded child and no automatic deploy',async()=>{
  const m=await api();assert.equal(typeof m.buildBrowserBootstrapCapsule,'function');
  const sources=Object.fromEntries(['browser','proof','worker','bounded'].map(key=>[key,Buffer.from('export const fixture=true;')]));
  const code=m.buildBrowserBootstrapCapsule(sources,{fixture:true}).toString();
  assert.ok(code.indexOf('verifyAbbottBootstrapSource()')<code.indexOf('mkdirSync'));
  assert.match(code,/1fdaecbdad47430a9d1375566abad001/);assert.match(code,/captureBoundedChild/);assert.match(code,/timeout:60000/);assert.match(code,/SIGTERM/);assert.match(code,/signal:abort.signal/);
  assert.doesNotMatch(code,/apt-get|npx|pm2|nginx|\/root\/\.cache|\.transact\(/);
  assert.match(code,/process\.setgroups\(\[\]\)/);
  assert.match(code,/mkdirSync\(parent,\{mode:0o750\}\);fs\.chmodSync\(parent,0o750\)/);
});
test('bootstrap local entrypoint never accepts caller paths, environments or command actions',async()=>{
  const m=await api();assert.equal(typeof m.validateBrowserBootstrapInvocation,'function');
  assert.doesNotThrow(()=>m.validateBrowserBootstrapInvocation([],{}));
  for(const args of [['install'],['--cache-dir','/tmp'],['--force']])assert.throws(()=>m.validateBrowserBootstrapInvocation(args,{}),/ABBOTT_BROWSER_REFUSED/);
  for(const key of ['NODE_OPTIONS','NODE_PATH','GIT_CONFIG_COUNT','BROWSER_ROOT','PUPPETEER_EXECUTABLE_PATH','HTTPS_PROXY'])assert.throws(()=>m.validateBrowserBootstrapInvocation([],{[key]:'private'}),/^Error: ABBOTT_BROWSER_REFUSED$/);
});
test('bootstrap source has fixed pipe transport and verified cleanup, never browser launch or credential input',()=>{
  const source=fs.readFileSync(new URL('./bootstrap-abbott-browser.mjs',import.meta.url),'utf8');
  assert.match(source,/ControlMaster=no/);assert.match(source,/ControlPath=none/);assert.match(source,/captureBoundedChild/);
  assert.doesNotMatch(source,/\.launch\(|manager_access_token|password|createViewer/);
});

test('complete committed-module capsule parses without executing or accessing network',async()=>{
  const m=await api(),{deriveBrowserContract}=await import('./abbott-browser-prerequisite.mjs');
  const names={browser:'abbott-browser-prerequisite.mjs',proof:'bootstrap-abbott-host.mjs',worker:'runtime-release-remote.mjs',bounded:'abbott-bounded-child.mjs'};
  const sources=Object.fromEntries(Object.entries(names).map(([key,name])=>[key,fs.readFileSync(new URL(name,import.meta.url))]));
  const code=m.buildBrowserBootstrapCapsule(sources,deriveBrowserContract());
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,env:{},timeout:5000,maxBuffer:1024,stdio:['pipe','pipe','pipe']});
});
