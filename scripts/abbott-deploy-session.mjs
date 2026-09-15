import{runAbbottDeployTransport,safeDeployDiagnostic,deploymentDigest,encodeAbbottDeployResult,parseAbbottDeployResult}from'./abbott-deploy-transport.mjs';import{createDeployEvidence}from'./abbott-deploy-evidence.mjs';
export async function runAbbottDeployWithEvidence(source,payload,{signal,transport=runAbbottDeployTransport,evidence}={}){
 let result={status:'UNACKNOWLEDGED',record:null,diagnostic:{stage:'local_evidence',reason:'failed'}};
 try{
  const digest=deploymentDigest(source,payload);evidence??=createDeployEvidence();const raw=await transport(source,payload,{signal,onEvidence:r=>evidence.record(r)}),summary=evidence.finish();evidence=null;
  if(raw.remoteAcknowledged&&raw.sshExitVerified&&summary.identityCaptured&&summary.exitObserved&&summary.exitVerified&&['COMMITTED','RESTORED','REFUSED','REVIEW_REQUIRED'].includes(raw.status)&&!(signal?.aborted&&raw.status==='COMMITTED')){const checked=parseAbbottDeployResult(encodeAbbottDeployResult(raw.status,raw.record,digest),digest);result={...checked,diagnostic:safeDeployDiagnostic(raw.diagnostic)};}
  else result={status:'UNACKNOWLEDGED',record:null,diagnostic:safeDeployDiagnostic(raw.diagnostic)};
 }catch{}finally{source.fill(0);payload.fill(0);if(evidence)try{evidence.finish();}catch{result={status:'UNACKNOWLEDGED',record:null,diagnostic:{stage:'local_evidence',reason:'failed'}};}}
 return result;
}
