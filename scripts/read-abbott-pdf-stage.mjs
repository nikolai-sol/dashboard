import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{verifyRecoveryLocalAuthority}from'./recover-abbott-activation.mjs';import{createRecoveryEvidence}from'./abbott-recovery-evidence.mjs';
const UNKNOWN='ABBOTT_PDF_STAGE stage=unknown class=unknown\n';
export function parsePdfStageFrame(bytes){if(!Buffer.isBuffer(bytes)||bytes.length>128)return UNKNOWN;const line=bytes.toString();return /^(?:ABBOTT_PDF_STAGE stage=(?:authorize|launch|prepare|navigate|ready|render) class=(?:Error|NonError)|ABBOTT_PDF_STAGE stage=unknown class=unknown)\n$/.test(line)?line:UNKNOWN;}
// Updated only with reviewed source changes; both clean HEAD blobs and executed
// working files must match. The remote command embeds these same fixed pins.
export const PDF_SOURCE_HASHES=Object.freeze({classifier:'3e31420298231390a4cf0c2c0a416199fd73c24dbbe35cde99f3c8230b716dac',proof:'de1b10bf23c5541fe970c6fab87ce6709455b46291c6d81db5a3c7f884e34cc4'});
const files={classifier:'abbott-pdf-log-stage.mjs',proof:'abbott-pdf-active-proof.mjs'};
export const PDF_LOG_LOADER=`import{createHash}from'node:crypto';let bytes=Buffer.alloc(0),done=false;const unknown=${JSON.stringify(UNKNOWN)},pins=${JSON.stringify(PDF_SOURCE_HASHES)};const abort=new AbortController();const finish=line=>{if(done)return;done=true;clearTimeout(timer);bytes.fill(0);process.stdout.write(line,()=>process.stdin.destroy());};const timer=setTimeout(()=>{abort.abort();finish(unknown);},25000);for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>{abort.abort();finish(unknown);});process.stdin.on('error',()=>finish(unknown));process.stdin.on('data',chunk=>{if(done){chunk.fill(0);return;}if(bytes.length+chunk.length>262144){chunk.fill(0);finish(unknown);return;}const next=Buffer.concat([bytes,chunk]);bytes.fill(0);chunk.fill(0);bytes=next;});process.stdin.on('end',async()=>{const buffers=[];try{if(done||process.getuid()!==0||process.argv.length!==1||Object.keys(process.env).some(k=>k!=='UV_USE_IO_URING'||process.env[k]!=='0'))throw Error();const input=JSON.parse(bytes);if(!input||JSON.stringify(input)!==bytes.toString()||Object.keys(input).sort().join(',')!=='classifier,proof')throw Error();const sources={};for(const key of ['classifier','proof']){if(typeof input[key]!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(input[key]))throw Error();const b=Buffer.from(input[key],'base64');buffers.push(b);if(b.toString('base64')!==input[key]||!b.length||b.length>131072||createHash('sha256').update(b).digest('hex')!==pins[key])throw Error();sources[key]=b;}const url=b=>'data:text/javascript;base64,'+b.toString('base64');let proof=sources.proof.toString();for(const[key,file]of [['classifier','abbott-pdf-log-stage.mjs']]){const needle="'./"+file+"'";if(proof.split(needle).length!==2)throw Error();proof=proof.replace(needle,JSON.stringify(url(sources[key])));}const m=await import(url(Buffer.from(proof)));const line=await m.inspectAbbottPdfStage({proof:m.createFixedPdfProof({signal:abort.signal})});if(!/^(?:ABBOTT_PDF_STAGE stage=(?:authorize|launch|prepare|navigate|ready|render) class=(?:Error|NonError)|ABBOTT_PDF_STAGE stage=unknown class=unknown)\\n$/.test(line)||abort.signal.aborted)throw Error();finish(line);}catch{finish(unknown);}finally{for(const b of buffers)b.fill(0);bytes.fill(0);}});`;
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
const ARGS=Object.freeze(['-T','-F','/dev/null','-o','LogLevel=ERROR','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostName=5.35.85.218','-o','HostKeyAlias=5.35.85.218','-o','User=root','-o','Port=22','-i','/Users/nafanya/.ssh/beget_ed25519','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','ProxyCommand=none','-o','ProxyJump=none','-o','CanonicalizeHostname=no','-o','UpdateHostKeys=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10','--','beget',`/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(PDF_LOG_LOADER)}`]);
const real={spawn,identity(pid){try{return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{env:{},encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']}).trim()||null;}catch(e){if(e.status===1&&!e.signal)return null;throw Error();}},kill:(pid,sig)=>process.kill(pid,sig),setTimeout,clearTimeout};
export function runPdfStageTransport(input,{platform=real,signal,onEvidence=()=>{}}={}){
 if(signal?.aborted||!Buffer.isBuffer(input)||!input.length||input.length>262144)return Promise.resolve({line:UNKNOWN,exitVerified:true});
 return new Promise(resolve=>{let child,pid=null,start=null,closed=false,exit=false,settled=false,ended=false,invalid=false,termSent=false,output=Buffer.alloc(0);const timers=[];
  const identity=()=>{try{return platform.identity(pid);}catch{return undefined;}};
  const live=()=>child&&!closed&&!exit&&child.exitCode===null&&child.signalCode===null;
  const evidence=(verified=false)=>onEvidence({pid,start,exit:closed,exitVerified:verified,stage:'identity_proof'});
  const eof=()=>{try{child.stdin.end();}catch{invalid=true;}};
  const abort=()=>{invalid=true;eof();};
  const finish=()=>{if(closed)for(const timer of timers)platform.clearTimeout(timer);if(settled||!closed&&!ended)return;settled=true;
   const exitVerified=closed&&(!pid||identity()===null);try{evidence(exitVerified);}catch{invalid=true;}try{signal?.removeEventListener('abort',abort);}catch{invalid=true;}
   const line=!invalid&&exitVerified?parsePdfStageFrame(output):UNKNOWN;output.fill(0);resolve({line,exitVerified});};
  const acquire=()=>{if(start)return true;if(!Number.isSafeInteger(pid)||pid<=0||!live())return false;const value=identity();if(!value||!live())return false;start=value;evidence();return true;};
  const kill=sig=>{if(!live()||!start||identity()!==start||!live())return;try{platform.kill(pid,sig);if(sig==='SIGTERM')termSent=true;}catch{invalid=true;}};
  try{
   child=platform.spawn('/usr/bin/ssh',ARGS,{cwd:'/',env:{},stdio:['pipe','pipe','pipe']});
   child.on('close',(code,sig)=>{closed=true;exit=true;if(code!==0||sig)invalid=true;finish();});child.on('exit',()=>{exit=true;});
   child.on('error',abort);child.stdin.on('error',abort);
   child.stdout.on('data',chunk=>{if(settled||invalid||output.length+chunk.length>128){chunk.fill(0);abort();return;}const next=Buffer.concat([output,chunk]);output.fill(0);chunk.fill(0);output=next;});
   child.stderr.on('data',chunk=>{chunk.fill(0);abort();});
   timers.push(platform.setTimeout(()=>{if(closed)return;abort();try{acquire();}catch{}kill('SIGTERM');},40000));
   timers.push(platform.setTimeout(()=>{if(closed)return;abort();try{acquire();}catch{}kill(termSent?'SIGKILL':'SIGTERM');},42000));
   timers.push(platform.setTimeout(()=>{if(closed)return;abort();if(termSent)kill('SIGKILL');},44000));
   timers.push(platform.setTimeout(()=>{if(closed)return;abort();ended=true;finish();},45000));
   pid=child.pid;evidence();signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted||!acquire()||identity()!==start){abort();return;}
   child.stdin.end(input);
  }catch{invalid=true;if(child)eof();else{closed=true;finish();}}
 });
}
export async function runPdfStageWithEvidence(input,{signal,transport=runPdfStageTransport,evidence}={}){
 let line=UNKNOWN;try{evidence??=createRecoveryEvidence();const result=await transport(input,{signal,onEvidence:r=>evidence.record(r)});const summary=evidence.finish();evidence=null;if(!signal?.aborted&&result.exitVerified&&summary.identityCaptured&&summary.exitObserved&&summary.exitVerified)line=parsePdfStageFrame(Buffer.from(result.line));}catch{line=UNKNOWN;}finally{input.fill(0);if(evidence)try{evidence.finish();}catch{line=UNKNOWN;}}return line;
}
export function buildPdfStageInput(sources){
 if(!sources||Object.keys(sources).sort().join(',')!=='classifier,proof')throw Error();
 const frame={};for(const key of Object.keys(files)){const b=sources[key];if(!Buffer.isBuffer(b)||!b.length||b.length>131072||createHash('sha256').update(b).digest('hex')!==PDF_SOURCE_HASHES[key])throw Error();frame[key]=b.toString('base64');}
 const bytes=Buffer.from(JSON.stringify(frame));if(bytes.length>262144){bytes.fill(0);throw Error();}return bytes;
}
async function main(){let input;const sources=[],abort=new AbortController(),stop=()=>abort.abort();for(const name of['SIGINT','SIGTERM'])process.on(name,stop);
 try{const git=verifyRecoveryLocalAuthority();git('merge-base','--is-ancestor','05afbed92c9d84f0a556960a53ed8ebf9af43e8e','HEAD');if(fs.realpathSync(process.argv[1])!==fs.realpathSync(new URL(import.meta.url))||!git('show','HEAD:scripts/read-abbott-pdf-stage.mjs').equals(fs.readFileSync(new URL(import.meta.url))))throw Error();
  const map={};for(const[key,file]of Object.entries(files)){const b=git('show','HEAD:scripts/'+file);sources.push(b);if(!b.equals(fs.readFileSync(new URL('./'+file,import.meta.url))))throw Error();map[key]=b;}
  input=buildPdfStageInput(map);const line=await runPdfStageWithEvidence(input,{signal:abort.signal});process.stdout.write(line);if(line===UNKNOWN)process.exitCode=1;
 }catch{process.stdout.write(UNKNOWN);process.exitCode=1;}finally{input?.fill(0);for(const b of sources)b.fill(0);for(const name of['SIGINT','SIGTERM'])process.removeListener(name,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
