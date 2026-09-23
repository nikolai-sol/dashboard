import test from 'node:test';import assert from 'node:assert/strict';
const api=()=>import('./abbott-interrupted-recovery.mjs').catch(()=>({}));
function fixture(failure,signal){const events=[];return{events,signal,async step(name){events.push(name);if(name===failure)throw Error('secret://private?token=secret');},async verify(name){events.push('verify:'+name);if('verify:'+name===failure)throw Error('private');}};}
test('fixed recovery refuses every pin drift before lock or process mutation',async()=>{
  const m=await api();assert.equal(typeof m.validateRecoveryPins,'function');
  const good=m.RECOVERY_PINS;assert.doesNotThrow(()=>m.validateRecoveryPins(structuredClone(good)));
  for(const key of Object.keys(good)){const value=structuredClone(good);value[key]='private';assert.throws(()=>m.validateRecoveryPins(value),/^Error: ABBOTT_RECOVERY_REFUSED$/);}
  assert.throws(()=>m.validateRecoveryPins({...good,extra:'private'}),/^Error: ABBOTT_RECOVERY_REFUSED$/);
});
test('success stops owned Abbott before atomic moves and restarts only sealed predecessor',async()=>{
  const m=await api();assert.equal(typeof m.runRecoverySteps,'function');const f=fixture();assert.equal(await m.runRecoverySteps(f),'ABBOTT_RECOVERY_RESTORED');
  assert.deepEqual(f.events,['verify:initial','lock','verify:locked','journal:prepared','stop','journal:stopped','verify:stopped','move:candidate','journal:candidate_parked','move:backup','journal:backup_active','verify:old_tree','restart','verify:restored','journal:restored','unlock']);
});
test('preflight/lock refusals do not reach stop or directory moves',async()=>{
  const m=await api();for(const failure of ['verify:initial','lock','verify:locked','journal:prepared']){const f=fixture(failure);await assert.rejects(m.runRecoverySteps(f),/^Error: ABBOTT_RECOVERY_REFUSED$/);assert.ok(!f.events.includes('stop'));assert.ok(!f.events.some(x=>x.startsWith('move:')));}
});
test('every post-stop failure compensates without restarting candidate and retains journal/lock',async()=>{
  const m=await api();for(const failure of ['stop','journal:stopped','verify:stopped','move:candidate','journal:candidate_parked','move:backup','journal:backup_active','verify:old_tree','restart','verify:restored','journal:restored']){
    const f=fixture(failure);await assert.rejects(m.runRecoverySteps(f),/^Error: ABBOTT_RECOVERY_REVIEW_REQUIRED$/);
    assert.ok(f.events.includes('stop:owned_after_failure'));assert.ok(f.events.includes('compensate'));assert.ok(!f.events.includes('unlock'));assert.ok(f.events.includes('journal:review_required'));
    assert.ok(f.events.filter(x=>x==='restart').length<=1);
  }
});
test('signals before mutation refuse; signals after stop compensate; failed compensation never unlocks',async()=>{
  const m=await api();const abort=new AbortController();abort.abort();const early=fixture(null,abort.signal);await assert.rejects(m.runRecoverySteps(early),/^Error: ABBOTT_RECOVERY_REFUSED$/);assert.deepEqual(early.events,[]);
  for(const at of ['stop','move:candidate','move:backup','restart']){const a=new AbortController(),f=fixture(null,a.signal),step=f.step;f.step=async name=>{await step(name);if(name===at)a.abort();};await assert.rejects(m.runRecoverySteps(f),/^Error: ABBOTT_RECOVERY_REVIEW_REQUIRED$/);assert.ok(f.events.includes('compensate'));assert.ok(!f.events.includes('unlock'));}
  const f=fixture('restart'),step=f.step;f.step=async name=>{await step(name);if(name==='compensate')throw Error('secret');};await assert.rejects(m.runRecoverySteps(f),/^Error: ABBOTT_RECOVERY_REVIEW_REQUIRED$/);assert.ok(!f.events.includes('unlock'));assert.ok(f.events.includes('journal:review_required'));
});
