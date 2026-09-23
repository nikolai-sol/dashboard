import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const failures=new WeakMap();
const failure=reason=>{const error=new Error('ABBOTT_VERIFICATION_REFUSED');failures.set(error,reason);return error;};
export const boundedChildFailureReason=error=>failures.get(error)??'unknown';

// Leaf module: consumers must never import the CLI that is awaiting them.
export function captureBoundedChild(binary, args, { input, timeout, maxBytes, signal, cwd = ROOT, graceMs = 2000, spawnChild = spawn }) {
  return new Promise((resolve, reject) => {
    const output = [], errors = [];
    let bytes = 0, failed = null, killTimer, child;
    try { child = spawnChild(binary, args, { cwd, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(failure('spawn'));return; }
    const stop = reason => {
      failed ??= reason;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      killTimer ??= setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, graceMs);
    };
    const collect = target => chunk => {
      bytes += chunk.length;
      if (failed || bytes > maxBytes) { chunk.fill(0); stop('limit'); } else target.push(chunk);
    };
    const timer = setTimeout(()=>stop('timeout'), timeout),abort=()=>stop('abort');
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.stdin.on('error', () => { failed ??= 'stdin'; });
    child.on('error', () => { failed ??= 'spawn'; });
    child.on('close', (status, childSignal) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      const result = { status, signal: childSignal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) };
      for (const buffer of [...output, ...errors]) buffer.fill(0);
      if (failed) { result.stdout.fill(0); result.stderr.fill(0); reject(failure(failed)); } else resolve(result);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else try { child.stdin.end(input); } catch { stop('stdin'); }
  });
}
