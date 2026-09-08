import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SHADOW_CONTROL_FILES as CONTROL_FILES } from './zaruku-production-shadow-authority.mjs';
export { CONTROL_FILES };
const ROOT = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Refusing Zaruku reviewed control operation'); };

/** Self-contained worker: only core modules and the embedded reviewed inventory. */
export async function receiveControlPayload(bytes, expectedDigest, runtime, inspectOnly = false) {
  const io = runtime?.fs ?? (await import('node:fs')).default;
  const { createHash } = await import('node:crypto');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const refuse = () => { throw new Error('Refusing Zaruku reviewed control operation'); };
  const openDirectories = [];
  try {
    const identity = runtime?.identity ?? { uid: process.getuid(), euid: process.geteuid() };
    if (identity.uid !== 0 || identity.euid !== 0 || !runtime && process.platform !== 'linux') refuse();
    if (!Buffer.isBuffer(bytes) || bytes.length > 2097152 || !/^[a-f0-9]{64}$/.test(expectedDigest) || digest(bytes) !== expectedDigest) refuse();
    const payload = JSON.parse(bytes);
    if (JSON.stringify(payload) !== bytes.toString('utf8') || Object.keys(payload).join(',') !== 'sourceSha,manifest,files' || !/^[a-f0-9]{40}$/.test(payload.sourceSha)) refuse();
    const { sourceSha, manifest, files } = payload;
    if (Object.keys(manifest).join(',') !== 'sourceSha,files' || manifest.sourceSha !== sourceSha || !Array.isArray(files) || !Array.isArray(manifest.files) || files.length !== CONTROL_FILES.length || manifest.files.length !== files.length) refuse();
    for (let index = 0; index < files.length; index++) {
      const file = files[index], record = manifest.files[index];
      if (Object.keys(file).join(',') !== 'path,data' || Object.keys(record).join(',') !== 'path,mode,size,sha256' || file.path !== CONTROL_FILES[index] || record.path !== file.path || record.mode !== 0o400 || typeof file.data !== 'string') refuse();
      const data = Buffer.from(file.data, 'base64');
      if (data.toString('base64') !== file.data || data.length !== record.size || digest(data) !== record.sha256) refuse();
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const destination = `/var/www/.dashboard-zaruku-shadow/control/${sourceSha}`;
    const anchor = runtime?.anchor ?? ((fd, name) => `/proc/self/fd/${fd}/${name}`);
    const snapshot = stat => ({ dev: String(stat.dev), ino: String(stat.ino), uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777, links: stat.nlink });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const safe = (stat, directory, mode) => {
      if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.uid !== 0 || stat.gid !== 0 || mode !== undefined && (stat.mode & 0o777) !== mode || !directory && stat.nlink !== 1 || stat.mode & 0o022) refuse();
    };
    const directory = (name, parent, create, mode = 0o700) => {
      const target = parent === null ? name : anchor(parent, name);
      let existed = true;
      try { io.lstatSync(target); } catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        io.mkdirSync(target, { mode }); io.fsyncSync(parent); existed = false;
      }
      const fd = io.openSync(target, io.constants.O_RDONLY | io.constants.O_DIRECTORY | io.constants.O_NOFOLLOW);
      const stat = io.fstatSync(fd); safe(stat, true, parent === null || ['var', 'www'].includes(name) ? undefined : mode);
      const record = { fd, target, identity: snapshot(stat) }; openDirectories.push(record);
      return { fd, existed };
    };
    const root = directory(runtime?.root ?? '/', null, false).fd;
    const varDir = directory('var', root, false).fd, www = directory('www', varDir, false).fd;
    const shadow = directory('.dashboard-zaruku-shadow', www, !inspectOnly).fd;
    const control = directory('control', shadow, !inspectOnly).fd;
    let exists = true; try { io.lstatSync(anchor(control, sourceSha)); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (inspectOnly && !exists) refuse();
    const bundle = directory(sourceSha, control, !inspectOnly, exists ? 0o500 : 0o700).fd;
    const pins = new Map([['', bundle]]);
    for (const name of ['deploy', 'deploy/zaruku', 'scripts']) {
      const split = name.lastIndexOf('/'), parent = split < 0 ? '' : name.slice(0, split), base = name.slice(split + 1);
      pins.set(name, directory(base, pins.get(parent), !exists, exists ? 0o500 : 0o700).fd);
    }
    const records = {};
    const directoryPins = () => Object.fromEntries([
      ['shadow', shadow], ['control', control], ...[...pins].map(([name, fd]) => [`bundle/${name}`, fd]),
    ].map(([name, fd]) => {
      const stat = io.fstatSync(fd);
      return [name, { dev: String(stat.dev), ino: String(stat.ino), uid: stat.uid, gid: stat.gid, mode: name === 'shadow' || name === 'control' ? 0o700 : 0o500 }];
    }));
    const targetFor = name => { const split = name.lastIndexOf('/'); return anchor(pins.get(split < 0 ? '' : name.slice(0, split)), name.slice(split + 1)); };
    const read = name => {
      const fd = io.openSync(targetFor(name), io.constants.O_RDONLY | io.constants.O_NOFOLLOW);
      try {
        const before = io.fstatSync(fd); safe(before, false, 0o400);
        const data = io.readFileSync(fd), after = io.fstatSync(fd);
        if (!same(snapshot(before), snapshot(after)) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || !same(snapshot(after), snapshot(io.lstatSync(targetFor(name))))) refuse();
        records[name] = snapshot(after); return data;
      } finally { io.closeSync(fd); }
    };
    const publish = (name, data) => {
      const fd = io.openSync(targetFor(name), io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | io.constants.O_NOFOLLOW, 0o600);
      try { io.fchownSync(fd, 0, 0); io.writeFileSync(fd, data); io.fchmodSync(fd, 0o400); io.fsyncSync(fd); }
      finally { io.closeSync(fd); }
      if (!read(name).equals(data)) refuse();
    };
    if (!exists) {
      for (const file of files) publish(file.path, Buffer.from(file.data, 'base64'));
      publish('.manifest.json', manifestBytes);
      // Allocate the inode journal first so its own inode is also pinned.
      const fd = io.openSync(targetFor('.inodes.json'), io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | io.constants.O_NOFOLLOW, 0o600);
      try {
        io.fchownSync(fd, 0, 0); io.fchmodSync(fd, 0o400);
        records['.inodes.json'] = snapshot(io.fstatSync(fd));
        io.writeFileSync(fd, JSON.stringify({ ...records, directories: directoryPins() })); io.fsyncSync(fd);
      } finally { io.closeSync(fd); }
      for (const fd of [...pins.values()].reverse()) { io.fchmodSync(fd, 0o500); io.fsyncSync(fd); }
      io.fsyncSync(control);
    }
    if (!read('.manifest.json').equals(manifestBytes)) refuse();
    for (const file of files) if (!read(file.path).equals(Buffer.from(file.data, 'base64'))) refuse();
    const expectedInodes = JSON.parse(read('.inodes.json'));
    if (!same(expectedInodes.directories, directoryPins())) refuse();
    delete expectedInodes.directories;
    if (!same(Object.keys(expectedInodes).sort(), Object.keys(records).sort())) refuse();
    for (const [name, value] of Object.entries(records)) if (!same(expectedInodes[name], value)) refuse();
    for (const [name, fd] of pins) {
      const expected = name === '' ? ['.inodes.json', '.manifest.json', 'deploy', 'scripts'] : name === 'deploy' ? ['zaruku'] : CONTROL_FILES.filter(file => file.slice(0, file.lastIndexOf('/')) === name).map(file => file.slice(file.lastIndexOf('/') + 1));
      if (!same(io.readdirSync(anchor(fd, '.')).sort(), expected.sort())) refuse();
    }
    for (const record of openDirectories) {
      const current = snapshot(io.lstatSync(record.target));
      const pinned = snapshot(io.fstatSync(record.fd));
      if (current.dev !== record.identity.dev || current.ino !== record.identity.ino || !same(current, pinned)) refuse();
    }
    const metadata = snapshot(io.fstatSync(bundle));
    return { sourceSha, manifestDigest: digest(manifestBytes), fileCount: files.length, destination: { path: destination, dev: metadata.dev, ino: metadata.ino, uid: metadata.uid, gid: metadata.gid, mode: '0500' } };
  } catch { refuse(); }
  finally { for (const record of openDirectories.reverse()) io.closeSync(record.fd); }
}

export async function prepareReviewedControl(adapter, sourceSha) {
  try {
    if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail();
    const before = await adapter.source();
    if (!before.clean || !before.branch || before.sha !== sourceSha) fail();
    const files = [], records = [];
    for (const name of CONTROL_FILES) {
      const file = await adapter.readFile(name);
      if (!file.regular || !file.singleLink || !file.safeAncestors || !Buffer.isBuffer(file.bytes) || file.bytes.length > 1048576 || ![0o644, 0o755].includes(file.mode)) fail();
      files.push({ path: name, data: file.bytes.toString('base64') });
      records.push({ path: name, mode: 0o400, size: file.bytes.length, sha256: hash(file.bytes) });
    }
    const after = await adapter.source();
    if (JSON.stringify(after) !== JSON.stringify(before)) fail();
    const manifest = { sourceSha, files: records };
    const bytes = Buffer.from(JSON.stringify({ sourceSha, manifest, files }));
    return {bytes,digest:hash(bytes),manifestDigest:hash(JSON.stringify(manifest))};
  } catch {fail();}
}

export async function stageReviewedShadowControl(adapter, sourceSha) {
  try {
    const prepared=await prepareReviewedControl(adapter,sourceSha);
    const result = await adapter.transfer(prepared.bytes, prepared.digest);
    if (result.sourceSha !== sourceSha || result.manifestDigest !== prepared.manifestDigest || result.fileCount !== CONTROL_FILES.length || result.destination?.path !== `/var/www/.dashboard-zaruku-shadow/control/${sourceSha}` || result.destination.uid !== 0 || result.destination.gid !== 0 || result.destination.mode !== '0500' || !/^\d+$/.test(result.destination.dev) || !/^\d+$/.test(result.destination.ino)) fail();
    return { sourceSha, manifestDigest: result.manifestDigest, fileCount: result.fileCount, destination: { path: result.destination.path, dev: result.destination.dev, ino: result.destination.ino, uid: 0, gid: 0, mode: '0500' } };
  } catch { fail(); }
}

export function rejectShadowOverrides(args = [], env = process.env) {
  if (args.length || Object.keys(env).some(key => key !== 'GIT_PAGER' && (/^(?:ZARUKU_|DEPLOY_|RUNTIME_|APP_|RELEASE_|SSH_|GIT_|DOCKER_)/.test(key) || ['VPS', 'PUBLIC_APP_HOST', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'RSYNC_RSH', 'REMOTE_ENV_PATH', 'TRUSTED_MANIFEST', 'TARGET_BACKUP'].includes(key)))) fail();
}

export function reviewedSource() {
  const git = args => {
    const result = spawnSync('/usr/bin/git', ['--no-replace-objects', '-C', ROOT, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_PAGER: '/bin/cat' } });
    if (result.status !== 0 || result.error || result.signal) fail(); return result.stdout.trim();
  };
  return { sha: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), clean: git(['status', '--porcelain', '--untracked-files=normal']) === '' };
}

export function readControlSource(name) {
  if (!CONTROL_FILES.includes(name)) fail();
  const filename = path.join(ROOT, name), before = fs.lstatSync(filename);
  if (!before.isFile() || before.nlink !== 1 || before.size > 1048576 || fs.realpathSync(filename) !== filename) fail();
  const fd=fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const pinned=fs.fstatSync(fd), bytes=fs.readFileSync(fd), after=fs.lstatSync(filename), final=fs.fstatSync(fd);
    for(const stat of [pinned,after,final]) if (before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size || before.mtimeMs !== stat.mtimeMs || before.ctimeMs !== stat.ctimeMs) fail();
    return { bytes, mode: before.mode & 0o777, regular: true, singleLink: true, safeAncestors: true };
  } finally { fs.closeSync(fd); }
}

export function controlTransport(bytes, digest) {
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const code = `const CONTROL_FILES=${JSON.stringify(CONTROL_FILES)};const worker=(${receiveControlPayload.toString()}); const chunks=[];for await(const b of process.stdin) chunks.push(b);try{process.stdout.write(JSON.stringify(await worker(Buffer.concat(chunks),${JSON.stringify(digest)}))+'\\n')}catch{process.stderr.write('Refusing Zaruku reviewed control operation\\n');process.exitCode=1}`;
  const result = spawnSync('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '--', 'beget', `/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(code)}`], { input: bytes, encoding: 'utf8', maxBuffer: 2097152,env:{PATH:'/usr/bin:/bin'},timeout:30000 });
  if (result.status !== 0 || result.error || result.signal || result.stderr) fail();
  return JSON.parse(result.stdout);
}

export async function stageFrozenShadowControl(adapter) {
  const {requireExactShadowRelease}=await import('./freeze-zaruku-shadow-release.mjs');
  const source=await adapter.source();
  await requireExactShadowRelease(adapter,source.sha);
  return stageReviewedShadowControl({...adapter,transfer:async(bytes,digest)=>{await requireExactShadowRelease(adapter,source.sha);return adapter.transfer(bytes,digest);}},source.sha);
}

async function stageMain() {
  try {
    rejectShadowOverrides(process.argv.slice(2));
    const {createReleaseAuthorityAdapter}=await import('./freeze-zaruku-shadow-release.mjs');
    const adapter = {...createReleaseAuthorityAdapter(),readFile: readControlSource, transfer: controlTransport };
    process.stdout.write(JSON.stringify(await stageFrozenShadowControl(adapter)) + '\n');
  } catch { process.stderr.write('Refusing Zaruku reviewed control operation\n'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) stageMain();
