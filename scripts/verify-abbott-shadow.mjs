import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseCredentialLines, createPrivateOutputDirectory, writePrivateExclusiveFile, releasePrivateOutputDirectory, cleanupPrivateOutputDirectory } from './compare-abbott-runtime.mjs';
import { HOST } from './bootstrap-abbott-host.mjs';
import { captureBoundedChild, boundedChildFailureReason } from './abbott-bounded-child.mjs';
export { captureBoundedChild } from './abbott-bounded-child.mjs';
import { markDiagnostic, carryDiagnostic, diagnosticFromChild, formatVerificationFailure } from './abbott-verification-diagnostics.mjs';
import { ASSET_ATTESTATION_REASONS } from './abbott-asset-attestation.mjs';

const ROOT = '/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation';
const OUTPUT = '/Users/nafanya/Downloads/Abbott-dashboard-cutover-evidence-2026-09-14';
const BASELINE = '/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14';
const AUTH_HASH = '71fad58b4eb66b2cd5dd29b7c463043c5cc8a04d839e597a14e0d9a2fae8e64f';
const refuse = () => { throw new Error('ABBOTT_VERIFICATION_REFUSED'); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// A malformed child contract must not mask its diagnostic or skip tunnel
// cleanup. Erase owned data buffers without invoking arbitrary accessors/fill.
const erase = result => {
  let failed=false;
  for (const key of ['stdout','stderr']) {
    try {
      const value = result && Object.getOwnPropertyDescriptor(result,key)?.value;
      if (Buffer.isBuffer(value)) Buffer.prototype.fill.call(value,0);
    } catch { failed=true; }
  }
  if(failed)refuse();
};

export function fixedSshInvocation(kind) {
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=10'];
  if (kind === 'issuer') args.push('--', 'beget', '/usr/bin/env -i /usr/bin/node --input-type=module');
  else if (kind === 'forward') args.push('-N', '-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:3001:127.0.0.1:3001', '-L', '127.0.0.1:3004:127.0.0.1:3004', '--', 'beget');
  else refuse();
  return { binary: '/usr/bin/ssh', args };
}

export function buildIssuerCapsule({ bootstrapSource, issuerSource, authSource }) {
  if (createHash('sha256').update(authSource).digest('hex') !== AUTH_HASH) refuse();
  const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const code = `try { const proof=await import(${JSON.stringify(moduleUrl(bootstrapSource))}); const issuer=await import(${JSON.stringify(moduleUrl(issuerSource))}); await issuer.runRemoteIssuer(proof.readVerifiedAbbottSource); } catch { process.stderr.write('ABBOTT_ISSUER_REFUSED\\n');process.exitCode=1; }\n`;
  if (Buffer.byteLength(code) > 262144) refuse();
  return Buffer.from(code);
}

export function buildAssetCapsule({bootstrapSource,attestationSource}) {
  const url=bytes=>'data:text/javascript;base64,'+Buffer.from(bytes).toString('base64');
  const code=`let imported=false;try{const proof=await import(${JSON.stringify(url(bootstrapSource))});const assets=await import(${JSON.stringify(url(attestationSource))});imported=true;assets.runRemoteAssetAttestation(proof.verifyAbbottBootstrapSource);}catch{process.stderr.write('ABBOTT_ASSET_ATTESTATION_REFUSED reason='+(imported?'remote_attestation':'remote_import')+'\\n');process.exitCode=1;}\n`;
  if(Buffer.byteLength(code)>262144)refuse();return Buffer.from(code);
}

export async function readAbbottAssetTransport(signal,{capsule=productionCapsule,capture=captureBoundedChild}={}) {
  let input;
  try {
    try { input=capsule('assets');if(!Buffer.isBuffer(input)||input.length>262144)refuse(); }
    catch { throw markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'asset_attestation','local_capsule'); }
    const invocation=fixedSshInvocation('issuer');
    try { return await capture(invocation.binary,invocation.args,{input,signal,timeout:30000,maxBytes:262144}); }
    catch(error){
      const reason={spawn:'ssh_spawn',stdin:'ssh_stdin',timeout:'ssh_timeout',abort:'cancelled',limit:'ssh_stderr_frame'}[boundedChildFailureReason(error)]??'unknown';
      throw markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'asset_attestation',reason);
    }
  }finally{if(Buffer.isBuffer(input))input.fill(0);}
}

function productionCapsule(kind='issuer') {
  if (process.getuid() === 0 || fs.realpathSync(process.cwd()) !== ROOT || fs.realpathSync(path.resolve(import.meta.dirname, '..')) !== ROOT) refuse();
  const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_PAGER: '/bin/cat' };
  const git = (...args) => execFileSync('/usr/bin/git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: ROOT, env, timeout: 10000, maxBuffer: 262144, stdio: ['ignore','pipe','pipe'] });
  const marker = path.join(ROOT, '.git'), markerStat = fs.lstatSync(marker);
  if (!markerStat.isFile() || markerStat.nlink !== 1 || fs.realpathSync(marker) !== marker) refuse();
  const match = /^gitdir: ([^\r\n]+)\n?$/.exec(fs.readFileSync(marker, 'utf8'));
  if (!match) refuse();
  const gitDir = path.resolve(ROOT, match[1]);
  if (fs.realpathSync(gitDir) !== gitDir || fs.readFileSync(path.join(gitDir,'gitdir'),'utf8').trim() !== marker || git('rev-parse','--absolute-git-dir').toString().trim() !== gitDir) refuse();
  if (git('status', '--porcelain=v1').length || git('rev-parse', '--show-toplevel').toString().trim() !== ROOT) refuse();
  const bootstrapSource=git('show','HEAD:scripts/bootstrap-abbott-host.mjs');
  if(kind==='assets')return buildAssetCapsule({bootstrapSource,attestationSource:git('show','HEAD:scripts/abbott-asset-attestation.mjs')});
  if(kind!=='issuer')refuse();
  return buildIssuerCapsule({ bootstrapSource, issuerSource: git('show', 'HEAD:scripts/abbott-parity-issuer.mjs'), authSource: git('show', `${HOST.sourceSha}:src/lib/access-auth.ts`) });
}

function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) refuse();
  return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: {}, encoding: 'utf8', timeout: 1000, stdio: ['ignore','pipe','pipe'] }).trim();
}

async function assertPortsFree() {
  for (const port of [3001,3004]) await new Promise((resolve,reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('ABBOTT_VERIFICATION_REFUSED')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
  });
}

export async function closeOwnedForward(proof) {
  const { child } = proof;
  try {
    for (const killSignal of ['SIGTERM','SIGKILL']) {
      if (proof.closed) break;
      if (child.exitCode !== null || child.signalCode !== null) {
        await Promise.race([proof.exit, delay(2000)]);
        break;
      }
      if (processStart(proof.pid) !== proof.start) refuse();
      child.kill(killSignal);
      await Promise.race([proof.exit, delay(2000)]);
    }
    if (!proof.closed) refuse();
  } finally { for (const buffer of proof.buffers) buffer.fill(0); }
}

export function verifyOwnedForward(proof) {
  try {
    if (proof.closed || proof.failed || proof.failure.aborted || processStart(proof.pid) !== proof.start) refuse();
    const listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(proof.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { env: {}, encoding: 'utf8', timeout: 1000, stdio: ['ignore','pipe','pipe'] }).trim().split('\n').filter(line => line.startsWith('n')).sort();
    if (JSON.stringify(listeners) !== JSON.stringify(['n127.0.0.1:3001','n127.0.0.1:3004'])) refuse();
  } catch { refuse(); }
}

async function openOwnedForward(signal) {
  await assertPortsFree();
  if (signal.aborted) refuse();
  const invocation = fixedSshInvocation('forward');
  const child = spawn(invocation.binary, invocation.args, { cwd: ROOT, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore','pipe','pipe'] });
  const failure = new AbortController();
  const proof = { child, pid: child.pid, start: '', buffers: [], closed: false, failed: false, failure: failure.signal };
  const failed = () => { proof.failed = true; failure.abort(); };
  proof.exit = new Promise(resolve => child.once('close', () => { proof.closed = true; resolve(); }));
  child.once('exit', failed); child.once('error', failed);
  const collect = chunk => { failed(); chunk.fill(0); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  try {
    proof.start = processStart(proof.pid);
    if (!proof.start) refuse();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (signal.aborted || proof.closed || proof.failed) refuse();
      try { verifyOwnedForward(proof); return proof; } catch {}
      await delay(100);
    }
    refuse();
  } catch {
    if (proof.start) await closeOwnedForward(proof);
    else { child.kill('SIGTERM'); await Promise.race([proof.exit,delay(2000)]); if (!proof.closed) { child.kill('SIGKILL'); await Promise.race([proof.exit,delay(2000)]); } }
    if (!proof.closed) refuse();
    refuse();
  }
}

function prepareOutput() {
  const parent = path.dirname(OUTPUT), stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || fs.realpathSync(parent) !== parent || stat.uid !== process.getuid() || stat.mode & 0o022) refuse();
  if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { mode: 0o700 });
  const output = fs.lstatSync(OUTPUT);
  if (!output.isDirectory() || output.uid !== process.getuid() || (output.mode & 0o7777) !== 0o700 || fs.realpathSync(OUTPUT) !== OUTPUT) refuse();
}

const realPlatform = {
  signalSource: process, capsule: productionCapsule, prepareOutput,
  openForward: openOwnedForward, closeForward: closeOwnedForward, verifyForward: verifyOwnedForward,
  recordForward(proof, exitVerified) {
    process.stdout.write(JSON.stringify({forward:{pid:proof.pid,start:proof.start,exitVerified}}) + '\n');
  },
  issue(code, signal) {
    const invocation = fixedSshInvocation('issuer');
    return captureBoundedChild(invocation.binary, invocation.args, { input: code, signal, timeout: 30000, maxBytes: 65536 });
  },
  readAssets: readAbbottAssetTransport,
  loadConsumer: mode => mode === 'smoke' ? import('./smoke-abbott-runtime.mjs') : undefined,
  async consume(mode, input, signal, attestation, consumer) {
    if(signal.aborted)refuse();
    if(mode==='smoke'){
      const credentials=parseCredentialLines(new TextDecoder('utf8',{fatal:true}).decode(input));let directory;
      try{
        if(!credentials.managerAccessToken)refuse();
        const {runReadOnlySmoke}=consumer;
        const manifest=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(attestation));
        const report=await runReadOnlySmoke({...credentials,manifest},signal);
        if(signal.aborted)refuse();
        directory=await createPrivateOutputDirectory(OUTPUT,'abbott-runtime-smoke-',ROOT);
        await writePrivateExclusiveFile(directory,'abbott-runtime-smoke.json',JSON.stringify(report)+'\n');
        if(signal.aborted)refuse();await releasePrivateOutputDirectory(directory);directory=null;
        return {status:0,stdout:Buffer.from(`smoke=passed checks=${report.checks}\n`),stderr:Buffer.alloc(0)};
      }finally{
        for(const key of Object.keys(credentials))delete credentials[key];
        if(directory)await cleanupPrivateOutputDirectory(directory);
      }
    }
    const args = mode === 'compare'
      ? ['scripts/compare-abbott-runtime.mjs','--reference','http://127.0.0.1:3001','--candidate','http://127.0.0.1:3004','--output-parent',OUTPUT]
      : ['scripts/capture-abbott-runtime.mjs','--login','http://127.0.0.1:3001','--candidate','http://127.0.0.1:3004','--baseline',BASELINE,'--output-parent',OUTPUT];
    // The reviewed capture owns Chromium cleanup; allow its bounded signal path
    // to finish before escalating termination of the consumer process.
    return captureBoundedChild(process.execPath, args, { input, signal, timeout: mode === 'capture' ? 600000 : 180000, graceMs: mode === 'capture' ? 30000 : 2000, maxBytes: 65536 });
  },
};

export async function runAbbottVerification(mode, platform = realPlatform) {
  let proof, code, issued, consumed, assets, consumer, watchdog, failure, stage='setup', assetBoundary='asset_read', passed = false, tearingDown = false;
  const controller = new AbortController();
  const setTimer = platform.setTimer ?? setTimeout, clearTimer = platform.clearTimer ?? clearTimeout;
  const interrupt = () => { failure??=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),stage,'cancelled');controller.abort(); };
  const forwardFailed = () => { if (!tearingDown){failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'forward','failed');controller.abort();} };
  const active = () => { if (controller.signal.aborted) refuse(); };
  const checkForward = () => { active(); platform.verifyForward(proof); active(); };
  const eraseGuarded = value => {
    try { erase(value); }
    catch { passed=false;failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'cleanup','guarded_cleanup'); }
  };
  // Allow child/browser shutdown its existing 30-second grace, but never await
  // an uncooperative module import/setup forever. Late output is erased too.
  const guarded = async operation => {
    active();
    let value, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('ABBOTT_VERIFICATION_REFUSED')); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    const pending = Promise.resolve().then(() => { active(); return operation(); }).then(result => { value = result; if(controller.signal.aborted)eraseGuarded(result); return result; });
    try { return await Promise.race([pending, aborted]); }
    finally {
      let drainTimer;
      try {
        try {
          if(controller.signal.aborted)await Promise.race([pending.catch(() => {}),new Promise(resolve=>{drainTimer=setTimer(resolve,35000);})]);
        } finally { if(drainTimer)clearTimer(drainTimer); }
      } catch {
        failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'cleanup','guarded_cleanup');
        throw failure;
      } finally {
        controller.signal.removeEventListener('abort', rejectAbort);
        if (controller.signal.aborted) eraseGuarded(value);
      }
    }
  };
  platform.signalSource.on('SIGINT', interrupt); platform.signalSource.on('SIGTERM', interrupt);
  try {
    if (!['compare','capture','smoke'].includes(mode)) refuse();
    // Covers capsule/setup/import as well as issuance and consuming work. The
    // fixed CLI has no caller-provided timeout or environment override.
    watchdog = setTimer(()=>{failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),stage,'deadline');interrupt();}, {compare:240000,capture:660000,smoke:540000}[mode]);
    code = platform.capsule(); active();
    platform.prepareOutput(); active();
    stage='forward';proof = await platform.openForward(controller.signal); active();
    proof.failure?.addEventListener('abort', forwardFailed, { once: true });
    if (proof.failure?.aborted) interrupt();
    checkForward();
    platform.recordForward?.(proof, false);
    if(platform.loadConsumer){stage='consumer_load';consumer=await guarded(()=>platform.loadConsumer(mode,controller.signal));checkForward();}
    if(mode==='smoke'){
      stage='asset_attestation';assets=await guarded(()=>platform.readAssets(controller.signal));
      // This is an independent transport-ownership gate, not asset parsing.
      stage='forward';checkForward();stage='asset_attestation';assetBoundary='result_contract';
      if(!assets||!Object.hasOwn(assets,'status')||!(assets.status===null||Number.isInteger(assets.status))||
        !(assets.signal===undefined||assets.signal===null||typeof assets.signal==='string')||
        !Buffer.isBuffer(assets.stdout)||!Buffer.isBuffer(assets.stderr))refuse();
      if(assets.status!==0||assets.signal||assets.stderr.length||!Buffer.isBuffer(assets.stdout)||assets.stdout.length>262144){
        let reason=assets.signal||assets.status!==0&&assets.status!==1||assets.status===1&&!assets.stderr.length?'ssh_exit':'ssh_stderr_frame';
        if(assets.status===1&&!assets.signal&&Buffer.isBuffer(assets.stdout)&&!assets.stdout.length&&Buffer.isBuffer(assets.stderr)&&assets.stderr.length<=96){
          const match=/^ABBOTT_ASSET_ATTESTATION_REFUSED reason=([a-z_]+)\n$/.exec(assets.stderr.toString('utf8'));
          if(match&&ASSET_ATTESTATION_REASONS.includes(match[1]))reason=match[1]==='source_proof'?'remote_source_proof':match[1];
        }
        throw markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'asset_attestation',reason);
      }
    }
    stage='issuer';issued = await guarded(() => platform.issue(code, controller.signal));
    checkForward();
    if (issued.status !== 0 || issued.signal || issued.stderr.length || !Buffer.isBuffer(issued.stdout) || issued.stdout.length > 65536) refuse();
    stage='credential_frame';const credentials = parseCredentialLines(new TextDecoder('utf8',{fatal:true}).decode(issued.stdout));
    try { if (!credentials.managerAccessToken || !issued.stdout.toString().endsWith('\n')) refuse(); }
    finally { for (const key of Object.keys(credentials)) delete credentials[key]; }
    stage='unknown';consumed = await guarded(() => { checkForward(); return platform.consume(mode, issued.stdout, controller.signal, assets?.stdout, consumer); });
    checkForward();
    const expected = mode === 'compare' ? /^status=match mismatches=0 report=created\n$/ : mode==='smoke'?/^smoke=passed checks=[1-9]\d*\n$/:/^captures=[1-9]\d* errors=0 index=created\n$/;
    if (consumed.status !== 0 || consumed.signal || consumed.stderr.length || !expected.test(consumed.stdout.toString())) throw diagnosticFromChild(consumed);
    passed = true;
  } catch(error) { passed = false;failure??=carryDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),error,stage,stage==='asset_attestation'?assetBoundary:stage==='unknown'?'unknown':'failed'); }
  finally {
    // Attempt each buffer independently so a malformed result cannot prevent
    // zeroing other output or running the owned-forward finalizer.
    for(const result of [{stdout:code},issued,consumed,assets]){
      try{erase(result);}catch{passed=false;failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'cleanup','guarded_cleanup');}
    }
    try {
      if (proof) {
        // Only our deliberate shutdown may end the tunnel without cancelling
        // a finished verification. OS signal handlers remain installed.
        if (passed) checkForward();
        tearingDown = true;
      }
    } catch { passed = false; tearingDown = true;failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'forward','failed'); }
    try {
      if (proof) { await platform.closeForward(proof); platform.recordForward?.(proof, true); }
    } catch { passed = false;failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'cleanup','failed'); }
    finally {
      for(const cleanup of [()=>clearTimer(watchdog),()=>proof?.failure?.removeEventListener('abort',forwardFailed),
        ()=>platform.signalSource.removeListener('SIGINT',interrupt),()=>platform.signalSource.removeListener('SIGTERM',interrupt)]){
        try{cleanup();}catch{passed=false;failure=markDiagnostic(new Error('ABBOTT_VERIFICATION_REFUSED'),'cleanup','guarded_cleanup');}
      }
    }
  }
  if(controller.signal.aborted||!passed)throw failure??new Error('ABBOTT_VERIFICATION_REFUSED');
  return { mode, status:'passed', forward:{pid:proof.pid,start:proof.start,exitVerified:true} };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) refuse();
    const result = await runAbbottVerification(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch(error) { process.stderr.write(formatVerificationFailure(error)); process.exitCode=1; }
}
