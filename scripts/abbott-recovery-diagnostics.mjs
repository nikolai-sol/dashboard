export const RECOVERY_REASONS=Object.freeze(Object.fromEntries(Object.entries({
 local_spawn:['failed'],identity_proof:['unavailable','absent','unverified'],
 source_write:['failed'],run_write:['failed'],remote_startup:['failed','stderr'],
 remote_preflight:['refused'],remote_recovery:['review_required'],
 ack_framing:['malformed','missing','oversized'],timeout:['deadline'],
 ssh_close:['nonzero','signal','unverified'],local_evidence:['failed'],
 complete:['none'],unknown:['unknown'],
}).map(([k,v])=>[k,Object.freeze(v)])));
export function safeRecoveryDiagnostic(value){
 const {stage,reason}=value??{};
 return Object.hasOwn(RECOVERY_REASONS,stage)&&RECOVERY_REASONS[stage].includes(reason)?{stage,reason}:{stage:'unknown',reason:'unknown'};
}
export function formatRecoveryDiagnostic(value){
 const status=['ABBOTT_RECOVERY_RESTORED','ABBOTT_RECOVERY_REFUSED','ABBOTT_RECOVERY_REVIEW_REQUIRED','ABBOTT_RECOVERY_UNACKNOWLEDGED'].includes(value?.status)?value.status:'ABBOTT_RECOVERY_REFUSED';
 const {stage,reason}=safeRecoveryDiagnostic(value?.diagnostic);return `${status} stage=${stage} reason=${reason}\n`;
}
export function parseRecoveryAck(text){
 const match=/^ABBOTT_RECOVERY_ACK (RESTORED|REFUSED|REVIEW_REQUIRED) ([a-z_]+) ([a-z_]+)\n$/.exec(text);if(!match)return null;
 const [,status,stage,reason]=match,diagnostic=safeRecoveryDiagnostic({stage,reason});
 if(diagnostic.stage!==stage||diagnostic.reason!==reason)return null;
 const pairs={RESTORED:['complete:none'],REVIEW_REQUIRED:['remote_recovery:review_required'],REFUSED:['remote_startup:failed','remote_preflight:refused','ack_framing:malformed','timeout:deadline']};
 return pairs[status].includes(stage+':'+reason)?{status:'ABBOTT_RECOVERY_'+status,diagnostic}:null;
}
