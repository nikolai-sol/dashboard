import { spawn } from 'node:child_process';

const ROOT = '/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation';

// Leaf module: consumers must never import the CLI that is awaiting them.
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
      if (failed) { result.stdout.fill(0); result.stderr.fill(0); reject(new Error('ABBOTT_VERIFICATION_REFUSED')); } else resolve(result);
    });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop(); else child.stdin.end(input);
  });
}
