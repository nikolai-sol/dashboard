import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter}from'node:events';import{PassThrough}from'node:stream';import fs from'node:fs';import{createHash}from'node:crypto';import{spawn}from'node:child_process';
import{parsePdfStageFrame,runPdfStageTransport,runPdfStageWithEvidence,buildPdfStageInput,PDF_SOURCE_HASHES,PDF_LOG_LOADER}from'./read-abbott-pdf-stage.mjs';
const GOOD='ABBOTT_PDF_STAGE stage=ready class=Error\n',UNKNOWN='ABBOTT_PDF_STAGE stage=unknown class=unknown\n';
function fixture(){const child=new EventEmitter();Object.assign(child,{pid:99999,exitCode:null,signalCode:null,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});let live=true;const timers=[],cleared=[],calls=[],rows=[],sent=[];child.stdin.on('data',b=>sent.push(Buffer.from(b)));
 const platform={spawn(...args){calls.push(args);return child;},identity:()=>live?'Tue Sep 15 12:00:00 2026':null,kill(pid,signal){calls.push({pid,signal});if(signal==='SIGKILL')close(null,signal);},setTimeout(fn){timers.push(fn);return fn;},clearTimeout(fn){cleared.push(fn);}};
 function close(code=0,signal=null){live=false;child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);child.emit('close',code,signal);}
 return{child,platform,timers,cleared,calls,rows,sent,close,options:{platform,onEvidence:row=>rows.push(row)}};
}
test('only complete closed stage frames parse, without arbitrary fields or secret leakage',()=>{
 assert.equal(parsePdfStageFrame(Buffer.from(GOOD)),GOOD);
 for(const data of [GOOD+GOOD,GOOD.trim(),GOOD+'secret',GOOD.replace('ready','secret'),GOOD.replace('Error','unknown'),'secret', 'x'.repeat(129)])assert.equal(parsePdfStageFrame(Buffer.from(data)),UNKNOWN);
});
test('fixed SSH authority, clean env, proof and evidence precede source and successful exit',async()=>{
 const f=fixture(),input=Buffer.from('fixed-source'),pending=runPdfStageTransport(input,f.options);
 assert.equal(f.calls[0][0],'/usr/bin/ssh');const args=f.calls[0][1];for(const value of ['LogLevel=ERROR','User=root','HostName=5.35.85.218','BatchMode=yes','StrictHostKeyChecking=yes','ProxyCommand=none','ControlMaster=no','UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts'])assert.ok(args.includes(value));
 assert.deepEqual(f.calls[0][2],{cwd:'/',env:{},stdio:['pipe','pipe','pipe']});assert.ok(f.rows.some(r=>r.start));assert.equal(Buffer.concat(f.sent).toString(),'fixed-source');
 f.child.stdout.write(GOOD);f.close();assert.deepEqual(await pending,{line:GOOD,exitVerified:true});assert.ok(f.rows.at(-1).exitVerified);assert.ok(f.cleared.length>=3);
});
test('forged stdout, secret stderr, nonzero, signal and late fragment never escape',async()=>{
 for(const mode of ['forged','stderr','exit','signal','late','oversized']){const f=fixture(),pending=runPdfStageTransport(Buffer.from('source'),f.options);const chunk=Buffer.from('synthetic-secret');
  if(mode==='forged')f.child.stdout.write(chunk);else{f.child.stdout.write(GOOD);if(mode==='stderr')f.child.stderr.write(chunk);if(mode==='late')f.child.stdout.write(chunk);if(mode==='oversized')f.child.stdout.write(Buffer.alloc(200,65));}
  f.close(mode==='exit'?255:0,mode==='signal'?'SIGTERM':null);assert.deepEqual(await pending,{line:UNKNOWN,exitVerified:true});assert.ok(!JSON.stringify(f.rows).includes('synthetic-secret'));
 }
});
test('initial proof/setup failures retain cleanup deadlines, send no source and reap late close',async()=>{
 for(const mode of ['identity','evidence','signal']){const f=fixture();if(mode==='identity')f.platform.identity=()=>{throw Error('secret');};if(mode==='evidence')f.options.onEvidence=()=>{throw Error('secret');};if(mode==='signal')f.options.signal={addEventListener(){throw Error('secret');},removeEventListener(){}};
  const pending=runPdfStageTransport(Buffer.from('source'),f.options);assert.ok(f.timers.length>=3);assert.equal(f.sent.length,0);assert.equal(f.cleared.length,0);assert.ok(f.child.stdin.writableEnded);f.platform.identity=()=>null;f.close();assert.equal((await pending).line,UNKNOWN);
 }
});
test('bounded exact owned TERM/KILL, PID reuse refusal and late close observation',async()=>{
 for(const reuse of [false,true]){const f=fixture(),pending=runPdfStageTransport(Buffer.from('source'),f.options);if(reuse)f.platform.identity=()=> 'replacement';for(const fn of [...f.timers])fn();const result=await pending;assert.equal(result.line,UNKNOWN);assert.equal(result.exitVerified,!reuse);assert.equal(f.calls.filter(c=>c.signal).length,reuse?0:2);if(reuse){assert.equal(f.cleared.length,0);f.close();assert.ok(f.cleared.length>=3);}}
});
test('late ownership recovery sends TERM before KILL and never resumes source dispatch',async()=>{
 const f=fixture(),identity=f.platform.identity;f.platform.identity=()=>{throw Error('synthetic-secret');};const pending=runPdfStageTransport(Buffer.from('source'),f.options);f.timers[0]();f.platform.identity=identity;f.timers[1]();assert.equal(f.calls.filter(c=>c.signal)[0]?.signal,'SIGTERM');assert.equal(f.sent.length,0);for(const fn of f.timers.slice(2))fn();assert.equal((await pending).line,UNKNOWN);
});
test('private evidence must prove exit and is finished; source erased even on failure',async()=>{
 for(const good of [false,true]){let finished=false;const input=Buffer.from('source'),line=await runPdfStageWithEvidence(input,{evidence:{record(){},finish(){finished=true;return{identityCaptured:true,exitObserved:true,exitVerified:good};}},transport:async()=>({line:GOOD,exitVerified:good})});assert.equal(line,good?GOOD:UNKNOWN);assert.ok(finished);assert.ok(input.every(b=>b===0));}
});
test('transported source pins match committed classifier/proof bytes; worker and other extra input refused',()=>{
 const sources=Object.fromEntries([['classifier','abbott-pdf-log-stage.mjs'],['proof','abbott-pdf-active-proof.mjs']].map(([key,file])=>[key,fs.readFileSync(new URL('./'+file,import.meta.url))]));
 for(const[key,bytes]of Object.entries(sources))assert.equal(createHash('sha256').update(bytes).digest('hex'),PDF_SOURCE_HASHES[key]);
 const input=buildPdfStageInput(sources);assert.ok(input.length<262144);input.fill(0);
 for(const key of Object.keys(sources))assert.throws(()=>buildPdfStageInput({...sources,[key]:Buffer.from('synthetic-secret')}));assert.throws(()=>buildPdfStageInput({...sources,extra:Buffer.alloc(1)}));assert.throws(()=>buildPdfStageInput({...sources,worker:Buffer.alloc(1)}));
});
async function inertLoader(input,script=PDF_LOG_LOADER){
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:'/',env:{},stdio:['pipe','pipe','pipe']});const chunks=[],errors=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>errors.push(b));child.stdin.on('error',()=>{});const timer=setTimeout(()=>child.kill('SIGKILL'),3000);const closed=new Promise(resolve=>child.on('close',(status,signal)=>resolve({status,signal})));child.stdin.end(input);const result=await closed;clearTimeout(timer);assert.equal(result.status,0);assert.equal(result.signal,null);assert.equal(Buffer.concat(errors).length,0);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});const output=Buffer.concat(chunks).toString();for(const b of [...chunks,...errors])b.fill(0);return output;
}
test('actual inert loader rejects malformed, truncated, oversized and wrong-hash frames without raw stderr',async()=>{
 for(const input of ['synthetic-secret',JSON.stringify({classifier:'c2VjcmV0',worker:'c2VjcmV0',proof:'c2VjcmV0'}),'x'.repeat(262145)])assert.equal(await inertLoader(input),UNKNOWN);
});
test('actual loader with inert pinned fixture modules produces only exact closed result',async()=>{
 const sources={classifier:Buffer.from('export const unused=1;'),proof:Buffer.from(`import './abbott-pdf-log-stage.mjs';export const createFixedPdfProof=()=>({});export async function inspectAbbottPdfStage(){return ${JSON.stringify(GOOD)};}`)};
 let script='delete process.env.__CF_USER_TEXT_ENCODING;'+PDF_LOG_LOADER.replace('process.getuid()!==0','false');for(const[key,bytes]of Object.entries(sources))script=script.replace(PDF_SOURCE_HASHES[key],createHash('sha256').update(bytes).digest('hex'));
 const frame=JSON.stringify(Object.fromEntries(Object.entries(sources).map(([k,b])=>[k,b.toString('base64')])));
 assert.equal(await inertLoader(frame,script),GOOD);
 assert.equal(await inertLoader(frame.replace('{','{"classifier":"c2VjcmV0",'),script),UNKNOWN);
 assert.equal(await inertLoader(frame+'\n',script),UNKNOWN);
});
test('CLI refuses arguments and ambient authority before SSH, with only the closed line',async()=>{
 const file=new URL('./read-abbott-pdf-stage.mjs',import.meta.url).pathname;
 for(const mode of ['args','env']){
  const child=spawn(process.execPath,[file,...(mode==='args'?['synthetic-secret']:[])],{cwd:new URL('..',import.meta.url).pathname,env:mode==='env'?{HOME:'synthetic-secret'}:{},stdio:['ignore','pipe','pipe']});
  const chunks=[],errors=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>errors.push(b));const timer=setTimeout(()=>child.kill('SIGKILL'),3000);const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);assert.equal(status,1);assert.equal(Buffer.concat(chunks).toString(),UNKNOWN);assert.equal(Buffer.concat(errors).length,0);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});for(const b of [...chunks,...errors])b.fill(0);
 }
});
