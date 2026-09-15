import path from'node:path';import{pathToFileURL}from'node:url';
import{runWithRecoveryEvidence,verifyRecoveryLocalAuthority}from'./recover-abbott-activation.mjs';
import{runRecoveryStartupStage}from'./abbott-recovery-transport.mjs';
import{RECOVERY_REASONS}from'./abbott-recovery-diagnostics.mjs';
const results=['clean','stderr_known_category','stderr_unknown','exit_nonzero','timeout','unexpected_output','cleanup_unverified'];
export function validateStartupStage(args){if(args.length!==1||!['ssh','node','loader'].includes(args[0]))throw Error('ABBOTT_STARTUP_STAGE_REFUSED');return args[0];}
function safeResult(stage,value){
 const fallback={stage,result:'unexpected_output',category:'none'};
 if(!value||value.stage!==stage||!results.includes(value.result))return fallback;
 if(value.result==='stderr_known_category'){
  if(!['sudo_hostname','node_syntax','node_warning','permission','missing_binary','ssh_tty','ssh_known_host','locale_warning'].includes(value.category)||!RECOVERY_REASONS.remote_startup.includes(value.category))return fallback;
 }else if(value.category!=='none')return fallback;
 return{stage,result:value.result,category:value.category};
}
export async function runStartupStage(stage,{signal,transport=runRecoveryStartupStage,evidence}={}){
 validateStartupStage([stage]);let captured;const empty=Buffer.alloc(0);
 try{const verified=await runWithRecoveryEvidence(empty,{signal,evidence,transport:async(_input,options)=>{const raw=await transport(stage,options);captured=safeResult(stage,raw.startup);return raw;}});
  if(!captured||verified.diagnostic.stage==='local_evidence'||captured.result==='clean'&&verified.status!=='ABBOTT_RECOVERY_RESTORED')captured={stage,result:'cleanup_unverified',category:'none'};
 }catch{captured={stage,result:'cleanup_unverified',category:'none'};}finally{empty.fill(0);}
 return `ABBOTT_STARTUP_STAGE stage=${captured.stage} result=${captured.result} category=${captured.category}\n`;
}
async function main(){
 const stage=validateStartupStage(process.argv.slice(2));verifyRecoveryLocalAuthority([stage]);
 const abort=new AbortController(),stop=()=>abort.abort();for(const name of['SIGINT','SIGTERM'])process.on(name,stop);
 try{const line=await runStartupStage(stage,{signal:abort.signal});process.stdout.write(line);if(!line.includes(' result=clean '))process.exitCode=1;}
 finally{for(const name of['SIGINT','SIGTERM'])process.removeListener(name,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main().catch(()=>{process.stdout.write('ABBOTT_STARTUP_STAGE_REFUSED\n');process.exitCode=1;});
