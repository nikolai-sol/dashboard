import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadShadowAuthority, loadMysqlTableAuthority } from './zaruku-production-shadow-contract.mjs';
import { rejectShadowOverrides } from './stage-zaruku-shadow-control.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
export const PRODUCTION_STEPS = Object.freeze([
  'preflight-read-only', 'linux-build-helper-fixture', 'linux-privilege-drop-fixture',
  'host-boundary-check', 'db-boundary-check', 'runtime-secret-check', 'manager-auth-descriptor-check',
  'full-predeploy', 'release-authority-check', 'deploy-zaruku', 'process-and-listener-attestation',
  'same-snapshot-parity', 'foreign-sha-and-nginx-recheck', 'write-final-decision',
]);
class ShadowFailure extends Error { constructor(label) { super(`Zaruku production shadow failed: ${label}`); this.label=label; } }
const fail = label => { throw new ShadowFailure(label); };

function baseline(value) {
  if (!value?.passed || !Number.isSafeInteger(value.combinedPid) || value.combinedPid <= 0 || !/^[a-f0-9]{64}$/.test(value.nginxSha256) || !Array.isArray(value.foreignShas) || !value.foreignShas.length) fail('runtime baseline');
  const names = new Set();
  const foreignShas = value.foreignShas.map(row => {
    if (row.name !== 'combined-dashboard' || names.has(row.name) || !/^[a-f0-9]{40}$/.test(row.sha) || !/^\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)*$/.test(row.identity)) fail('foreign runtime authority');
    names.add(row.name); return { name: row.name, sha: row.sha, identity: row.identity };
  });
  if (!names.has('combined-dashboard')) fail('combined runtime authority');
  return { combinedPid: value.combinedPid, nginxSha256: value.nginxSha256, foreignShas };
}

/** Only the fixed state machine owns deployment/stop ordering. Adapters own OS boundaries. */
export async function runProductionShadow(adapter) {
  const steps = [], checks = {};
  let source, deployed = false, stopped = false, failure = null, before, after=null, parity, processEvidence=null;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { if ((await adapter.stop('dashboard-zaruku'))?.passed !== true) failure = 'Zaruku stop failed'; }
    catch { failure = 'Zaruku stop failed'; }
  };
  const check = async (method, label, index) => {
    let value;
    try { value = await adapter[method](); } catch { fail(label); }
    if(method==='parity'&&[1,2].includes(value?.pairedReadAttempts)&&value.coverageAdvancedDuringFirstPair===(value.pairedReadAttempts===2)&&typeof value.stableCanonicalComparison==='boolean')parity={pairedReadAttempts:value.pairedReadAttempts,coverageAdvancedDuringFirstPair:value.coverageAdvancedDuringFirstPair,stableCanonicalComparison:value.passed===true&&value.stableCanonicalComparison};
    if (value?.passed !== true) fail(label);
    checks[PRODUCTION_STEPS[index]] = 'pass'; steps.push(PRODUCTION_STEPS[index]); return value;
  };
  try {
    source = await adapter.source();
    if (!source?.clean || typeof source.branch !== 'string' || !source.branch || !/^[a-f0-9]{40}$/.test(source.sha)) fail('clean named source branch');
    const authorities = await adapter.loadAuthorities();
    if (!isDeepStrictEqual(authorities.shadow, loadShadowAuthority(path.join(ROOT, 'deploy/zaruku/production-shadow.json'))) || !isDeepStrictEqual(authorities.mysql, loadMysqlTableAuthority(path.join(ROOT, 'deploy/zaruku/mysql-read-tables.json')))) fail('committed authorities');
    before = baseline(await check('preflight', 'read-only preflight', 0));
    await check('linuxBuildHelperFixture', 'Linux build-helper fixture', 1);
    await check('linuxPrivilegeFixture', 'Linux privilege fixture', 2);
    await check('hostBoundary', 'host boundary', 3);
    if ((await check('dbBoundary', 'DB boundary', 4)).tableSelectCount !== authorities.mysql.tables.length) fail('DB table boundary');
    await check('runtimeSecrets', 'runtime secret check', 5);
    await check('managerAuth', 'manager auth descriptor check', 6);
    await check('fullPredeploy', 'full predeploy', 7);
    if ((await check('releaseAuthority', 'release authority', 8)).sourceSha !== source.sha || !isDeepStrictEqual(await adapter.source(), source)) fail('reviewed source changed');
    // Once deployment starts, failure is conservatively treated as a possible live process.
    deployed = true;
    if ((await check('deploy', 'deploy Zaruku', 9)).sourceSha !== source.sha) fail('deployed source authority');
    const process = await check('attest', 'process and listener attestation', 10);
    if (process.sourceSha !== source.sha || process.process !== 'dashboard-zaruku' || process.port !== 3002 || !process.loopbackOnly || !Number.isSafeInteger(process.uid) || process.uid <= 0 || !Number.isSafeInteger(process.gid) || process.gid <= 0 || !isDeepStrictEqual(process.groups, []) || process.capabilities !== '0') fail('process and listener attestation');
    if(!Number.isSafeInteger(process.pid)||process.pid<=0||process.cwd!=='/var/www/dashboard-zaruku/apps/zaruku')fail('process and listener attestation');
    processEvidence=Object.fromEntries(['sourceSha','pid','uid','gid','cwd','groups','capabilities','loopbackOnly','port','process'].map(key=>[key,process[key]]));
    const comparison = await check('parity', 'same-snapshot parity', 11);
    if (comparison.stableCanonicalComparison !== true || ![1, 2].includes(comparison.pairedReadAttempts) || comparison.coverageAdvancedDuringFirstPair !== (comparison.pairedReadAttempts === 2)) fail('bounded parity comparison');
    parity = { pairedReadAttempts: comparison.pairedReadAttempts, coverageAdvancedDuringFirstPair: comparison.coverageAdvancedDuringFirstPair, stableCanonicalComparison: true };
  } catch (error) {
    // Only errors created by this state machine are exposed. Adapters may throw raw data.
    failure = error instanceof ShadowFailure ? error.label : 'prerequisite operation';
  } finally {
    if (deployed) {
      try {
        after = baseline(await check('recheck', 'foreign SHA and Nginx recheck', 12));
        if (!isDeepStrictEqual(after, before)) failure = 'foreign runtime or Nginx changed';
      } catch { failure ??= 'foreign SHA and Nginx recheck'; }
    }
    try { if ((await adapter.cleanup())?.passed !== true) failure = 'cleanup failed'; } catch { failure = 'cleanup failed'; }
    if (failure && deployed) await stop();
  }
  if (failure && !deployed) fail(failure);
  const evidence = { decision: failure ? 'NO-GO' : 'GO', publicCutover: false, sourceSha: source.sha, steps: [...steps, PRODUCTION_STEPS[13]], checks, parity: parity ?? { pairedReadAttempts: 1, coverageAdvancedDuringFirstPair: false, stableCanonicalComparison: false }, failure,baselines:{before,after},processAttestation:processEvidence };
  try {
    const directory = await adapter.writeDecision(evidence);
    if (directory?.immutable !== true || typeof directory.path !== 'string' || !new RegExp(`^/var/www/\\.dashboard-zaruku-shadow/evidence/${source.sha}-[a-f0-9-]{36}$`).test(directory.path)) fail('immutable evidence publication');
    return { ...evidence, evidenceDirectory: directory.path };
  } catch { await stop(); fail('immutable evidence publication'); }
}

export async function productionShadowMain(args = process.argv.slice(2)) {
  try {
    rejectShadowOverrides(args);
    const { createProductionAdapter } = await import('./zaruku-production-shadow-remote.mjs');
    const result = await runProductionShadow(createProductionAdapter());
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.decision !== 'GO') process.exitCode = 1;
  } catch { process.stderr.write('Zaruku production shadow failed; no public cutover authorized\n'); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await productionShadowMain();
