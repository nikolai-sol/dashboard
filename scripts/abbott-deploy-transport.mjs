import{spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';
// Dedicated Abbott deploy protocol; deliberately not a configurable transport.
const hash=b=>createHash('sha256').update(b).digest('hex');
export const deploymentDigest=(source,payload)=>hash(hash(source)+':'+hash(payload));
function validRecord(r){return r===null||r&&Object.keys(r).sort().join(',')==='id,manifestDigest,previousId,scope,sourceSha'&&r.scope==='abbott'&&['id','sourceSha','manifestDigest'].every(k=>typeof r[k]==='string')&&/^[a-f0-9]{32}$/.test(r.id)&&/^[a-f0-9]{40}$/.test(r.sourceSha)&&/^[a-f0-9]{64}$/.test(r.manifestDigest)&&(r.previousId===null||typeof r.previousId==='string'&&/^[a-f0-9]{32}$/.test(r.previousId));}
export function encodeAbbottDeployResult(status,record,digest){
 if(!['COMMITTED','RESTORED','REFUSED','REVIEW_REQUIRED'].includes(status)||!validRecord(record)||status!=='COMMITTED'&&record!==null||!/^[a-f0-9]{64}$/.test(digest))throw Error('ABBOTT_DEPLOY_REFUSED');
 const canonical=record===null?null:{id:record.id,previousId:record.previousId,scope:'abbott',sourceSha:record.sourceSha,manifestDigest:record.manifestDigest};
 return `ABBOTT_DEPLOY_RESULT ${digest} ${JSON.stringify(canonical)}\nABBOTT_DEPLOY_ACK ${status} ${digest} ${record?.id??'none'}\n`;
}
export function parseAbbottDeployResult(text,digest){
 if(typeof text!=='string'||Buffer.byteLength(text)>1024)return null;
 const m=/^ABBOTT_DEPLOY_RESULT ([a-f0-9]{64}) ([^\n]+)\nABBOTT_DEPLOY_ACK (COMMITTED|RESTORED|REFUSED|REVIEW_REQUIRED) ([a-f0-9]{64}) ([a-f0-9]{32}|none)\n$/.exec(text);if(!m||m[1]!==digest||m[4]!==digest)return null;
 try{const record=JSON.parse(m[2]);if(encodeAbbottDeployResult(m[3],record,digest)!==text)return null;return{status:m[3],record};}catch{return null;}
}
export const DEPLOY_STAGES=Object.freeze(['local_spawn','identity_proof','source_write','run_write','remote_startup','ack_framing','timeout','ssh_close','local_evidence','complete','unknown']);
export const DEPLOY_REASONS=Object.freeze(['failed','unavailable','unverified','malformed','missing','oversized','stderr','deadline','nonzero','signal','none','unknown']);
export function safeDeployDiagnostic(value){return DEPLOY_STAGES.includes(value?.stage)&&DEPLOY_REASONS.includes(value?.reason)?{stage:value.stage,reason:value.reason}:{stage:'unknown',reason:'unknown'};}
export function formatAbbottDeployResult(value){const status=['COMMITTED','RESTORED','REFUSED','REVIEW_REQUIRED','UNACKNOWLEDGED'].includes(value?.status)?value.status:'UNACKNOWLEDGED';const{stage,reason}=safeDeployDiagnostic(value?.diagnostic);return`ABBOTT_DEPLOY_${status} stage=${stage} reason=${reason}\n`;}
export const ABBOTT_DEPLOY_LOADER=`import{createHash}from'node:crypto';const hash=${hash};\n${validRecord}\n${encodeAbbottDeployResult}\n`+String.raw`
const abort=new AbortController();let pending=Buffer.alloc(0),source=null,payload=null,target=null,offset=0,expected=null,phase='source_header',sourceHash=null,payloadHash=null,running=false,finished=false,protocolBad=false;
const stop=()=>abort.abort();for(const s of['SIGINT','SIGTERM','SIGHUP'])process.on(s,stop);
const timer=setTimeout(()=>{stop();if(!running)finish();},240000);
function finish(result){if(finished)return;finished=true;clearTimeout(timer);process.stdin.removeAllListeners();process.stdin.pause();for(const s of['SIGINT','SIGTERM','SIGHUP'])process.removeListener(s,stop);pending.fill(0);source?.fill(0);payload?.fill(0);target?.fill(0);let text='ABBOTT_DEPLOY_ACK REFUSED\n';try{if(!protocolBad&&result&&sourceHash&&payloadHash)text=encodeAbbottDeployResult(result.status,result.record,hash(sourceHash+':'+payloadHash));}catch{}process.stdout.write(text,()=>process.stdin.destroy());}
async function execute(){running=true;let entered=false;try{if(abort.signal.aborted)throw Error();const m=await import('data:text/javascript;base64,'+source.toString('base64'));if(abort.signal.aborted)throw Error();const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));if(!['inspect','deploy','rollback'].includes(request?.action))throw Error();entered=true;const result=await m.run(abort.signal,request);finish(result);}catch{finish(entered?null:{status:'REFUSED',record:null});}}
function invalid(){protocolBad=true;stop();if(!running)finish();}
function consume(chunk){if(finished){chunk.fill(0);return;}if(chunk.length+pending.length>1048576){chunk.fill(0);invalid();return;}const next=Buffer.concat([pending,chunk]);pending.fill(0);chunk.fill(0);pending=next;
while(pending.length&&!finished){
 if(phase.endsWith('_header')){const end=pending.indexOf(10);if(end<0){if(pending.length>128)invalid();return;}const h=pending.subarray(0,end).toString(),sourcePhase=phase==='source_header',m=(sourcePhase?/^ABBOTT_DEPLOY_SOURCE ([1-9][0-9]{0,6}) ([a-f0-9]{64})$/:/^ABBOTT_DEPLOY_PAYLOAD ([1-9][0-9]{0,8}) ([a-f0-9]{64})$/).exec(h);if(!m||Number(m[1])>(sourcePhase?1048576:536870912)){invalid();return;}target=Buffer.alloc(Number(m[1]));offset=0;expected=m[2];phase=sourcePhase?'source':'payload';const rest=Buffer.from(pending.subarray(end+1));pending.fill(0);pending=rest;
 }else if(phase==='source'||phase==='payload'){const count=Math.min(target.length-offset,pending.length);pending.copy(target,offset,0,count);offset+=count;const rest=Buffer.from(pending.subarray(count));pending.fill(0);pending=rest;if(offset===target.length){if(hash(target)!==expected){invalid();return;}if(phase==='source'){source=target;sourceHash=expected;phase='payload_header';}else{payload=target;payloadHash=expected;phase='control';}target=null;}
 }else{const end=pending.indexOf(10);if(end<0){if(pending.length>5)invalid();return;}const line=pending.subarray(0,end).toString(),rest=Buffer.from(pending.subarray(end+1));pending.fill(0);pending=rest;if(line==='ABORT'){stop();if(!running){finish();return;}}else if(line==='RUN'&&!running&&!abort.signal.aborted){void execute();}else{invalid();return;}}
}}
process.stdin.on('data',consume);process.stdin.on('end',()=>{stop();if(!running)finish();});process.stdin.on('error',()=>{stop();if(!running)finish();});process.stdout.write('ABBOTT_DEPLOY_READY\n');`;
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
const ARGS=Object.freeze(['-T','-F','/dev/null','-o','LogLevel=ERROR','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostName=5.35.85.218','-o','HostKeyAlias=5.35.85.218','-o','User=root','-o','Port=22','-i','/Users/nafanya/.ssh/beget_ed25519','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','ProxyCommand=none','-o','ProxyJump=none','-o','CanonicalizeHostname=no','-o','UpdateHostKeys=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10','--','beget',`/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(ABBOTT_DEPLOY_LOADER)}`]);
const real={spawn,identity(pid){try{const value=execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']}).trim();if(!value)throw Error();return value;}catch(e){if(e.status===1&&!e.signal)return null;throw Error('ABBOTT_DEPLOY_REFUSED');}},kill:(pid,sig)=>process.kill(pid,sig),setTimeout,clearTimeout};
export function runAbbottDeployTransport(source,payload,{signal,platform=real,onEvidence=()=>{}}={}){
 const refused={status:'REFUSED',record:null,remoteAcknowledged:false,sshExitVerified:true,diagnostic:{stage:'unknown',reason:'unknown'}};
 if(signal?.aborted||!Buffer.isBuffer(source)||!source.length||source.length>1048576||!Buffer.isBuffer(payload)||!payload.length||payload.length>536870912)return Promise.resolve(refused);
 const digest=deploymentDigest(source,payload);
 return new Promise(resolve=>{
  let child,pid=null,start=null,closed=false,exitSeen=false,settled=false,budgetEnded=false,invalid=false,aborted=false,authorized=false,ready=false,dispatched=false,runSent=false,termSent=false,phase='local_spawn',diagnostic=null,output=Buffer.alloc(0);const timers=[],headers=[];
  const note=(stage,reason)=>{diagnostic??=safeDeployDiagnostic({stage,reason});};
  const evidence=(exit=false,exitVerified=false)=>{try{onEvidence({pid,start,exit,exitVerified,stage:diagnostic?.stage??phase});}catch{invalid=true;diagnostic={stage:'local_evidence',reason:'failed'};throw Error();}};
  const identity=()=>{try{const v=platform.identity(pid);return v?{kind:'found',value:v}:{kind:'absent'};}catch{return{kind:'unknown'};}};
  const live=()=>!closed&&!exitSeen&&child.exitCode===null&&child.signalCode===null;
  const eof=()=>{try{child.stdin.end();}catch{invalid=true;}};
  const done=()=>{
   if(closed)for(const t of timers)platform.clearTimeout(t);if(settled||!closed&&!budgetEnded)return;settled=true;
   try{signal?.removeEventListener('abort',abort);}catch{invalid=true;}
   const exited=closed&&(pid===null||identity().kind==='absent');let result=exited&&!invalid&&dispatched&&runSent?parseAbbottDeployResult(output.toString(),digest):null;
   if(aborted&&result?.status==='COMMITTED')result=null;
   if(!diagnostic){if(!exited)note('ssh_close','unverified');else if(result)note('complete','none');else note('ack_framing',output.length?'malformed':'missing');}
   try{evidence(closed,exited);}catch{result=null;}output.fill(0);for(const h of headers)h.fill(0);
   resolve({status:result?.status??'UNACKNOWLEDGED',record:result?.record??null,remoteAcknowledged:Boolean(result),sshExitVerified:exited,diagnostic});
  };
  const abort=()=>{if(aborted||settled)return;aborted=true;if(!runSent){eof();return;}try{child.stdin.write('ABORT\n');}catch{invalid=true;eof();}};
  const acquire=()=>{if(start)return true;if(!Number.isSafeInteger(pid)||pid<=0||!live())return false;const p=identity();if(p.kind!=='found'||!live())return false;start=p.value;evidence();return true;};
  const terminate=sig=>{if(!start||!live())return false;const p=identity();if(p.kind!=='found'||p.value!==start||!live())return false;try{platform.kill(pid,sig);return true;}catch{invalid=true;return false;}};
  const failedSetup=()=>{invalid=true;eof();if(!start&&!closed)timers.push(platform.setTimeout(()=>{if(!settled)try{acquire();}catch{}},1000));};
  const dispatch=()=>{
   if(!ready||!authorized||dispatched||invalid||aborted||settled)return;
   try{const p=identity();if(!live()||p.kind!=='found'||p.value!==start){note('identity_proof','unverified');failedSetup();return;}evidence();dispatched=true;phase='source_write';
    const frame=(label,b)=>{const h=Buffer.from(`ABBOTT_DEPLOY_${label} ${b.length} ${hash(b)}\n`);headers.push(h);return[h,b];};const parts=[...frame('SOURCE',source),...frame('PAYLOAD',payload)];
    const write=i=>{try{if(invalid||aborted||settled||!live())return;if(i===parts.length){phase='run_write';runSent=true;child.stdin.write('RUN\n',e=>{if(e){invalid=true;note('run_write','failed');eof();}});return;}child.stdin.write(parts[i],e=>{if(e){invalid=true;note('source_write','failed');eof();}else write(i+1);});}catch{note(phase,'failed');failedSetup();}};write(0);
   }catch{note(phase,'failed');failedSetup();}
  };
  try{
   child=platform.spawn('/usr/bin/ssh',ARGS,{cwd:'/',env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
   child.on('close',(code,sig)=>{closed=true;exitSeen=true;if(code!==0||sig){invalid=true;note('ssh_close',sig?'signal':'nonzero');}done();});child.on('exit',()=>{exitSeen=true;});
   child.stdout.on('data',b=>{if(settled){b.fill(0);return;}if(ready&&!runSent){b.fill(0);invalid=true;note('ack_framing','malformed');abort();return;}if(output.length+b.length>1024){b.fill(0);invalid=true;note('ack_framing','oversized');abort();return;}const next=Buffer.concat([output,b]);output.fill(0);b.fill(0);output=next;if(!ready){const marker=Buffer.from('ABBOTT_DEPLOY_READY\n');if(output.length>marker.length||!marker.subarray(0,output.length).equals(output)){invalid=true;note('ack_framing','malformed');abort();return;}if(output.length===marker.length){ready=true;output.fill(0);output=Buffer.alloc(0);dispatch();}}});
   child.stderr.on('data',b=>{b.fill(0);if(settled)return;invalid=true;note('remote_startup','stderr');abort();});child.on('error',()=>{invalid=true;note('local_spawn','failed');abort();});child.stdin.on('error',()=>{invalid=true;note(phase==='run_write'?'run_write':'source_write','failed');eof();});
   const cleanupProof=()=>{try{acquire();}catch{}};
   timers.push(platform.setTimeout(()=>{if(!closed){note('timeout','deadline');abort();}},240000));
   timers.push(platform.setTimeout(()=>{if(!closed){invalid=true;abort();cleanupProof();termSent=terminate('SIGTERM');}},540000));
   timers.push(platform.setTimeout(()=>{if(!closed){invalid=true;abort();cleanupProof();if(termSent)terminate('SIGKILL');else termSent=terminate('SIGTERM');}},600000));
   timers.push(platform.setTimeout(()=>{if(!closed){invalid=true;budgetEnded=true;eof();done();}},605000));
   pid=Number.isSafeInteger(child.pid)&&child.pid>0?child.pid:null;phase='identity_proof';evidence();signal?.addEventListener('abort',abort,{once:true});
   if(!acquire()){note('identity_proof','unavailable');failedSetup();return;}if(signal?.aborted){failedSetup();return;}authorized=true;dispatch();
  }catch{invalid=true;note(phase,phase==='identity_proof'?'unavailable':'failed');if(child)failedSetup();else{closed=true;done();}}
 });
}
