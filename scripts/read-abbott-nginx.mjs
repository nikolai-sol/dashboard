import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{verifyRecoveryLocalAuthority}from'./recover-abbott-activation.mjs';import{createRecoveryEvidence}from'./abbott-recovery-evidence.mjs';
import{canonicalAbbottIncludePaths}from'./runtime-release-remote.mjs';
export const NGINX_READ_REASONS=Object.freeze(['local_authority','local_source','remote_authority','source_frame','remote_import','reader','metadata','utf8','parser_ambiguity','transport','framing','cleanup','aborted','timeout','unknown']);
const refused=reason=>'ABBOTT_NGINX_READ_REFUSED reason='+(NGINX_READ_REASONS.includes(reason)?reason:'unknown')+'\n';
export function parseNginxNamesFrame(bytes){const invalid=refused('framing');if(!Buffer.isBuffer(bytes)||bytes.length>4096)return invalid;const text=bytes.toString(),r=/^ABBOTT_NGINX_READ_REFUSED reason=([a-z0-9_]+)\n$/.exec(text);if(r)return NGINX_READ_REASONS.includes(r[1])?text:invalid;try{const m=/^ABBOTT_NGINX_INCLUDES paths=(\[[^\n]*\])\n$/.exec(text);if(!m)return invalid;const paths=JSON.parse(m[1]);return canonicalAbbottIncludePaths(paths)&&JSON.stringify(paths)===m[1]?text:invalid;}catch{return invalid;}}
// Updated only with reviewed source changes; both clean HEAD blobs and executed
// working files must match. The remote command embeds these same fixed pins.
export const NGINX_SOURCE_HASHES=Object.freeze({"analysis":"283cf14d7a0dc5cdb7f801d5d186fc2d887c242b820db2b21e315b3331da143c","reader":"c6715994be7bd8918f964af2e07f42f973b34c2b21de31a15cfbd2029bb166df"});
const files={analysis:'runtime-release-remote.mjs',reader:'abbott-nginx-readonly.mjs'};
export const NGINX_READ_LOADER="import{createHash}from'node:crypto';\nlet bytes=Buffer.alloc(0),done=false,reason='remote_authority';const pins={\"analysis\":\"283cf14d7a0dc5cdb7f801d5d186fc2d887c242b820db2b21e315b3331da143c\",\"reader\":\"c6715994be7bd8918f964af2e07f42f973b34c2b21de31a15cfbd2029bb166df\"};\nconst refused=r=>'ABBOTT_NGINX_READ_REFUSED reason='+r+'\\n';\nconst finish=line=>{if(done)return;done=true;clearTimeout(timer);bytes.fill(0);process.stdout.write(line,()=>process.stdin.destroy());};\nconst timer=setTimeout(()=>finish(refused('timeout')),25000);\nfor(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>finish(refused('aborted')));\nprocess.stdin.on('error',()=>finish(refused('source_frame')));\nprocess.stdin.on('data',chunk=>{if(done){chunk.fill(0);return;}if(bytes.length+chunk.length>262144){chunk.fill(0);finish(refused('source_frame'));return;}const next=Buffer.concat([bytes,chunk]);bytes.fill(0);chunk.fill(0);bytes=next;});\nprocess.stdin.on('end',async()=>{const buffers=[];try{\nif(done||process.getuid()!==0||process.argv.length!==1||Object.keys(process.env).some(k=>k!=='UV_USE_IO_URING'||process.env[k]!=='0'))throw Error();\nreason='source_frame';const input=JSON.parse(bytes);if(!input||JSON.stringify(input)!==bytes.toString()||Object.keys(input).sort().join(',')!=='analysis,reader')throw Error();\nconst sources={};for(const key of ['analysis','reader']){if(typeof input[key]!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(input[key]))throw Error();const b=Buffer.from(input[key],'base64');buffers.push(b);if(b.toString('base64')!==input[key]||!b.length||b.length>131072||createHash('sha256').update(b).digest('hex')!==pins[key])throw Error();sources[key]=b;}\nconst url=b=>'data:text/javascript;base64,'+b.toString('base64');let reader=sources.reader.toString();const needle=\"'./runtime-release-remote.mjs'\";if(reader.split(needle).length!==2)throw Error();reader=reader.replace(needle,JSON.stringify(url(sources.analysis)));\nreason='remote_import';const m=await import(url(Buffer.from(reader))),a=await import(url(sources.analysis));if(done)return;\nreason='reader';const result=m.readAbbottNginxIncludes();let line;\nif(result&&!Array.isArray(result)&&Object.keys(result).join(',')==='reason'&&['remote_authority','reader','metadata','utf8','parser_ambiguity','cleanup'].includes(result.reason)){line=refused(result.reason);}\nelse{if(!result||Array.isArray(result)||Object.keys(result).join(',')!=='paths'||!a.canonicalAbbottIncludePaths(result.paths))throw Error();line='ABBOTT_NGINX_INCLUDES paths='+JSON.stringify(result.paths)+'\\n';}\nif(Buffer.byteLength(line)>4096)throw Error();finish(line);\n}catch{finish(refused(reason));}finally{for(const b of buffers)b.fill(0);bytes.fill(0);}});";
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
const ARGS=Object.freeze(['-T','-F','/dev/null','-o','LogLevel=ERROR','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostName=5.35.85.218','-o','HostKeyAlias=5.35.85.218','-o','User=root','-o','Port=22','-i','/Users/nafanya/.ssh/beget_ed25519','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','ProxyCommand=none','-o','ProxyJump=none','-o','CanonicalizeHostname=no','-o','UpdateHostKeys=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10','--','beget',`/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(NGINX_READ_LOADER)}`]);
const real={spawn,identity(pid){try{return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{env:{},encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']}).trim()||null;}catch(e){if(e.status===1&&!e.signal)return null;throw Error();}},kill:(pid,sig)=>process.kill(pid,sig),setTimeout,clearTimeout};
export function runNginxReadTransport(input,{platform=real,signal,onEvidence=()=>{}}={}){
 if(signal?.aborted||!Buffer.isBuffer(input)||!input.length||input.length>262144)return Promise.resolve({line:refused('transport'),exitVerified:true});
 return new Promise(resolve=>{let child,pid=null,start=null,closed=false,exit=false,settled=false,ended=false,invalid=false,termSent=false,output=Buffer.alloc(0);const timers=[];
  const identity=()=>{try{return platform.identity(pid);}catch{return undefined;}};
  const live=()=>child&&!closed&&!exit&&child.exitCode===null&&child.signalCode===null;
  const evidence=(verified=false)=>onEvidence({pid,start,exit:closed,exitVerified:verified,stage:'identity_proof'});
  const eof=()=>{try{child.stdin.end();}catch{invalid=true;}};
  const abort=()=>{invalid=true;eof();};
  const finish=()=>{if(closed)for(const timer of timers)platform.clearTimeout(timer);if(settled||!closed&&!ended)return;settled=true;
   const exitVerified=closed&&(!pid||identity()===null);try{evidence(exitVerified);}catch{invalid=true;}try{signal?.removeEventListener('abort',abort);}catch{invalid=true;}
   const line=!exitVerified?refused('cleanup'):invalid?refused('transport'):parseNginxNamesFrame(output);output.fill(0);resolve({line,exitVerified});};
  const acquire=()=>{if(start)return true;if(!Number.isSafeInteger(pid)||pid<=0||!live())return false;const value=identity();if(!value||!live())return false;start=value;evidence();return true;};
  const kill=sig=>{if(!live()||!start||identity()!==start||!live())return;try{platform.kill(pid,sig);if(sig==='SIGTERM')termSent=true;}catch{invalid=true;}};
  try{
   child=platform.spawn('/usr/bin/ssh',ARGS,{cwd:'/',env:{},stdio:['pipe','pipe','pipe']});
   child.on('close',(code,sig)=>{closed=true;exit=true;if(code!==0||sig)invalid=true;finish();});child.on('exit',()=>{exit=true;});
   child.on('error',abort);child.stdin.on('error',abort);
   child.stdout.on('data',chunk=>{if(settled||invalid||output.length+chunk.length>4096){chunk.fill(0);abort();return;}const next=Buffer.concat([output,chunk]);output.fill(0);chunk.fill(0);output=next;});
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
export async function runNginxReadWithEvidence(input,{signal,transport=runNginxReadTransport,evidence}={}){
 let line=refused('cleanup');try{evidence??=createRecoveryEvidence();const result=await transport(input,{signal,onEvidence:r=>evidence.record(r)});const summary=evidence.finish();evidence=null;if(result.exitVerified&&summary.identityCaptured&&summary.exitObserved&&summary.exitVerified)line=signal?.aborted?refused('aborted'):parseNginxNamesFrame(Buffer.from(result.line));}catch{line=refused('cleanup');}finally{input.fill(0);if(evidence)try{evidence.finish();}catch{line=refused('cleanup');}}return line;
}
export function buildNginxReadInput(sources){
 if(!sources||Object.keys(sources).sort().join(',')!=='analysis,reader')throw Error();
 const frame={};for(const key of Object.keys(files)){const b=sources[key];if(!Buffer.isBuffer(b)||!b.length||b.length>131072||createHash('sha256').update(b).digest('hex')!==NGINX_SOURCE_HASHES[key])throw Error();frame[key]=b.toString('base64');}
 const bytes=Buffer.from(JSON.stringify(frame));if(bytes.length>262144){bytes.fill(0);throw Error();}return bytes;
}
async function main(){let input,reason='local_authority';const sources=[],abort=new AbortController(),stop=()=>abort.abort();for(const name of['SIGINT','SIGTERM','SIGHUP'])process.on(name,stop);
 try{const git=verifyRecoveryLocalAuthority();git('merge-base','--is-ancestor','9fb03e3d17284c6fba6c6bbfb9edefc4797772d6','HEAD');if(fs.realpathSync(process.argv[1])!=='/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation/scripts/read-abbott-nginx.mjs'||!git('show','HEAD:scripts/read-abbott-nginx.mjs').equals(fs.readFileSync(new URL(import.meta.url))))throw Error();
  reason='local_source';const map={};for(const[key,file]of Object.entries(files)){const b=git('show','HEAD:scripts/'+file);sources.push(b);if(!b.equals(fs.readFileSync(new URL('./'+file,import.meta.url))))throw Error();map[key]=b;}
  input=buildNginxReadInput(map);reason='transport';const line=await runNginxReadWithEvidence(input,{signal:abort.signal});process.stdout.write(line);if(line.startsWith('ABBOTT_NGINX_READ_REFUSED '))process.exitCode=1;
 }catch{process.stdout.write(refused(reason));process.exitCode=1;}finally{input?.fill(0);for(const b of sources)b.fill(0);for(const name of['SIGINT','SIGTERM','SIGHUP'])process.removeListener(name,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
