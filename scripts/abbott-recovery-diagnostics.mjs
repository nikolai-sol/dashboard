export const RECOVERY_REASONS=Object.freeze(Object.fromEntries(Object.entries({
 local_spawn:['failed'],identity_proof:['unavailable','absent','unverified'],
 source_write:['failed'],run_write:['failed'],remote_startup:['failed','stderr','sudo_hostname','node_syntax','node_warning','permission','missing_binary','ssh_warning','ssh_tty','ssh_known_host','locale_warning','unknown'],
 remote_preflight:['refused'],remote_recovery:['review_required'],
 ack_framing:['malformed','missing','oversized'],timeout:['deadline'],
 ssh_close:['nonzero','signal','unverified'],local_evidence:['failed'],
 complete:['none'],unknown:['unknown'],
}).map(([k,v])=>[k,Object.freeze(v)])));
// Categories explain refusal, never permit stderr. No matched text is returned.
export function classifyStartupStderr(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8192)return'unknown';let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return'unknown';}
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return'unknown';
 const patterns={
  sudo_hostname:/^sudo: unable to resolve host [^\r\n]{1,255}: (?:Name or service not known|Temporary failure in name resolution)\r?$/m,
  node_syntax:/^SyntaxError: [^\r\n]+/m,
  node_warning:/^\(node:[0-9]+\) (?:\[[A-Z0-9_]+\] )?(?:ExperimentalWarning|DeprecationWarning|Warning): /m,
  permission:/^(?:Permission denied \(publickey\)\.|[^\r\n]{0,512}: Permission denied\.?\r?$)/m,
  missing_binary:/^(?:(?:\/usr\/bin\/env|env): [^\r\n]+: No such file or directory|(?:sh|bash): [^\r\n]+: (?:command )?not found)\r?$/m,
  ssh_tty:/^Pseudo-terminal will not be allocated because stdin is not a terminal\.\r?$/m,
  ssh_known_host:/^Warning: Permanently added '[^'\r\n]{1,255}' \((?:ED25519|ECDSA|RSA)\) to the list of known hosts\.\r?$/m,
  locale_warning:/^(?:bash|sh): warning: setlocale: LC_[A-Z_]+: cannot change locale \([^\r\n)]{1,128}\)(?:: No such file or directory)?\r?$/m,
 };
 const matches=Object.entries(patterns).filter(([,pattern])=>pattern.test(text));return matches.length===1?matches[0][0]:'unknown';
}
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
