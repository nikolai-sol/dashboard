import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parseCredentialLines } from './compare-abbott-runtime.mjs';
import { HOST } from './bootstrap-abbott-host.mjs';

const ROOT = '/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation';
const OUTPUT = '/Users/nafanya/Downloads/Abbott-dashboard-cutover-evidence-2026-09-14';
const BASELINE = '/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14';
const AUTH_HASH = '71fad58b4eb66b2cd5dd29b7c463043c5cc8a04d839e597a14e0d9a2fae8e64f';
const refuse = () => { throw new Error('ABBOTT_VERIFICATION_REFUSED'); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const erase = result => { result?.stdout?.fill(0); result?.stderr?.fill(0); };

export function fixedSshInvocation(kind) {
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=10'];
  if (kind === 'issuer') args.push('--', 'beget', '/usr/bin/env -i /usr/bin/node --input-type=module');
  else if (kind === 'forward') args.push('-N', '-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:3001:127.0.0.1:3001', '-L', '127.0.0.1:3004:127.0.0.1:3004', '--', 'beget');
  else refuse();
  return { binary: '/usr/bin/ssh', args };
}

export function captureBoundedChild(binary, args, { input, timeout, maxBytes, signal, cwd = ROOT, graceMs = 2000 }) {
  return new Promise((resolve, reject) => {
    const output = [], errors = [];
    let bytes = 0, failed = false, killTimer;
    const child = spawn(binary, args, { cwd, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => {
      failed = true;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      killTimer ??= setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, graceMs);
    };
    const collect = target => chunk => {
      bytes += chunk.length;
      if (failed || bytes > maxBytes) { chunk.fill(0); stop(); } else target.push(chunk);
    };
    const timer = setTimeout(stop, timeout);
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.stdin.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    child.on('close', (status, childSignal) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
      const result = { status, signal: childSignal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) };
      for (const buffer of [...output, ...errors]) buffer.fill(0);
      if (failed) { erase(result); reject(new Error('ABBOTT_VERIFICATION_REFUSED')); } else resolve(result);
    });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop(); else child.stdin.end(input);
  });
}

export function buildIssuerCapsule({ bootstrapSource, issuerSource, authSource }) {
  if (createHash('sha256').update(authSource).digest('hex') !== AUTH_HASH) refuse();
  const signingCode = ts.transpileModule(authSource.toString(), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const code = `try { const proof=await import(${JSON.stringify(moduleUrl(bootstrapSource))}); const issuer=await import(${JSON.stringify(moduleUrl(issuerSource))}); await issuer.runRemoteIssuer(proof.readVerifiedAbbottSource,${JSON.stringify(signingCode)}); } catch { process.stderr.write('ABBOTT_ISSUER_REFUSED\\n');process.exitCode=1; }\n`;
  if (Buffer.byteLength(code) > 262144) refuse();
  return Buffer.from(code);
}

function productionCapsule() {
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
  return buildIssuerCapsule({ bootstrapSource: git('show', 'HEAD:scripts/bootstrap-abbott-host.mjs'), issuerSource: git('show', 'HEAD:scripts/abbott-parity-issuer.mjs'), authSource: git('show', `${HOST.sourceSha}:src/lib/access-auth.ts`) });
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
      if (processStart(proof.pid) !== proof.start) refuse();
      child.kill(killSignal);
      await Promise.race([proof.exit, delay(2000)]);
    }
    if (!proof.closed) refuse();
  } finally { for (const buffer of proof.buffers) buffer.fill(0); }
}

async function openOwnedForward(signal) {
  await assertPortsFree();
  if (signal.aborted) refuse();
  const invocation = fixedSshInvocation('forward');
  const child = spawn(invocation.binary, invocation.args, { cwd: ROOT, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore','pipe','pipe'] });
  const proof = { child, pid: child.pid, start: '', buffers: [], closed: false, failed: false };
  proof.exit = new Promise(resolve => child.once('close', () => { proof.closed = true; resolve(); }));
  child.on('error', () => { proof.failed = true; });
  const collect = chunk => { proof.failed = true; chunk.fill(0); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  try {
    proof.start = processStart(proof.pid);
    if (!proof.start) refuse();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (signal.aborted || proof.closed || proof.failed) refuse();
      let listeners = [];
      try {
        listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(proof.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { env: {}, encoding: 'utf8', timeout: 1000, stdio: ['ignore','pipe','pipe'] }).trim().split('\n').filter(line => line.startsWith('n')).sort();
      } catch {}
      if (JSON.stringify(listeners) === JSON.stringify(['n127.0.0.1:3001','n127.0.0.1:3004'])) return proof;
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
  openForward: openOwnedForward, closeForward: closeOwnedForward,
  recordForward(proof, exitVerified) {
    process.stdout.write(JSON.stringify({forward:{pid:proof.pid,start:proof.start,exitVerified}}) + '\n');
  },
  issue(code, signal) {
    const invocation = fixedSshInvocation('issuer');
    return captureBoundedChild(invocation.binary, invocation.args, { input: code, signal, timeout: 30000, maxBytes: 65536 });
  },
  consume(mode, input, signal) {
    const args = mode === 'compare'
      ? ['scripts/compare-abbott-runtime.mjs','--reference','http://127.0.0.1:3001','--candidate','http://127.0.0.1:3004','--output-parent',OUTPUT]
      : ['scripts/capture-abbott-runtime.mjs','--login','http://127.0.0.1:3001','--candidate','http://127.0.0.1:3004','--baseline',BASELINE,'--output-parent',OUTPUT];
    // The reviewed capture owns Chromium cleanup; allow its bounded signal path
    // to finish before escalating termination of the consumer process.
    return captureBoundedChild(process.execPath, args, { input, signal, timeout: mode === 'capture' ? 600000 : 180000, graceMs: mode === 'capture' ? 30000 : 2000, maxBytes: 65536 });
  },
};

export async function runAbbottVerification(mode, platform = realPlatform) {
  let proof, code, issued, consumed;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const active = () => { if (controller.signal.aborted) refuse(); };
  platform.signalSource.once('SIGINT', interrupt); platform.signalSource.once('SIGTERM', interrupt);
  try {
    if (!['compare','capture'].includes(mode)) refuse();
    code = platform.capsule(); active();
    platform.prepareOutput(); active();
    proof = await platform.openForward(controller.signal); active();
    platform.recordForward?.(proof, false);
    issued = await platform.issue(code, controller.signal); active();
    if (issued.status !== 0 || issued.signal || issued.stderr.length || !Buffer.isBuffer(issued.stdout) || issued.stdout.length > 65536) refuse();
    const credentials = parseCredentialLines(new TextDecoder('utf8',{fatal:true}).decode(issued.stdout));
    try { if (!credentials.managerAccessToken || !issued.stdout.toString().endsWith('\n')) refuse(); }
    finally { for (const key of Object.keys(credentials)) delete credentials[key]; }
    consumed = await platform.consume(mode, issued.stdout, controller.signal); active();
    const expected = mode === 'compare' ? /^status=match mismatches=0 report=created\n$/ : /^captures=[1-9]\d* errors=0 index=created\n$/;
    if (consumed.status !== 0 || consumed.signal || consumed.stderr.length || !expected.test(consumed.stdout.toString())) refuse();
    return { mode, status:'passed', forward:{pid:proof.pid,start:proof.start,exitVerified:true} };
  } catch { refuse(); }
  finally {
    code?.fill(0); erase(issued); erase(consumed);
    platform.signalSource.removeListener('SIGINT', interrupt); platform.signalSource.removeListener('SIGTERM', interrupt);
    if (proof) { try { await platform.closeForward(proof); platform.recordForward?.(proof, true); } catch { refuse(); } }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) refuse();
    const result = await runAbbottVerification(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { process.stderr.write('ABBOTT_VERIFICATION_REFUSED\n'); process.exitCode=1; }
}
