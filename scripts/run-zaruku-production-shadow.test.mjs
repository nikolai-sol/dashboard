import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runProductionShadow, PRODUCTION_STEPS } from './run-zaruku-production-shadow.mjs';

const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
function fixture(overrides = {}) {
  const calls = [], stoppedProcesses = [], written = [];
  const before = { combinedPid: 101, nginxSha256: hash, foreignShas: [{ name: 'combined-dashboard', sha: 'c'.repeat(40), identity: '100:1' }] };
  const adapter = {
    calls, stoppedProcesses, written, deployCalls: 0, nginxCalls: 0,
    source: async () => ({ sha, branch: 'codex/reviewed', clean: true }),
    loadAuthorities: async () => ({ shadow: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../deploy/zaruku/production-shadow.json'))), mysql: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../deploy/zaruku/mysql-read-tables.json'))) }),
    preflight: async () => ({ passed: true, ...before }),
    linuxBuildHelperFixture: async () => ({ passed: true }),
    linuxPrivilegeFixture: async () => ({ passed: overrides.linuxPrivilegeFixture !== 'not-run' }),
    hostBoundary: async () => ({ passed: true }),
    dbBoundary: async () => ({ passed: true, tableSelectCount: 35 }),
    runtimeSecrets: async () => ({ passed: true }),
    managerAuth: async () => ({ passed: true }),
    fullPredeploy: async () => ({ passed: true }),
    releaseAuthority: async () => ({ passed: true, sourceSha: sha }),
    allocateEvidence: async () => ({ passed: true }),
    deploy: async () => { adapter.deployCalls++; return { passed: true, sourceSha: sha }; },
    attest: async () => ({ passed: true, sourceSha: sha, pid:123,cwd:'/var/www/dashboard-zaruku/apps/zaruku',uid: 1001, gid: 1001, groups: [], capabilities: '0', noNewPrivileges: true, loopbackOnly: true, port: 3002, process: 'dashboard-zaruku' }),
    parity: async () => ({ passed: overrides.parity !== 'mismatch', pairedReadAttempts: 1, coverageAdvancedDuringFirstPair: false, stableCanonicalComparison: overrides.parity !== 'mismatch' }),
    recheck: async () => ({ passed: true, ...before }),
    stop: async name => { stoppedProcesses.push(name); return { passed: true }; },
    cleanup: async () => ({ passed: true }),
    writeDecision: async evidence => { written.push(evidence); return { path: `/var/www/.dashboard-zaruku-shadow/evidence/${sha}-00000000-0000-4000-8000-000000000000`, immutable: true }; },
  };
  for (const method of ['preflight', 'linuxBuildHelperFixture', 'linuxPrivilegeFixture', 'hostBoundary', 'dbBoundary', 'runtimeSecrets', 'managerAuth', 'fullPredeploy', 'releaseAuthority', 'allocateEvidence', 'deploy', 'attest', 'parity', 'recheck', 'cleanup']) {
    const original = adapter[method]; adapter[method] = async () => { calls.push(method); return original(); };
  }
  return adapter;
}

test('orchestrator cannot deploy before every prerequisite passes', async () => {
  const adapter = fixture({ linuxPrivilegeFixture: 'not-run' });
  await assert.rejects(() => runProductionShadow(adapter), /Linux privilege fixture/);
  assert.equal(adapter.deployCalls, 0); assert.equal(adapter.nginxCalls, 0);
});

test('allocation receipt must be confirmed before any deployment or parity',async()=>{
  const adapter=fixture();adapter.allocateEvidence=async()=>{throw new Error('PRIVATE_SENTINEL lost allocation response');};
  await assert.rejects(()=>runProductionShadow(adapter),error=>error.message==='Zaruku production shadow failed: evidence allocation');
  assert.equal(adapter.deployCalls,0);assert.deepEqual(adapter.stoppedProcesses,[]);
  assert.ok(!adapter.calls.includes('parity'));
});

test('fixed successful state machine attests immutable evidence without cutover', async () => {
  const adapter = fixture(); const result = await runProductionShadow(adapter);
  assert.equal(result.decision, 'GO'); assert.equal(result.publicCutover, false);
  assert.deepEqual(result.steps, PRODUCTION_STEPS);
  assert.equal(adapter.deployCalls, 1); assert.equal(adapter.nginxCalls, 0);
  assert.equal(result.baselines.before.combinedPid,101);assert.deepEqual(result.baselines.after,result.baselines.before);
  assert.equal(result.processAttestation.uid,1001);
  assert.match(result.evidenceDirectory, /^\/var\/www\/\.dashboard-zaruku-shadow\/evidence\/[a-f0-9-]+$/);
});

test('documented free-port sequence deploys once and cleans only an owned failed run',async()=>{
  const plan=fs.readFileSync(path.join(import.meta.dirname,'../docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md'),'utf8');
  const task7=plan.split('### Task 7:')[1].split('## Completion Boundary')[0];
  assert.doesNotMatch(task7,/npm run deploy:zaruku/);
  assert.equal(task7.match(/npm run shadow:zaruku:run/g)?.length,1);
  assert.match(task7,/3002.*free|free.*3002/);
  for(const fault of ['none','parity','lost-response','before-activation']) {
    const adapter=fixture();let listening=false,receipt=false,deployed=0,stops=0;
    const preflight=adapter.preflight;adapter.preflight=async()=>{assert.equal(listening,false);return preflight();};
    adapter.deploy=async()=>{deployed++;assert.equal(listening,false);if(fault==='before-activation')throw new Error();listening=true;receipt=true;if(fault==='lost-response')throw new Error();return {passed:true,sourceSha:sha};};
    if(fault==='parity')adapter.parity=async()=>({passed:false});
    adapter.stop=async()=>{if(receipt){listening=false;stops++;}return {passed:true,stopped:receipt};};
    const result=await runProductionShadow(adapter);
    assert.equal(deployed,1);assert.equal(result.decision,fault==='none'?'GO':'NO-GO');
    assert.equal(listening,fault==='none');assert.equal(stops,['parity','lost-response'].includes(fault)?1:0);
  }
});

test('failed second pair retains the exact retry history in immutable NO-GO evidence',async()=>{
  const adapter=fixture();adapter.parity=async()=>({passed:false,pairedReadAttempts:2,coverageAdvancedDuringFirstPair:true,stableCanonicalComparison:false});
  const result=await runProductionShadow(adapter);assert.equal(result.decision,'NO-GO');
  assert.deepEqual(result.parity,{pairedReadAttempts:2,coverageAdvancedDuringFirstPair:true,stableCanonicalComparison:false});
});

test('stable parity failure stops only dashboard-zaruku and records NO-GO', async () => {
  const adapter = fixture({ parity: 'mismatch' }); const result = await runProductionShadow(adapter);
  assert.equal(result.decision, 'NO-GO'); assert.deepEqual(adapter.stoppedProcesses, ['dashboard-zaruku']);
  assert.equal(adapter.nginxCalls, 0); assert.equal(adapter.calls.filter(name => name === 'parity').length, 1);
  assert.equal(adapter.written[0].decision, 'NO-GO');
});

test('accepts only the verifier’s one bounded coverage advancement retry', async () => {
  for (const attempts of [1, 2, 3]) {
    const adapter = fixture(); adapter.parity = async () => ({ passed: true, pairedReadAttempts: attempts, coverageAdvancedDuringFirstPair: attempts !== 1, stableCanonicalComparison: true });
    assert.equal((await runProductionShadow(adapter)).decision, attempts === 3 ? 'NO-GO' : 'GO');
  }
  const adapter = fixture(); adapter.parity = async () => ({ passed: true, pairedReadAttempts: 2, coverageAdvancedDuringFirstPair: false, stableCanonicalComparison: true });
  assert.equal((await runProductionShadow(adapter)).decision, 'NO-GO');
});

for (const method of ['hostBoundary', 'dbBoundary', 'runtimeSecrets', 'managerAuth', 'fullPredeploy', 'releaseAuthority']) test(`failed ${method} prevents deployment`, async () => {
  const adapter = fixture(); adapter[method] = async () => ({ passed: false });
  await assert.rejects(() => runProductionShadow(adapter)); assert.equal(adapter.deployCalls, 0);
});

for (const fault of ['manager-auth', 'pdf', 'xlsx', 'artifact', 'port', 'combined-pid', 'nginx-hash', 'foreign-sha', 'cleanup']) test(`${fault} produces NO-GO and stops only Zaruku`, async () => {
  const adapter = fixture();
  if (['manager-auth', 'pdf', 'xlsx'].includes(fault)) adapter.parity = async () => { throw new Error(`SECRET_SENTINEL ${fault}`); };
  if (fault === 'artifact') adapter.attest = async () => ({ passed: true, sourceSha: 'f'.repeat(40) });
  if (fault === 'port') adapter.attest = async () => ({ passed: true, sourceSha: sha, loopbackOnly: false });
  if (['combined-pid', 'nginx-hash', 'foreign-sha'].includes(fault)) { const previous = adapter.recheck; adapter.recheck = async () => { const value = await previous(); if (fault === 'combined-pid') value.combinedPid++; if (fault === 'nginx-hash') value.nginxSha256 = 'f'.repeat(64); if (fault === 'foreign-sha') value.foreignShas = []; return value; }; }
  if (fault === 'cleanup') adapter.cleanup = async () => { throw new Error('SECRET_SENTINEL cleanup'); };
  const result = await runProductionShadow(adapter); assert.equal(result.decision, 'NO-GO'); assert.deepEqual(adapter.stoppedProcesses, ['dashboard-zaruku']);
  assert.doesNotMatch(JSON.stringify([result, adapter.written]), /SECRET_SENTINEL/);
});

test('untrusted detail values cannot reach successful output or evidence', async () => {
  const adapter = fixture(); const original = adapter.parity;
  adapter.parity = async () => ({ ...await original(), header: 'SECRET_SENTINEL', body: 'SECRET_SENTINEL' });
  const result = await runProductionShadow(adapter);
  assert.doesNotMatch(JSON.stringify([result, adapter.written]), /SECRET_SENTINEL|header|body/);
});

test('adapter cannot impersonate a state-machine error to disclose data', async () => {
  const adapter=fixture(); adapter.source=async()=>{throw new Error('Zaruku production shadow failed: PRIVATE_SENTINEL');};
  await assert.rejects(()=>runProductionShadow(adapter), error=>!error.message.includes('PRIVATE_SENTINEL'));
});

test('live attestation preserves sealed-fixture versus PM2 privilege distinction', async () => {
  const adapter=fixture(), original=adapter.attest;
  adapter.attest=async()=>({...await original(), noNewPrivileges:false, boundingCapabilities:'000001ffffffffff'});
  assert.equal((await runProductionShadow(adapter)).decision,'GO');
  for (const field of ['capabilities','groups']) {
    const bad=fixture(), attest=bad.attest;
    bad.attest=async()=>({...await attest(),[field]:field==='groups'?[0]:'1'});
    assert.equal((await runProductionShadow(bad)).decision,'NO-GO');
  }
});

test('CLI rejects all argument and environment authority overrides before command execution', () => {
  const script = path.join(import.meta.dirname, 'run-zaruku-production-shadow.mjs');
  for (const args of [['--host=other'], ['--port=3001'], ['--runtime=combined'], ['--path=/tmp'], ['apply']]) assert.notEqual(spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }).status, 0);
  for (const name of ['VPS', 'APP_PORT', 'NODE_OPTIONS', 'ZARUKU_SHADOW_AUTH_FD', 'GIT_CONFIG_COUNT']) {
    const value = name === 'NODE_OPTIONS' ? '--no-warnings' : 'SECRET_SENTINEL';
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, [name]: value } });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout + result.stderr, /SECRET_SENTINEL/);
  }
});
