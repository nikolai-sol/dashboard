import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

export const SHADOW_CONTROL_FILES=Object.freeze([
  'deploy/zaruku/mysql-read-tables.json','deploy/zaruku/production-shadow.json','deploy/zaruku/release.json',
  'scripts/install-zaruku-shadow-auth.mjs','scripts/install-zaruku-shadow-inventory.mjs','scripts/runtime-release-remote.mjs','scripts/verify-zaruku-shadow.sh',
  'scripts/zaruku-production-shadow-authority.mjs','scripts/zaruku-production-shadow-preflight.mjs','scripts/zaruku-production-shadow-worker.mjs',
  'scripts/zaruku-shadow-coverage.mjs','scripts/zaruku-shadow-db.mjs','scripts/zaruku-shadow-dispatch.mjs','scripts/zaruku-shadow-evidence-lock.py','scripts/zaruku-shadow-host.mjs','scripts/zaruku-shadow-mysql-session.mjs','scripts/zaruku-shadow-mysql-session.py','scripts/zaruku-shadow-mysql.py','scripts/zaruku-shadow-provision.mjs','scripts/zaruku-xlsx-semantic.py',
]);

const ROOT = path.resolve(import.meta.dirname, '..');
const same = isDeepStrictEqual;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = () => { throw new Error('Zaruku staged dispatcher refused'); };
const snapshot=stat=>({dev:String(stat.dev),ino:String(stat.ino),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,nlink:stat.nlink,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs});

function safeAncestors(filename,io=fs) {
  for(let dir=path.dirname(filename);;dir=path.dirname(dir)){
    const stat=io.lstatSync(dir);
    if(!stat.isDirectory()||stat.uid!==0||stat.gid!==0||stat.mode&0o022)refuse();
    if(dir==='/')break;
  }
}

function readProtected(filename,mode,max=65536,io=fs) {
  safeAncestors(filename,io);
  const fd=io.openSync(filename,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);
  try {
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.uid!==0||before.gid!==0||before.mode&0o022||mode!==undefined&&(before.mode&0o777)!==mode||before.size>max)refuse();
    const bytes=io.readFileSync(fd),after=io.fstatSync(fd);
    if(!same(snapshot(before),snapshot(after))||!same(snapshot(after),snapshot(io.lstatSync(filename))))refuse();
    return {bytes,identity:snapshot(after),sha256:hash(bytes)};
  } finally {io.closeSync(fd);}
}

export function attestStagedControl() {
  const match=/^\/var\/www\/\.dashboard-zaruku-shadow\/control\/([a-f0-9]{40})$/.exec(ROOT);
  if(process.platform!=='linux'||process.getuid()!==0||process.geteuid()!==0||!match)refuse();
  const manifest=JSON.parse(readProtected(path.join(ROOT,'.manifest.json'),0o400).bytes);
  const inodes=JSON.parse(readProtected(path.join(ROOT,'.inodes.json'),0o400).bytes);
  if(manifest.sourceSha!==match[1]||!same(manifest.files?.map(row=>row.path),SHADOW_CONTROL_FILES))refuse();
  if (!same(Object.keys(inodes).sort(), [...SHADOW_CONTROL_FILES, '.manifest.json', '.inodes.json', 'directories'].sort())) refuse();
  for (const name of ['.manifest.json', '.inodes.json']) {
    const file = readProtected(path.join(ROOT, name), 0o400), pin = inodes[name];
    if (!pin || pin.dev !== file.identity.dev || pin.ino !== file.identity.ino || pin.uid !== 0 || pin.gid !== 0 || pin.mode !== 0o400 || pin.links !== 1) refuse();
  }
  for(const row of manifest.files){
    const file=readProtected(path.join(ROOT,row.path),0o400,1048576),pin=inodes[row.path];
    if(row.mode!==0o400||file.bytes.length!==row.size||file.sha256!==row.sha256||!pin||pin.dev!==file.identity.dev||pin.ino!==file.identity.ino||pin.uid!==0||pin.gid!==0||pin.mode!==0o400||pin.links!==1)refuse();
  }
  const directories = [['shadow', '/var/www/.dashboard-zaruku-shadow', 0o700], ['control', '/var/www/.dashboard-zaruku-shadow/control', 0o700], ...['', 'deploy', 'deploy/zaruku', 'scripts'].map(name => [`bundle/${name}`, path.join(ROOT, name), 0o500])];
  if (!same(Object.keys(inodes.directories ?? {}).sort(), directories.map(([name]) => name).sort())) refuse();
  for (const [name, directory, mode] of directories) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || !same(inodes.directories[name], {dev:String(stat.dev),ino:String(stat.ino),uid:stat.uid,gid:stat.gid,mode:stat.mode & 0o777}) || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== mode) refuse();
    if (name.startsWith('bundle/')) {
      const relative = name.slice('bundle/'.length);
      const expected = relative === '' ? ['.inodes.json','.manifest.json','deploy','scripts'] : relative === 'deploy' ? ['zaruku'] : SHADOW_CONTROL_FILES.filter(file => path.posix.dirname(file) === relative).map(file => path.posix.basename(file));
      if (!same(fs.readdirSync(directory).sort(), expected.sort())) refuse();
    }
  }
  return match[1];
}

export function attestStagedPredecessor() {
  const sourceSha = attestStagedControl();
  const manifest = readProtected(path.join(ROOT, '.manifest.json'), 0o400);
  const shadow = fs.lstatSync('/var/www/.dashboard-zaruku-shadow');
  if (!shadow.isDirectory() || shadow.uid !== 0 || shadow.gid !== 0 || (shadow.mode & 0o7777) !== 0o700) refuse();
  return { sourceSha, manifestDigest: manifest.sha256, dev: Number(shadow.dev), ino: Number(shadow.ino) };
}


function fixedEnvironment() {
  if (process.env.UV_USE_IO_URING === '0') delete process.env.UV_USE_IO_URING;
  if (Object.keys(process.env).length) refuse();
}

/** Core-only bootstrap: no staged dependency executes before the complete closure check. */
export async function dispatchStaged(action, payload = null) {
  fixedEnvironment();
  const sourceSha = attestStagedControl();
  const guard = () => { fixedEnvironment(); if (attestStagedControl() !== sourceSha) refuse(); };
  if (action === 'attest' && payload === null) return { passed: true, sourceSha };
  if (['host-check', 'host-apply', 'host-rollback'].includes(action) && payload === null) {
    const host = await import('./zaruku-shadow-host.mjs'); guard();
    const adapter = host.createHostAdapter();
    for (const method of ['createGroup', 'createUser', 'deleteUser', 'deleteGroup']) {
      const original = adapter[method]; adapter[method] = (...args) => { guard(); return original(...args); };
    }
    if (action === 'host-check') return host.inspectHostBoundary(adapter);
    if (action === 'host-apply') return host.applyHostBoundary(adapter);
    const record = JSON.parse(readProtected('/var/www/.dashboard-zaruku-host-creation.json', 0o600).bytes);
    await host.rollbackNewHostBoundary(adapter, record); return { passed: true };
  }
  if (action === 'auth-install' && payload === null) {
    const auth = await import('./install-zaruku-shadow-auth.mjs'); guard();
    const adapter = auth.createAuthAdapter(), publish = adapter.publishDescriptor;
    adapter.publishDescriptor = bytes => { guard(); return publish(bytes); };
    return auth.installShadowAuth(adapter);
  }
  if (action === 'db-provision' && payload === null) {
    const provision = await import('./zaruku-shadow-provision.mjs'); guard();
    return provision.provisionReaderAndSecrets(sourceSha,guard);
  }
  if (['inventory-check', 'inventory-install'].includes(action) && payload === null) {
    const worker = await import('./zaruku-production-shadow-worker.mjs'); guard();
    const value = action === 'inventory-check' ? worker.inspectFixedInventory() : worker.installFixedInventory();
    return { passed: true, sha256: value.inventorySha256, entries: value.foreignShas.length };
  }
  if (action === 'worker' && payload && Object.keys(payload).sort().join(',') === 'action,request' && payload.request?.sourceSha === sourceSha) {
    const worker = await import('./zaruku-production-shadow-worker.mjs'); guard();
    return worker.runShadowWorker(payload.action, payload.request);
  }
  if (action === 'release' && payload && ['inspect', 'deploy', 'rollback'].includes(payload.action)) {
    const worker = await import('./runtime-release-remote.mjs'); guard();
    if (payload.action === 'deploy' && payload.payload?.sourceSha !== sourceSha) refuse();
    return worker.transact(payload, undefined, guard);
  }
  refuse();
}

async function dispatchMain() {
  try {
    if (process.argv.length !== 3) refuse();
    process.stdout.write(JSON.stringify(await dispatchStaged(process.argv[2])) + '\n');
  } catch { process.stderr.write('Zaruku staged dispatcher refused\n'); process.exitCode = 1; }
}
// Complete module evaluation before an action imports the authority re-export.
// Awaiting this at top level would deadlock those reviewed dependency cycles.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) dispatchMain();
