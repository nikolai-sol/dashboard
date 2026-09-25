import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const image = 'sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb';
const name = `abbott-summary-parity-${randomBytes(6).toString('hex')}`;
const password = 'disposable-abbott-fixture-only';
let id, child = null, killTimer, volumes = [], cancelled = false;
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw Error(`Fixture Docker command failed: ${args[0]}`);
  return result.stdout.trim();
};
const stopChild = () => {
  if (!child || !child.pid) return;
  child.kill('SIGTERM');
  killTimer ??= setTimeout(() => { if (child?.pid) child.kill('SIGKILL'); }, 5000);
};
const cancel = () => { cancelled = true; stopChild(); };
async function runTestChild(executable, args, env) {
  child = spawn(executable, args, { stdio: 'inherit', env });
  let spawnError;
  const timer = setTimeout(stopChild, 180000);
  const code = await new Promise(resolve => {
    child.once('error', error => { spawnError = error; });
    // close also fires after a failed spawn; exit need not. Retire this owned
    // process before any later cleanup can signal a reused numeric identity.
    child.once('close', code => { child = null; resolve(code); });
  });
  clearTimeout(timer); clearTimeout(killTimer); killTimer = undefined;
  if (spawnError || code !== 0 || cancelled) throw Error('Fixture parity child failed');
}
if (process.argv[2] === '--check-spawn-failure') {
  for (const missing of [`${process.execPath}/missing-fixture-executable`, `${process.execPath}.missing-fixture-executable`]) {
  const start = Date.now();
  let refused = false;
  try { await runTestChild(missing, [], {}); } catch { refused = true; }
  if (!refused || child !== null || Date.now() - start > 5000) throw Error('Failed-spawn cleanup regression');
  }
  console.log(JSON.stringify({ failedSpawnClosed: true, dockerInvocations: 0 }));
} else {
if (process.argv.length !== 2) throw Error('Unexpected fixture arguments');
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
try {
  if (docker('image', 'inspect', image, '--format', '{{.Id}}') !== image) throw Error('Fixture image mismatch');
  id = docker('run', '--pull=never', '-d', '--name', name, '--cpus=1', '--memory=1g', '--memory-swap=1g', '-p', '127.0.0.1::3306', '-e', `MYSQL_ROOT_PASSWORD=${password}`, image);
  volumes = JSON.parse(docker('inspect', id))[0].Mounts.map(m => m.Name).filter(Boolean);
  console.log(JSON.stringify({ fixtureId: id, fixtureName: name, volumes, node: process.version, icu: process.versions.icu }));
  const deadline = Date.now() + 180000;
  let ready = false;
  while (!cancelled && Date.now() < deadline) {
    const result = spawnSync('docker', ['exec', id, 'mysqladmin', 'ping', '-h127.0.0.1', '-uroot', `-p${password}`, '--silent'], { timeout: 5000, stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready || cancelled) throw Error('Fixture readiness refused');
  const port = docker('port', id, '3306/tcp').split(':').at(-1);
  await runTestChild(process.execPath, ['--max-old-space-size=512', '--import', 'tsx', '--test', 'scripts/abbott-read-parity.mysql.test.mjs'],
    { ...process.env, ABBOTT_TEST_MYSQL_PORT: port, ABBOTT_TEST_MYSQL_PASSWORD: password });
} finally {
  process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  if (id) {
    let cleanupError = false;
    try { docker('stop', '--time=10', id); } catch { cleanupError = true; }
    try { docker('rm', '-v', id); } catch { cleanupError = true; }
    // Only successful inventories prove absence; a dead Docker daemon does not.
    const gone = !docker('ps', '-a', '--no-trunc', '--format', '{{.ID}}').split('\n').includes(id);
    const remainingVolumes = docker('volume', 'ls', '--format', '{{.Name}}').split('\n');
    const volumesGone = volumes.every(volume => !remainingVolumes.includes(volume));
    console.log(JSON.stringify({ fixtureId: id, stoppedAndRemoved: gone, volumesRemoved: volumesGone }));
    if (cleanupError || !gone || !volumesGone) throw Error('Fixture cleanup failed');
  }
}
}
