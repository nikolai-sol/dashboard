import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';

async function moduleUnderTest() {
  try { return await import('./verify-abbott-shadow.mjs'); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}
const token = () => `${Buffer.from(JSON.stringify({ type: 'viewer', dashboard_id: 18, audience: 'manager', credential_version: 7, exp: Math.floor(Date.now()/1000)+600 })).toString('base64url')}.${'a'.repeat(43)}`;
const frame = () => Buffer.from(`manager_access_token\n${token()}\nsynthetic-embed\n`);

test('fixed issuer and forwards refuse caller authority and reusable masters', async () => {
  const api = await moduleUnderTest(); assert.equal(typeof api.fixedSshInvocation, 'function');
  for (const mode of ['issuer','forward']) {
    const invocation = api.fixedSshInvocation(mode);
    assert.equal(invocation.binary, '/usr/bin/ssh');
    for(const flag of ['beget','ControlMaster=no','ControlPath=none','BatchMode=yes','StrictHostKeyChecking=yes'])assert.ok(invocation.args.includes(flag));
    assert.ok(!invocation.args.includes('-f'));
    if (mode === 'forward') assert.deepEqual(invocation.args.filter((x,i,a)=>a[i-1]==='-L'), ['127.0.0.1:3001:127.0.0.1:3001','127.0.0.1:3004:127.0.0.1:3004']);
  }
  assert.throws(()=>api.fixedSshInvocation('other'));
});

test('orchestrator consumes issuer stdout once, uses stdin, clears buffers and closes forwards', async () => {
  const api = await moduleUnderTest(); assert.equal(typeof api.runAbbottVerification, 'function');
  const bytes=frame(), calls=[];
  const platform={ signalSource:new EventEmitter(), capsule:()=>Buffer.from('reviewed-code'), prepareOutput:()=>{},
    verifyForward:()=>{},
    openForward:async()=>({pid:4242,start:'start-proof'}), closeForward:async proof=>calls.push(['close',proof.pid]),
    issue:async()=>({status:0,stdout:bytes,stderr:Buffer.alloc(0)}),
    consume:async(mode,input)=>{assert.equal(mode,'compare');assert.equal(input,bytes);calls.push(['consume']);return {status:0,stdout:Buffer.from('status=match mismatches=0 report=created\n'),stderr:Buffer.alloc(0)};},
  };
  const result=await api.runAbbottVerification('compare',platform);
  assert.deepEqual(result,{mode:'compare',status:'passed',forward:{pid:4242,start:'start-proof',exitVerified:true}});
  assert.deepEqual(calls,[['consume'],['close',4242]]);assert.ok(bytes.every(x=>x===0));
});

test('issuer failure, secret stderr, truncation and extra frame never reach consumer or diagnostics', async () => {
  const api=await moduleUnderTest();assert.equal(typeof api.runAbbottVerification,'function');
  for(const response of [
    {status:1,stdout:frame(),stderr:Buffer.from('secret-looking-private-error')},
    {status:0,stdout:frame(),stderr:Buffer.from('secret-looking-private-error')},
    {status:0,stdout:Buffer.from('truncated-secret'),stderr:Buffer.alloc(0)},
    {status:0,stdout:Buffer.concat([frame(),Buffer.from('extra\n')]),stderr:Buffer.alloc(0)},
  ]){
    let consumes=0,closed=0;
    const platform={signalSource:new EventEmitter(),capsule:()=>Buffer.from('code'),prepareOutput:()=>{},openForward:async()=>({pid:4242,start:'proof'}),closeForward:async()=>{closed++;},issue:async()=>response,consume:async()=>{consumes++;}};
    platform.verifyForward=()=>{};
    await assert.rejects(api.runAbbottVerification('compare',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
    assert.equal(consumes,0);assert.equal(closed,1);assert.ok(response.stdout.every(x=>x===0));assert.ok(response.stderr.every(x=>x===0));
  }
});

test('interrupt and consumer failure close forwards, clear frame and remove signal handlers',async()=>{
  const api=await moduleUnderTest();assert.equal(typeof api.runAbbottVerification,'function');
  for(const interrupt of [false,true]){
    const signals=new EventEmitter(),bytes=frame();let closed=0,aborted=false;
    const platform={signalSource:signals,capsule:()=>Buffer.from('code'),prepareOutput:()=>{},openForward:async()=>({pid:4242,start:'proof'}),closeForward:async()=>{closed++;},issue:async()=>({status:0,stdout:bytes,stderr:Buffer.alloc(0)}),consume:async(mode,input,signal)=>{if(interrupt){signals.emit('SIGINT');aborted=signal.aborted;}throw Error('synthetic-secret');}};
    platform.verifyForward=()=>{};
    await assert.rejects(api.runAbbottVerification('capture',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
    assert.equal(closed,1);assert.ok(bytes.every(x=>x===0));assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);if(interrupt)assert.equal(aborted,true);
  }
});

test('captured child output is bounded, never inherited, and timed-out children exit',async()=>{
  const api=await moduleUnderTest();assert.equal(typeof api.captureBoundedChild,'function');
  const result=await api.captureBoundedChild(process.execPath,['-e','process.stdout.write("synthetic-secret");process.stderr.write("private-error")'],{input:Buffer.alloc(0),timeout:3000,maxBytes:1024});
  assert.equal(result.stdout.toString(),'synthetic-secret');assert.equal(result.stderr.toString(),'private-error');result.stdout.fill(0);result.stderr.fill(0);
  await assert.rejects(api.captureBoundedChild(process.execPath,['-e','process.stdout.write("x".repeat(2048))'],{input:Buffer.alloc(0),timeout:3000,maxBytes:1024}),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
  await assert.rejects(api.captureBoundedChild(process.execPath,['-e','setInterval(()=>{},1000)'],{input:Buffer.alloc(0),timeout:30,maxBytes:1024}),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
});

test('capsule uses the exact existing auth source and puts code only on SSH stdin',async()=>{
  const api=await moduleUnderTest();assert.equal(typeof api.buildIssuerCapsule,'function');
  const sources={bootstrapSource:fs.readFileSync(new URL('./bootstrap-abbott-host.mjs',import.meta.url)),issuerSource:fs.readFileSync(new URL('./abbott-parity-issuer.mjs',import.meta.url)),authSource:fs.readFileSync(new URL('../src/lib/access-auth.ts',import.meta.url))};
  const code=api.buildIssuerCapsule(sources);
  assert.ok(code.length<262144);assert.match(code.toString(),/runRemoteIssuer/);
  assert.ok(!code.toString().includes('synthetic-embed'));
  assert.throws(()=>api.buildIssuerCapsule({...sources,authSource:Buffer.from('wrong')}));
  assert.ok(!JSON.stringify(api.fixedSshInvocation('issuer')).includes(code.toString()));
  code.fill(0);
});

test('owned forward cleanup verifies real child exit and refuses start-identity drift',async()=>{
  const api=await moduleUnderTest();
  for(const drift of [false,true]){
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},stdio:'ignore'});
    const proof={child,pid:child.pid,start:execFileSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).trim(),buffers:[],closed:false};
    proof.exit=new Promise(resolve=>child.once('close',()=>{proof.closed=true;resolve();}));
    try{
      if(drift){proof.start='wrong-start';await assert.rejects(api.closeOwnedForward(proof));assert.equal(proof.closed,false);}
      else{await api.closeOwnedForward(proof);assert.equal(proof.closed,true);assert.throws(()=>process.kill(proof.pid,0),error=>error.code==='ESRCH');}
    }finally{if(!proof.closed){child.kill('SIGTERM');await proof.exit;}}
  }
});

test('consumer secret output and interruption while issuing are sanitized and zeroed',async()=>{
  const api=await moduleUnderTest();
  for(const interrupt of [false,true]){
    const signals=new EventEmitter(),bytes=frame(),secret=Buffer.from('secret-looking-output');let closed=0;
    const platform={signalSource:signals,capsule:()=>Buffer.from('code'),prepareOutput:()=>{},openForward:async()=>({pid:4242,start:'proof'}),closeForward:async()=>{closed++;},issue:async()=>{if(interrupt)signals.emit('SIGTERM');return{status:0,stdout:bytes,stderr:Buffer.alloc(0)};},consume:async()=>({status:0,stdout:secret,stderr:Buffer.alloc(0)})};
    platform.verifyForward=()=>{};
    await assert.rejects(api.runAbbottVerification('compare',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
    assert.equal(closed,1);assert.ok(bytes.every(x=>x===0));if(!interrupt)assert.ok(secret.every(x=>x===0));secret.fill(0);
  }
});

test('forward death during issuer, before handoff, or during consumer never produces success',async()=>{
  const api=await moduleUnderTest();
  for(const phase of ['issuer','handoff','immediate-handoff','consumer','replacement']){
    const failure=new AbortController(), signals=new EventEmitter(), bytes=frame();let consumes=0,closed=0,checks=0,aborted=false;
    const proof={pid:4242,start:'proof',failure:failure.signal};
    const platform={signalSource:signals,capsule:()=>Buffer.from('code'),prepareOutput:()=>{},openForward:async()=>proof,closeForward:async()=>{closed++;},
      verifyForward:()=>{checks++;if(phase==='replacement'&&checks>1)throw Error('different PID/listener');if(phase==='handoff'&&checks===2||phase==='immediate-handoff'&&checks===3)failure.abort();},
      issue:async()=>{if(phase==='issuer')failure.abort();return{status:0,stdout:bytes,stderr:Buffer.alloc(0)};},
      consume:async(mode,input,signal)=>{consumes++;if(phase==='consumer')failure.abort();aborted=signal.aborted;return{status:0,stdout:Buffer.from('status=match mismatches=0 report=created\n'),stderr:Buffer.alloc(0)};},
    };
    await assert.rejects(api.runAbbottVerification('compare',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
    assert.equal(consumes,phase==='consumer'?1:0);assert.equal(closed,1);assert.ok(bytes.every(byte=>byte===0));if(phase==='consumer')assert.equal(aborted,true);
  }
});

test('forward loss races pending work, waits for aborted cleanup, and clears late buffers',async()=>{
  const api=await moduleUnderTest();
  for(const phase of ['issuer','consumer']){
    const failure=new AbortController(),bytes=frame();let cleaned=false,closed=false,consumes=0;
    const response={status:0,stdout:bytes,stderr:Buffer.alloc(0)};
    const pending = signal => new Promise(resolve=>{
      signal.addEventListener('abort',()=>{setTimeout(()=>{cleaned=true;resolve(response);},5);},{once:true});
      setImmediate(()=>failure.abort());
    });
    const platform={signalSource:new EventEmitter(),capsule:()=>Buffer.from('code'),prepareOutput:()=>{},verifyForward:()=>{},
      openForward:async()=>({pid:4242,start:'proof',failure:failure.signal}),
      issue:async(code,signal)=>phase==='issuer'?pending(signal):response,
      consume:async(mode,input,signal)=>{consumes++;return pending(signal);},
      closeForward:async()=>{assert.equal(cleaned,true);closed=true;},
    };
    await assert.rejects(api.runAbbottVerification('compare',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
    assert.equal(consumes,phase==='consumer'?1:0);assert.equal(closed,true);assert.ok(bytes.every(byte=>byte===0));
  }
});

test('real owned-forward validator refuses missing listeners, failed proof and PID/start drift',async()=>{
  const api=await moduleUnderTest();
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},stdio:'ignore'});
  const proof={child,pid:child.pid,start:execFileSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).trim(),buffers:[],closed:false,failure:new AbortController().signal};
  proof.exit=new Promise(resolve=>child.once('close',()=>{proof.closed=true;resolve();}));
  try{
    for(const change of [{},{failed:true},{start:'replacement'},{pid:0}])assert.throws(()=>api.verifyOwnedForward({...proof,...change}),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
  }finally{await api.closeOwnedForward(proof);assert.equal(proof.closed,true);}
});

test('signal handlers remain installed throughout cleanup and cleanup interruption prevents success',async()=>{
  const api=await moduleUnderTest();const signals=new EventEmitter();let finished=false;
  const platform={signalSource:signals,capsule:()=>Buffer.from('code'),prepareOutput:()=>{},openForward:async()=>({pid:4242,start:'proof'}),verifyForward:()=>{},
    issue:async()=>({status:0,stdout:frame(),stderr:Buffer.alloc(0)}),consume:async()=>({status:0,stdout:Buffer.from('status=match mismatches=0 report=created\n'),stderr:Buffer.alloc(0)}),
    closeForward:async()=>{assert.equal(signals.listenerCount('SIGINT'),1);assert.equal(signals.listenerCount('SIGTERM'),1);signals.emit('SIGTERM');await new Promise(resolve=>setTimeout(resolve,5));finished=true;},
  };
  await assert.rejects(api.runAbbottVerification('compare',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);
  assert.equal(finished,true);assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);
});

test('smoke consumes bounded attestation in memory and shares forward-loss cleanup',async()=>{
  const api=await moduleUnderTest();
  for(const loss of [false,true]){
    const failure=new AbortController(),bytes=frame(),assets=Buffer.from('{"version":1}');let consumed=0,closed=0;
    const platform={signalSource:new EventEmitter(),capsule:()=>Buffer.from('code'),prepareOutput:()=>{},verifyForward:()=>{},openForward:async()=>({pid:4242,start:'proof',failure:failure.signal}),closeForward:async()=>{closed++;},
      readAssets:async()=>({status:0,stdout:assets,stderr:Buffer.alloc(0)}),issue:async()=>({status:0,stdout:bytes,stderr:Buffer.alloc(0)}),
      consume:async(mode,input,signal,attestation)=>{assert.equal(mode,'smoke');assert.equal(input,bytes);assert.equal(attestation,assets);consumed++;if(loss)failure.abort();return{status:0,stdout:Buffer.from('smoke=passed checks=40\n'),stderr:Buffer.alloc(0)};},
    };
    if(loss)await assert.rejects(api.runAbbottVerification('smoke',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);else assert.equal((await api.runAbbottVerification('smoke',platform)).status,'passed');
    assert.equal(consumed,1);assert.equal(closed,1);assert.ok(bytes.every(x=>x===0));assert.ok(assets.every(x=>x===0));
  }
});

test('failed asset attestation refuses before issuing a credential and never leaks stderr',async()=>{
  const api=await moduleUnderTest();let issued=0;const assets=Buffer.from('secret-looking'),stderr=Buffer.from('private-error');
  const platform={signalSource:new EventEmitter(),capsule:()=>Buffer.from('code'),prepareOutput:()=>{},verifyForward:()=>{},openForward:async()=>({pid:4242,start:'proof'}),closeForward:async()=>{},readAssets:async()=>({status:1,stdout:assets,stderr}),issue:async()=>{issued++;}};
  await assert.rejects(api.runAbbottVerification('smoke',platform),/^Error: ABBOTT_VERIFICATION_REFUSED$/);assert.equal(issued,0);assert.ok(assets.every(x=>x===0));assert.ok(stderr.every(x=>x===0));
});
