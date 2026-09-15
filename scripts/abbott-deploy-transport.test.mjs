import test from'node:test';import assert from'node:assert/strict';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';import{spawn,spawnSync,execFileSync}from'node:child_process';import{createHash}from'node:crypto';import fs from'node:fs';
const api=()=>import('./abbott-deploy-transport.mjs').catch(()=>({}));
const source=()=>Buffer.from('export async function run(){return {status:"COMMITTED",record:null}}');
const payload=()=>Buffer.from('{"action":"inspect"}');
const record={id:'a'.repeat(32),previousId:null,scope:'abbott',sourceSha:'b'.repeat(40),manifestDigest:'c'.repeat(64)};
function fixture(){const child=new EventEmitter();Object.assign(child,{pid:90001,exitCode:null,signalCode:null,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});let identity='Tue Sep 15 10:00:00 2026';const calls=[],timers=[],cleared=[],sent=[],evidence=[];child.stdin.on('data',b=>sent.push(Buffer.from(b).toString()));
 const platform={spawn(...args){calls.push(args);return child;},identity:()=>identity,kill(pid,sig){calls.push([pid,sig]);if(sig==='SIGKILL')close(null,sig);},setTimeout(fn,ms){timers.push({fn,ms});return fn;},clearTimeout(fn){cleared.push(fn);}};
 function close(code=0,sig=null){identity=null;child.exitCode=code;child.signalCode=sig;child.emit('exit',code,sig);child.emit('close',code,sig);}
 return{child,platform,calls,timers,cleared,sent,evidence,close,replace(){identity='Wed Sep 16 10:00:00 2026';},options:{platform,onEvidence:r=>evidence.push(r)}};
}
test('Abbott transport waits for READY plus owned identity before bounded source/payload/RUN',async()=>{
 const m=await api();assert.equal(typeof m.runAbbottDeployTransport,'function');const f=fixture(),s=source(),p=payload(),result=m.runAbbottDeployTransport(s,p,f.options);
 assert.equal(f.sent.length,0);assert.ok(f.timers.length>=4);assert.ok(f.evidence.some(r=>r.start));f.child.stdout.write('ABBOTT_DEPLOY_RE');assert.equal(f.sent.length,0);f.child.stdout.write('ADY\n');
 await new Promise(setImmediate);assert.match(f.sent.join(''),/^ABBOTT_DEPLOY_SOURCE /);assert.match(f.sent.join(''),/ABBOTT_DEPLOY_PAYLOAD /);assert.equal(f.sent.join('').split('RUN\n').length,2);
 f.child.stdout.write(m.encodeAbbottDeployResult('COMMITTED',record,m.deploymentDigest(s,p)));f.close();const r=await result;assert.equal(r.status,'COMMITTED');assert.deepEqual(r.record,record);assert.equal(r.remoteAcknowledged,true);assert.equal(r.sshExitVerified,true);assert.equal(f.evidence.at(-1).exitVerified,true);
 const [bin,args,opts]=f.calls[0];assert.equal(bin,'/usr/bin/ssh');for(const value of['LogLevel=ERROR','ProxyCommand=none','ProxyJump=none','IdentityAgent=none','ControlMaster=no','ControlPath=none','StrictHostKeyChecking=yes','HostName=5.35.85.218','User=root'])assert.ok(args.includes(value));assert.deepEqual(opts,{cwd:'/',env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});assert.ok(!args.join().includes(s.toString()));
});
test('only exact paired bounded records/ACKs are accepted; secret fields never escape',async()=>{
 const m=await api();assert.equal(typeof m.parseAbbottDeployResult,'function');const digest='d'.repeat(64),good=m.encodeAbbottDeployResult('COMMITTED',record,digest);
 assert.equal(m.parseAbbottDeployResult(good,digest).status,'COMMITTED');
 for(const bad of[good+good,good.split('\n').reverse().join('\n'),good.replace(record.id,'e'.repeat(32)),good.replace(digest,'e'.repeat(64)),good+'private token',good.replace('COMMITTED','private'),good.replace('"scope":"abbott"','"scope":"abbott","secret":"private"'),good.replace('"previousId":null','"previousId":"private"'),'private'.repeat(2000)])assert.equal(m.parseAbbottDeployResult(bad,digest),null);
 for(const badRecord of[{...record,extra:'private'},{...record,id:'private'},{...record,sourceSha:'private'},{...record,manifestDigest:'private'}])assert.throws(()=>m.encodeAbbottDeployResult('COMMITTED',badRecord,digest),e=>!e.message.includes('private'));
});
for(const mode of['stderr','forged','duplicate_ready','wrong_digest','missing_ack','nonzero','signal'])test(`transport refuses ${mode} without raw output`,async()=>{
 const m=await api();assert.equal(typeof m.runAbbottDeployTransport,'function');const f=fixture(),s=source(),p=payload(),result=m.runAbbottDeployTransport(s,p,f.options);
 if(mode==='duplicate_ready')f.child.stdout.write('ABBOTT_DEPLOY_READY\nABBOTT_DEPLOY_READY\n');else f.child.stdout.write('ABBOTT_DEPLOY_READY\n');
 await new Promise(setImmediate);if(mode==='stderr')f.child.stderr.write('private token /host/path');if(mode==='forged')f.child.stdout.write('private token');
 if(!['missing_ack','forged'].includes(mode))f.child.stdout.write(m.encodeAbbottDeployResult('COMMITTED',record,mode==='wrong_digest'?'e'.repeat(64):m.deploymentDigest(s,p)));
 f.close(mode==='nonzero'?255:0,mode==='signal'?'SIGTERM':null);const r=await result;assert.equal(r.remoteAcknowledged,false);assert.equal(r.status,'UNACKNOWLEDGED');assert.equal(r.record,null);assert.doesNotMatch(JSON.stringify(r),/private|token|\/host/);
});
for(const mode of['identity_error','identity_missing','setup_error','pid_reuse','hung','lost_ack'])test(`post-spawn ${mode} retains cleanup budgets and never guesses exit`,async()=>{
 const m=await api();assert.equal(typeof m.runAbbottDeployTransport,'function');const f=fixture();if(mode==='identity_error')f.platform.identity=()=>{throw Error('private');};if(mode==='identity_missing')f.platform.identity=()=>null;
 const signal=mode==='setup_error'?{aborted:false,addEventListener(){throw Error('private');},removeEventListener(){}}:undefined;
 const result=m.runAbbottDeployTransport(source(),payload(),{...f.options,signal});if(mode==='pid_reuse')f.replace();f.child.stdout.write('ABBOTT_DEPLOY_READY\n');if(['hung','lost_ack'].includes(mode)){await new Promise(setImmediate);assert.ok(f.sent.join('').endsWith('RUN\n'));}
 assert.ok(f.child.listenerCount('close'));assert.ok(f.child.stdout.listenerCount('data'));assert.ok(f.child.stderr.listenerCount('data'));assert.ok(f.timers.length>=4);
 for(const t of f.timers.slice())t.fn();const r=await result;assert.equal(r.status,'UNACKNOWLEDGED');assert.equal(r.remoteAcknowledged,false);
 if(['identity_error','identity_missing','pid_reuse'].includes(mode)){assert.equal(r.sshExitVerified,false);assert.equal(f.calls.filter(c=>typeof c[0]==='number').length,0);assert.equal(f.cleared.length,0);}else assert.equal(r.sshExitVerified,true);
 if(['identity_error','identity_missing','setup_error'].includes(mode))assert.equal(f.sent.length,0);
 f.close();assert.ok(f.cleared.length>=4);
});
test('signal sends ABORT without closing control early and waits for compensated ACK plus exit',async()=>{
 const m=await api();assert.equal(typeof m.runAbbottDeployTransport,'function');const f=fixture(),s=source(),p=payload(),abort=new AbortController();let settled=false;
 const pending=m.runAbbottDeployTransport(s,p,{...f.options,signal:abort.signal}).then(r=>{settled=true;return r;});f.child.stdout.write('ABBOTT_DEPLOY_READY\n');await new Promise(setImmediate);abort.abort();await Promise.resolve();assert.equal(settled,false);assert.ok(f.sent.join('').endsWith('RUN\nABORT\n'));assert.equal(f.child.stdin.writableEnded,false);
 f.child.stdout.write(m.encodeAbbottDeployResult('RESTORED',null,m.deploymentDigest(s,p)));await Promise.resolve();assert.equal(settled,false);f.close();const r=await pending;assert.equal(r.status,'RESTORED');assert.equal(r.remoteAcknowledged,true);
});
test('early result before RUN, callback write errors and abort during upload never authorize mutation success',async()=>{
 const m=await api();for(const mode of['early_result','callback_error','abort_upload']){const f=fixture(),s=source(),p=payload(),abort=new AbortController(),write=f.child.stdin.write.bind(f.child.stdin);let calls=0;
  if(mode==='callback_error')f.child.stdin.write=(b,...args)=>{if(++calls===2)throw Error('private');return write(b,...args);};
  const result=m.runAbbottDeployTransport(s,p,{...f.options,signal:abort.signal});f.child.stdout.write('ABBOTT_DEPLOY_READY\n');
  if(mode==='early_result')f.child.stdout.write(m.encodeAbbottDeployResult('COMMITTED',record,m.deploymentDigest(s,p)));if(mode==='abort_upload')abort.abort();await new Promise(setImmediate);f.close();const r=await result;assert.equal(r.remoteAcknowledged,false);assert.equal(f.sent.join('').includes('RUN\n'),false);assert.doesNotMatch(JSON.stringify(r),/private/);
 }
});
test('wire records refuse non-string scalar coercion and duplicate JSON fields',async()=>{
 const m=await api(),digest='d'.repeat(64);for(const field of['id','sourceSha','manifestDigest'])assert.throws(()=>m.encodeAbbottDeployResult('COMMITTED',{...record,[field]:[record[field]]},digest));
 const good=m.encodeAbbottDeployResult('COMMITTED',record,digest);assert.equal(m.parseAbbottDeployResult(good.replace('"scope":"abbott"','"scope":"abbott","scope":"abbott"'),digest),null);
});
test('bounds and pre-abort refuse before SSH, and late output is zeroed after a verified close',async()=>{
 const m=await api(),f=fixture(),abort=new AbortController();abort.abort();for(const [s,p,signal]of[[Buffer.alloc(0),payload()],[Buffer.alloc(1048577),payload()],[source(),Buffer.alloc(0)],[source(),payload(),abort.signal]])assert.equal((await m.runAbbottDeployTransport(s,p,{...f.options,signal})).status,'REFUSED');assert.equal(f.calls.length,0);
 const s=source(),p=payload(),pending=m.runAbbottDeployTransport(s,p,f.options);f.child.stdout.write('ABBOTT_DEPLOY_READY\n');await new Promise(setImmediate);f.close();await pending;const b=Buffer.from('private token');f.child.stdout.write(b);assert.ok(b.every(x=>x===0));
});
test('all public diagnostics remain closed even with arbitrary secret-bearing inputs',async()=>{
 const m=await api();for(const input of[{status:'private',diagnostic:{stage:'private',reason:'private'}},{status:'COMMITTED',record:{secret:'private'},diagnostic:{stage:'complete',reason:'none'},stdout:'private',stderr:'private',pid:12345}])assert.doesNotMatch(m.formatAbbottDeployResult(input),/private|12345|stdout|stderr|record/);
 for(const stage of m.DEPLOY_STAGES)for(const reason of m.DEPLOY_REASONS)assert.match(m.formatAbbottDeployResult({status:'REFUSED',diagnostic:{stage,reason}}),/^ABBOTT_DEPLOY_REFUSED stage=[a-z_]+ reason=[a-z_]+\n$/);
});
test('fixed deploy driver selects acknowledged transport only for Abbott and awaits every transfer',()=>{
 const text=fs.readFileSync(new URL('./deploy-runtime.mjs',import.meta.url),'utf8');assert.match(text,/runAbbottDeployWithEvidence/);assert.match(text,/authority\.scope\s*===?\s*'abbott'/);assert.match(text,/await transfer\(\{ action: 'inspect'/);assert.match(text,/await transfer\(\{ action,/);
});
test('actual Abbott CLI refusal is one closed line; exact capsule parses before dispatch',async()=>{
 const result=spawnSync(process.execPath,['scripts/deploy-runtime.mjs','deploy/abbott/release.json','deploy'],{cwd:new URL('..',import.meta.url),env:{APP_NAME:'private'},encoding:'utf8',timeout:3000});assert.equal(result.status,1);assert.match(result.stderr,/^ABBOTT_DEPLOY_REFUSED stage=unknown reason=unknown\n$/);assert.equal(result.stdout,'');
 const m=await import('./deploy-runtime.mjs');assert.equal(typeof m.buildAbbottDeployCapsule,'function');const {RUNTIME_MANIFESTS}=await import('../packages/runtime-contract/src/manifest.mjs');const {deriveBrowserContract}=await import('./abbott-browser-prerequisite.mjs');
 const bytes=m.buildAbbottDeployCapsule(fs.readFileSync(new URL('./runtime-release-remote.mjs',import.meta.url)),fs.readFileSync(new URL('./abbott-browser-prerequisite.mjs',import.meta.url)),deriveBrowserContract(),RUNTIME_MANIFESTS.abbott,JSON.parse(fs.readFileSync(new URL('../deploy/abbott/environment.json',import.meta.url))));assert.ok(bytes.length<=1048576);execFileSync(process.execPath,['--check','--input-type=module'],{input:bytes,env:{},stdio:['pipe','pipe','pipe'],timeout:3000});bytes.fill(0);
});
async function loader(mode,command){const m=await api();assert.equal(typeof m.ABBOTT_DEPLOY_LOADER,'string');const child=spawn(command?'/bin/sh':process.execPath,command?['-c',command.replace('/usr/bin/node',process.execPath)]:['--input-type=module','-e',m.ABBOTT_DEPLOY_LOADER],{env:{},stdio:['pipe','pipe','pipe','pipe']});const s=Buffer.from(mode==='success'?'export async function run(){return {status:"COMMITTED",record:null}}':mode==='crash'?'export async function run(){throw Error("private token")}':`import fs from'node:fs';export async function run(signal){fs.writeSync(3,'started');await new Promise(r=>signal.aborted?r():signal.addEventListener('abort',r,{once:true}));await new Promise(r=>setTimeout(r,10));return {status:${JSON.stringify(mode==='failure'?'REVIEW_REQUIRED':'RESTORED')},record:null}}`),p=payload(),out=[],err=[];let ready=false,expired=false;
 child.stdout.on('data',b=>{out.push(Buffer.from(b));if(!ready&&Buffer.concat(out).toString()==='ABBOTT_DEPLOY_READY\n'){ready=true;if(mode==='oversized'){child.stdin.end('ABBOTT_DEPLOY_SOURCE 1048577 '+'a'.repeat(64)+'\n');return;}if(mode==='truncated'){child.stdin.end('ABBOTT_DEPLOY_SOURCE 100 '+'a'.repeat(64)+'\nshort');return;}child.stdin.write(`ABBOTT_DEPLOY_SOURCE ${s.length} ${createHash('sha256').update(s).digest('hex')}\n`);child.stdin.write(s);child.stdin.write(`ABBOTT_DEPLOY_PAYLOAD ${p.length} ${createHash('sha256').update(p).digest('hex')}\n`);child.stdin.write(p);child.stdin.write('RUN\n');}});child.stderr.on('data',b=>err.push(b));child.stdin.on('error',()=>{});child.stdio[3].once('data',()=>{if(mode==='eof')child.stdin.end();else if(mode==='signal')child.kill('SIGTERM');else child.stdin.write(mode==='duplicate'?'RUN\n':'ABORT\n');});
 const deadline=setTimeout(()=>{expired=true;child.kill('SIGKILL');},3000);await new Promise(r=>child.once('close',r));clearTimeout(deadline);assert.equal(expired,false);assert.equal(Buffer.concat(err).length,0);assert.throws(()=>process.kill(child.pid,0));const result=m.parseAbbottDeployResult(Buffer.concat(out).toString().slice('ABBOTT_DEPLOY_READY\n'.length),m.deploymentDigest(s,p));s.fill(0);p.fill(0);return result;
}
test('actual loader compensates ABORT/EOF/signal and emits paired ACK only after completion',async()=>{assert.equal((await loader('success')).status,'COMMITTED');for(const mode of['abort','eof','signal'])assert.equal((await loader(mode)).status,'RESTORED');assert.equal((await loader('failure')).status,'REVIEW_REQUIRED');});
test('exact shell command preserves loader framing; malformed/reused frames or unexpected transaction throws cannot acknowledge',async()=>{
 const m=await api(),f=fixture(),result=m.runAbbottDeployTransport(source(),payload(),f.options),command=f.calls[0][1].at(-1);f.close();await result;assert.equal((await loader('success',command)).status,'COMMITTED');for(const mode of['oversized','truncated','duplicate','crash'])assert.equal(await loader(mode),null,mode);
});
