import {spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{parseRecoveryAck,safeRecoveryDiagnostic,classifyStartupStderr}from'./abbott-recovery-diagnostics.mjs';
// Recovery-only transport. No credential protocol and no caller host/command.
export const RECOVERY_LOADER=String.raw`import{createHash}from'node:crypto';
const abort=new AbortController();let bytes=Buffer.alloc(0),source=null,length=null,digest=null,running=false,finished=false;
const stop=()=>abort.abort();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,stop);
const timer=setTimeout(()=>{stop();if(!running)finish('REFUSED','timeout','deadline');},90000);
function finish(status,stage='ack_framing',reason='malformed'){if(finished)return;finished=true;clearTimeout(timer);process.stdin.removeAllListeners();process.stdin.pause();for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(s,stop);bytes.fill(0);source?.fill(0);process.stdout.write('ABBOTT_RECOVERY_ACK '+status+' '+stage+' '+reason+'\n',()=>process.stdin.destroy());}
async function execute(){running=true;let phase='remote_startup';try{if(abort.signal.aborted)throw Error();const m=await import('data:text/javascript;base64,'+source.toString('base64'));if(abort.signal.aborted)throw Error();phase='remote_preflight';const result=await m.run(abort.signal);if(result!=='ABBOTT_RECOVERY_RESTORED')throw Error();finish('RESTORED','complete','none');}catch(e){if(e?.message==='ABBOTT_RECOVERY_REVIEW_REQUIRED')finish('REVIEW_REQUIRED','remote_recovery','review_required');else finish('REFUSED',phase,phase==='remote_startup'?'failed':'refused');}}
function consume(chunk){if(finished){chunk.fill(0);return;}if(bytes.length+chunk.length>1048832){chunk.fill(0);stop();if(!running)finish('REFUSED');return;}const next=Buffer.concat([bytes,chunk]);bytes.fill(0);chunk.fill(0);bytes=next;
if(length===null){const end=bytes.indexOf(10);if(end<0){if(bytes.length>128)finish('REFUSED');return;}const header=bytes.subarray(0,end).toString(),match=/^ABBOTT_RECOVERY_SOURCE ([1-9][0-9]{0,6}) ([a-f0-9]{64})$/.exec(header);if(!match||Number(match[1])>1048576){finish('REFUSED');return;}length=Number(match[1]);digest=match[2];const rest=Buffer.from(bytes.subarray(end+1));bytes.fill(0);bytes=rest;}
if(source===null){if(bytes.length<length)return;source=Buffer.from(bytes.subarray(0,length));const rest=Buffer.from(bytes.subarray(length));bytes.fill(0);bytes=rest;if(createHash('sha256').update(source).digest('hex')!==digest){finish('REFUSED');return;}}
while(bytes.length){const end=bytes.indexOf(10);if(end<0){if(bytes.length>5){stop();if(!running)finish('REFUSED');}return;}const line=bytes.subarray(0,end).toString(),rest=Buffer.from(bytes.subarray(end+1));bytes.fill(0);bytes=rest;if(line==='ABORT'){stop();if(!running){finish('REFUSED');return;}}else if(line==='RUN'&&!running&&!abort.signal.aborted){void execute();}else{stop();if(!running)finish('REFUSED');return;}}
}
process.stdin.on('data',consume);process.stdin.on('end',()=>{stop();if(!running)finish('REFUSED');});process.stdin.on('error',()=>{stop();if(!running)finish('REFUSED');});process.stdout.write('ABBOTT_RECOVERY_READY\n');`;
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
const ARGS=Object.freeze(['-T','-F','/dev/null','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostName=5.35.85.218','-o','HostKeyAlias=5.35.85.218','-o','User=root','-o','Port=22','-i','/Users/nafanya/.ssh/beget_ed25519','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','ProxyCommand=none','-o','ProxyJump=none','-o','CanonicalizeHostname=no','-o','UpdateHostKeys=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=10','--','beget',`/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(RECOVERY_LOADER)}`]);
const real={spawn,identity(pid){try{const value=execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']}).trim();if(!value)throw Error();return value;}catch(error){if(error.status===1&&!error.signal)return null;throw Error('ABBOTT_SSH_IDENTITY_UNAVAILABLE');}},kill:(pid,signal)=>process.kill(pid,signal),setTimeout,clearTimeout};
const STARTUP_COMMANDS=Object.freeze({ssh:'/usr/bin/env -i /bin/true',node:`/usr/bin/env -i /usr/bin/node -e ${quote('process.stdout.write("ABBOTT_STARTUP_NODE_OK\\n")')}`,loader:ARGS.at(-1)});
const STARTUP_OUTPUTS=Object.freeze({ssh:'',node:'ABBOTT_STARTUP_NODE_OK\n',loader:'ABBOTT_RECOVERY_READY\nABBOTT_RECOVERY_ACK REFUSED ack_framing malformed\n'});
export function runRecoveryStartupStage(stage,options={}){
  if(!Object.hasOwn(STARTUP_COMMANDS,stage))return Promise.resolve({status:'ABBOTT_RECOVERY_REFUSED',remoteAcknowledged:false,sshExitVerified:true,startup:{stage:'unknown',result:'unexpected_output',category:'none'}});
  return runFixedTransport(null,options,stage);
}
export function runRecoveryTransport(source,options={}){return runFixedTransport(source,options);}
function runFixedTransport(source,{signal,platform=real,onEvidence=()=>{}}={},startupStage=null){
  const refused={status:'ABBOTT_RECOVERY_REFUSED',remoteAcknowledged:false,sshExitVerified:true,pid:null,start:null,diagnostic:{stage:'unknown',reason:'unknown'}};
  if(signal?.aborted||!startupStage&&(!Buffer.isBuffer(source)||!source.length||source.length>1048576))return Promise.resolve({...refused,...(startupStage?{startup:{stage:startupStage,result:'cleanup_unverified',category:'none'}}:{})});
  return new Promise(resolve=>{
    let child,pid,start,settled=false,closed=false,exitSeen=false,budgetEnded=false,aborted=false,invalid=false,dispatched=false,termSent=false,ready=false,authorized=false,badExit=false,deadlineReached=false;
    let output=Buffer.alloc(0),stderr=Buffer.alloc(0),stderrOversized=false,header,diagnostic=null,phase='local_spawn';const timers=[];
    const note=(stage,reason)=>{diagnostic??=safeRecoveryDiagnostic({stage,reason});};
    const evidence=(exit=false,exitVerified=false)=>{try{onEvidence({pid:pid??null,start:start??null,exit,exitVerified,stage:diagnostic?.stage??phase});}catch{invalid=true;diagnostic={stage:'local_evidence',reason:'failed'};throw Error();}};
    const validPid=()=>Number.isSafeInteger(pid)&&pid>0;
    const readIdentity=()=>{try{const value=platform.identity(pid);return value?{kind:'found',value}:{kind:'absent'};}catch{return{kind:'unknown'};}};
    const liveChild=()=>!closed&&!exitSeen&&child.exitCode===null&&child.signalCode===null;
    const closeInput=()=>{try{child.stdin.end();}catch{invalid=true;}};
    const clearAfterClose=()=>{if(!closed)return;for(const timer of timers)platform.clearTimeout(timer);};
    const done=()=>{
      // A live child cannot shorten its observation budget through any catch,
      // identity failure, PID mismatch or failed kill. Late close still reaps.
      clearAfterClose();if(settled||!closed&&!budgetEnded)return;
      settled=true;try{signal?.removeEventListener('abort',abort);}catch{invalid=true;}
      const exited=closed&&(!validPid()||readIdentity().kind==='absent');
      let startup;
      if(startupStage){
        const category=stderrOversized?'unknown':classifyStartupStderr(stderr);
        const result=!exited||diagnostic?.stage==='local_evidence'?'cleanup_unverified':badExit?'exit_nonzero':deadlineReached?'timeout':stderr.length||stderrOversized?category==='unknown'?'stderr_unknown':'stderr_known_category':invalid||!authorized||output.toString()!==STARTUP_OUTPUTS[startupStage]?'unexpected_output':'clean';
        startup={stage:startupStage,result,category:result==='stderr_known_category'?category:'none'};
      }
      const match=exited&&!invalid&&(startupStage?(startup.result==='clean'?{status:'ABBOTT_RECOVERY_RESTORED',diagnostic:{stage:'complete',reason:'none'}}:null):parseRecoveryAck(output.toString()));
      if(!diagnostic){if(!exited)note('ssh_close','unverified');else if(match)diagnostic=match.diagnostic;else note('ack_framing',output.length?'malformed':'missing');}
      if(diagnostic.stage==='remote_startup'&&diagnostic.reason==='stderr')diagnostic={stage:'remote_startup',reason:stderrOversized?'unknown':classifyStartupStderr(stderr)};
      try{evidence(closed,exited);}catch{}
      if(startup&&diagnostic.stage==='local_evidence')startup={stage:startupStage,result:'cleanup_unverified',category:'none'};
      output.fill(0);stderr.fill(0);header?.fill(0);
      resolve({status:match&&!invalid?match.status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',remoteAcknowledged:Boolean(match&&!invalid),sshExitVerified:exited,pid:pid??null,start:start??null,diagnostic,...(startup?{startup}:{})});
    };
    const abort=()=>{if(aborted||settled)return;aborted=true;if(!dispatched){closeInput();return;}try{child.stdin.write('ABORT\n');}catch{invalid=true;closeInput();}};
    const acquire=()=>{
      if(start)return true;if(!validPid()||!liveChild())return false;
      const proof=readIdentity();if(proof.kind!=='found'||!liveChild())return false;
      start=proof.value;evidence();return true;
    };
    const terminate=sig=>{
      if(!start||!liveChild())return false;const proof=readIdentity();
      if(proof.kind!=='found'||proof.value!==start||!liveChild())return false;
      try{platform.kill(pid,sig);return true;}catch{invalid=true;return false;}
    };
    const failedSetup=()=>{invalid=true;closeInput();if(!start&&!closed)timers.push(platform.setTimeout(()=>{if(!settled)try{acquire();}catch{}},1000));};
    const dispatch=()=>{
      if(!ready||!authorized||dispatched||invalid||aborted||settled)return;
      try{
        const proof=readIdentity();if(!liveChild()||proof.kind!=='found'||proof.value!==start){note('identity_proof','unverified');failedSetup();return;}
        evidence();dispatched=true;header=Buffer.from(`ABBOTT_RECOVERY_SOURCE ${source.length} ${createHash('sha256').update(source).digest('hex')}\n`);
        phase='source_write';const writeError=(error,stage)=>{if(error){invalid=true;note(stage,'failed');closeInput();}};
        child.stdin.write(header,error=>{header.fill(0);writeError(error,'source_write');});child.stdin.write(source,error=>writeError(error,'source_write'));
        if(signal?.aborted)abort();else{phase='run_write';child.stdin.write('RUN\n',error=>writeError(error,'run_write'));}
      }catch{invalid=true;note(phase,phase==='identity_proof'?'unavailable':'failed');failedSetup();}
    };
    try{
      child=platform.spawn('/usr/bin/ssh',startupStage?[...ARGS.slice(0,-1),STARTUP_COMMANDS[startupStage]]:ARGS,{cwd:'/',env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
      // Install bounded drains, exit observation and the entire cleanup budget
      // before reading PID metadata, calling ps, or shared setup/dispatch code.
      child.on('close',(code,childSignal)=>{closed=true;exitSeen=true;if(code!==0||childSignal){invalid=true;badExit=true;note('ssh_close',childSignal?'signal':'nonzero');}done();});
      child.on('exit',()=>{exitSeen=true;});
      child.stdout.on('data',chunk=>{if(settled){chunk.fill(0);return;}if(output.length+chunk.length>128){invalid=true;note('ack_framing','oversized');chunk.fill(0);abort();return;}const next=Buffer.concat([output,chunk]);output.fill(0);chunk.fill(0);output=next;
        if(startupStage){if(startupStage==='loader'&&!ready){const marker=Buffer.from('ABBOTT_RECOVERY_READY\n');if(!marker.subarray(0,Math.min(marker.length,output.length)).equals(output.subarray(0,marker.length))){invalid=true;note('ack_framing','malformed');abort();return;}if(output.length>=marker.length){ready=true;if(authorized)closeInput();}}return;}
        if(!ready){const marker=Buffer.from('ABBOTT_RECOVERY_READY\n');if(output.length>marker.length||!marker.subarray(0,output.length).equals(output)){invalid=true;note('ack_framing','malformed');abort();return;}if(output.length===marker.length){ready=true;output.fill(0);output=Buffer.alloc(0);dispatch();}}
      });
      child.stderr.on('data',chunk=>{if(settled){chunk.fill(0);return;}invalid=true;note('remote_startup','stderr');if(stderr.length+chunk.length>8192){stderrOversized=true;stderr.fill(0);stderr=Buffer.alloc(0);}else if(!stderrOversized){const next=Buffer.concat([stderr,chunk]);stderr.fill(0);stderr=next;}chunk.fill(0);abort();});child.on('error',()=>{invalid=true;badExit=true;note('local_spawn','failed');abort();});
      child.stdin.on('error',()=>{invalid=true;note(phase==='run_write'?'run_write':'source_write','failed');closeInput();});
      const cleanupProof=()=>{try{acquire();}catch{}};
      timers.push(platform.setTimeout(()=>{if(closed)return;deadlineReached=true;invalid=true;note('timeout','deadline');abort();cleanupProof();termSent=terminate('SIGTERM');},300000));
      timers.push(platform.setTimeout(()=>{if(closed)return;deadlineReached=true;invalid=true;note('timeout','deadline');abort();cleanupProof();if(termSent)terminate('SIGKILL');else termSent=terminate('SIGTERM');},360000));
      timers.push(platform.setTimeout(()=>{if(closed)return;deadlineReached=true;invalid=true;note('timeout','deadline');budgetEnded=true;closeInput();done();},365000));
      pid=child.pid;
      phase='identity_proof';evidence();
      signal?.addEventListener('abort',abort,{once:true});
      if(!acquire()){note('identity_proof','unavailable');failedSetup();return;}
      if(signal?.aborted){failedSetup();return;}
      authorized=true;if(startupStage){if(startupStage!=='loader'||ready)closeInput();}else dispatch();
    }catch{
      invalid=true;note(phase,phase==='identity_proof'?'unavailable':'failed');
      if(child)failedSetup();
      else{closed=true;done();}
    }
  });
}
