import path from'node:path';import{pathToFileURL}from'node:url';
import{runWithRecoveryEvidence,verifyRecoveryLocalAuthority}from'./recover-abbott-activation.mjs';
import{safeRecoveryDiagnostic}from'./abbott-recovery-diagnostics.mjs';
// Fixed inert source uses only the transport's success marker. It cannot load
// recovery state or perform a host operation. Public output never says restored.
export async function runStartupProbe({signal,run=runWithRecoveryEvidence}={}){
 const input=Buffer.from("export async function run(){return 'ABBOTT_RECOVERY_RESTORED'}");
 try{const result=await run(input,{signal}),diagnostic=safeRecoveryDiagnostic(result?.diagnostic);
  const success=result?.status==='ABBOTT_RECOVERY_RESTORED'&&diagnostic.stage==='complete'&&diagnostic.reason==='none';
  return `ABBOTT_STARTUP_PROBE_${success?'READY':'REFUSED'} stage=${diagnostic.stage} reason=${diagnostic.reason}\n`;
 }catch{return'ABBOTT_STARTUP_PROBE_REFUSED stage=unknown reason=unknown\n';}finally{input.fill(0);}
}
async function main(){
 verifyRecoveryLocalAuthority();const abort=new AbortController(),stop=()=>abort.abort();
 for(const name of['SIGINT','SIGTERM'])process.on(name,stop);
 try{const line=await runStartupProbe({signal:abort.signal});process.stdout.write(line);if(!line.startsWith('ABBOTT_STARTUP_PROBE_READY '))process.exitCode=1;}
 finally{for(const name of['SIGINT','SIGTERM'])process.removeListener(name,stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main().catch(()=>{process.stdout.write('ABBOTT_STARTUP_PROBE_REFUSED stage=unknown reason=unknown\n');process.exitCode=1;});
