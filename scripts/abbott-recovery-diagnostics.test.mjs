import test from'node:test';import assert from'node:assert/strict';
const api=()=>import('./abbott-recovery-diagnostics.mjs').catch(()=>({}));
test('recovery diagnostics render only closed status/stage/reason pairs',async()=>{
 const m=await api();assert.equal(typeof m.formatRecoveryDiagnostic,'function');
 for(const [stage,reasons]of Object.entries(m.RECOVERY_REASONS))for(const reason of reasons){const line=m.formatRecoveryDiagnostic({status:'ABBOTT_RECOVERY_UNACKNOWLEDGED',diagnostic:{stage,reason},pid:123,start:'private',stderr:'private'});assert.equal(line,`ABBOTT_RECOVERY_UNACKNOWLEDGED stage=${stage} reason=${reason}\n`);}
 for(const input of[null,{}, {status:'private',diagnostic:{stage:'private',reason:'secret'}},{status:'ABBOTT_RECOVERY_REFUSED',diagnostic:{stage:'source_write',reason:'nonzero'}}]){const line=m.formatRecoveryDiagnostic(input);assert.doesNotMatch(line,/private|secret|123/);assert.match(line,/stage=unknown reason=unknown\n$/);}
});
test('acknowledgements reject forged status-stage pairs and secret-bearing extra fields',async()=>{const m=await api();assert.deepEqual(m.parseRecoveryAck('ABBOTT_RECOVERY_ACK REFUSED remote_preflight refused\n'),{status:'ABBOTT_RECOVERY_REFUSED',diagnostic:{stage:'remote_preflight',reason:'refused'}});for(const text of['ABBOTT_RECOVERY_ACK RESTORED remote_preflight refused\n','ABBOTT_RECOVERY_ACK REFUSED remote_startup secret\n','ABBOTT_RECOVERY_ACK RESTORED complete none\nprivate','ABBOTT_RECOVERY_ACK REFUSED private token\n','ABBOTT_RECOVERY_ACK RESTORED\n'])assert.equal(m.parseRecoveryAck(text),null);});
