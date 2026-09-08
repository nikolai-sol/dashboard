import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyHostBoundary, inspectHostBoundary, rollbackNewHostBoundary, installRuntimeSecrets, createHostAdapter } from './zaruku-shadow-host.mjs';
import { installShadowAuth } from './install-zaruku-shadow-auth.mjs';

const roots = ['/var/www/dashboard-zaruku-releases', '/var/www/dashboard-zaruku-backups', '/var/www/.dashboard-zaruku-control', '/var/www/.dashboard-zaruku-secrets', '/var/www/.dashboard-zaruku-shadow', '/var/www/.dashboard-zaruku-shadow/evidence'];
const source = '/var/www/www-root/data/.production.env';
const destination = '/var/www/.dashboard-zaruku-secrets/runtime.env';
const recordPath = '/var/www/.dashboard-zaruku-host-creation.json';
const privateValue = Buffer.from('opaque-fixture-value').toString('base64');

// Only OS identity/ownership and anchored paths are injected; all file I/O is real and disposable.
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-host-'));
  const resolve = name => path.join(temp, name);
  for (const name of ['/var/www/www-root/data']) fs.mkdirSync(resolve(name), { recursive: true, mode: 0o755 });
  let user = null, group = null, resolution = {};
  const calls = [], descriptors = new Map(), overrides = new Map();
  const io = new Proxy(fs, { get(target, key) {
    if (key === 'lstatSync') return (name, options) => {
      const stat = fs.lstatSync(resolve(name), options);
      if (!stat) return stat;
      const zero = options?.bigint ? 0n : 0;
      return Object.assign(stat, { uid: zero, gid: zero }, overrides.get(name));
    };
    if (key === 'fstatSync') return (fd, options) => {
      const stat = fs.fstatSync(fd, options), zero = options?.bigint ? 0n : 0;
      return Object.assign(stat, { uid: zero, gid: zero }, overrides.get(descriptors.get(fd)));
    };
    if (key === 'openSync') return (name, flags, mode) => { const fd = fs.openSync(resolve(name), flags, mode); descriptors.set(fd, name); return fd; };
    if (key === 'closeSync') return fd => { descriptors.delete(fd); fs.closeSync(fd); };
    if (key === 'fchownSync') return () => {};
    if (['mkdirSync', 'rmdirSync', 'unlinkSync', 'readdirSync', 'chmodSync'].includes(key)) return (name, ...args) => fs[key](resolve(name), ...args);
    if (['linkSync', 'renameSync'].includes(key)) return (from, to) => fs[key](resolve(from), resolve(to));
    return target[key];
  } });
  const commandRunner = (bin, args) => {
    calls.push({ bin, args });
    let stdout = '', status = 0;
    if (bin === '/usr/bin/getent') {
      if (args[0] === 'passwd') { if (user) stdout = `dashboard-zaruku:x:${user.uid}:${user.gid}::${user.home}:${user.shell}\n`; else status = 2; }
      else if (!group) status = 2;
      else {
        stdout = `dashboard-zaruku:x:${group.gid}:${group.members.join(',')}\n`;
        if (args.length === 1) {
          stdout += (resolution.aliases ?? []).map(name => `${name}:x:${group.gid}:\n`).join('');
          if (resolution.enumeration !== undefined) stdout = resolution.enumeration;
          if (resolution.enumerationStatus !== undefined) status = resolution.enumerationStatus;
        } else if (args[1] !== 'dashboard-zaruku') {
          if (resolution.reverseName) stdout = `${resolution.reverseName}:x:${group.gid}:\n`;
          if (resolution.reverseStatus !== undefined) { status = resolution.reverseStatus; stdout = ''; }
        }
      }
    } else if (bin === '/usr/bin/id') stdout = user?.groups?.join(' ') ?? '901';
    else if (bin === '/usr/bin/ss') stdout = '';
    else if (bin === '/usr/sbin/groupadd') group = { gid: 901, members: [] };
    else if (bin === '/usr/sbin/useradd') user = { uid: 901, gid: 901, shell: '/usr/sbin/nologin', home: '/nonexistent', groups: [901] };
    else if (bin === '/usr/sbin/userdel') user = null;
    else if (bin === '/usr/sbin/groupdel') group = null;
    else throw new Error('Unexpected fixture command');
    return { stdout, stderr: '', status, signal: null };
  };
  const adapter = createHostAdapter({ fs: io, commandRunner, identity: () => ({ uid: 0, euid: 0 }), platform: 'linux', anchoredPath: (fd, name) => path.posix.join(descriptors.get(fd), name) });
  return { adapter, io, calls, descriptors, overrides, resolve,
    setUser(value) { user = value; }, setGroup(value) { group = value; },
    setGroupResolution(value) { resolution = value; },
    write(name, bytes, mode = 0o600) { fs.writeFileSync(resolve(name), bytes, { mode }); },
    close() { for (const fd of descriptors.keys()) fs.closeSync(fd); fs.rmSync(temp, { recursive: true, force: true }); },
  };
}

test('host check is read-only; apply creates exact no-login identity and six private roots', async () => {
  const f = fixture();
  try {
    assert.equal((await inspectHostBoundary(f.adapter)).state, 'absent');
    assert.equal(f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length, 0);
    const evidence = await applyHostBoundary(f.adapter);
    assert.equal(evidence.state, 'compliant');
    assert.equal(evidence.listener.port3002Free, true);
    assert.deepEqual(f.calls.filter(call => call.bin.startsWith('/usr/sbin/')), [
      { bin: '/usr/sbin/groupadd', args: ['--system', 'dashboard-zaruku'] },
      { bin: '/usr/sbin/useradd', args: ['--system', '--gid', 'dashboard-zaruku', '--shell', '/usr/sbin/nologin', '--home-dir', '/nonexistent', '--no-create-home', '--no-user-group', 'dashboard-zaruku'] },
    ]);
    for (const name of roots) assert.equal(fs.statSync(f.resolve(name)).mode & 0o777, 0o700);
    for (const name of ['/var/www/dashboard-zaruku', '/var/www/.dashboard-zaruku-deploy.lock']) assert.equal(fs.existsSync(f.resolve(name)), false);
    assert.equal(fs.statSync(f.resolve(recordPath)).mode & 0o777, 0o600);
    const record = JSON.parse(fs.readFileSync(f.resolve(recordPath)));
    assert.equal(record.steps.length, 8);
    assert.ok(record.steps.every(step => step.before === null && step.after));
    const beforeCalls = f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length;
    await applyHostBoundary(f.adapter);
    assert.equal(f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length, beforeCalls);
  } finally { f.close(); }
});

test('host rejects partial identities, memberships, unsafe ancestry, roots and occupied listener before mutation', async () => {
  for (const attack of ['partial', 'shell', 'groups', 'ancestry', 'root', 'listener', 'uid', 'euid']) {
    const f = fixture();
    try {
      if (['shell', 'groups'].includes(attack)) {
        f.setGroup({ gid: 901, members: [] });
        f.setUser({ uid: 901, gid: 901, home: '/nonexistent', shell: attack === 'shell' ? '/bin/bash' : '/usr/sbin/nologin', groups: attack === 'groups' ? [901, 0] : [901] });
      }
      if (attack === 'partial') f.setGroup({ gid: 901, members: [] });
      if (attack === 'ancestry') fs.chmodSync(f.resolve('/var/www'), 0o777);
      if (attack === 'root') fs.symlinkSync(f.resolve('/var/www'), f.resolve(roots[0]));
      if (attack === 'listener') f.adapter.port3002Free = () => false;
      if (attack === 'uid' || attack === 'euid') f.adapter.currentIdentity = () => ({ uid: attack === 'uid' ? 1000 : 0, euid: attack === 'euid' ? 1000 : 0 });
      await assert.rejects(applyHostBoundary(f.adapter), /Zaruku host boundary/);
      assert.equal(f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length, 0);
      assert.equal(fs.existsSync(f.resolve(recordPath)), false);
    } finally { f.close(); }
  }
});

test('host rejects primary GID aliases and incomplete NSS group resolution before accepting existing state', async () => {
  for (const resolution of [
    { reverseName: 'sudo' },
    { aliases: ['sudo'] },
    { aliases: ['foreign-group'] },
    { enumeration: '' },
    { enumeration: 'malformed' },
    { enumeration: 'other:x:901:\n' },
    { enumerationStatus: 3 },
    { reverseStatus: 2 },
  ]) {
    const f = fixture();
    try {
      await applyHostBoundary(f.adapter);
      f.setGroup({ gid: 27, members: [] });
      f.setUser({ uid: 901, gid: 27, home: '/nonexistent', shell: '/usr/sbin/nologin', groups: [27] });
      f.setGroupResolution(resolution);
      const mutations = f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length;
      await assert.rejects(inspectHostBoundary(f.adapter), /Zaruku host boundary/);
      await assert.rejects(applyHostBoundary(f.adapter), /Zaruku host boundary/);
      assert.equal(f.calls.filter(call => call.bin.startsWith('/usr/sbin/')).length, mutations);
    } finally { f.close(); }
  }
});

test('host rejects a newly created GID alias before recording identity or creating the service user', async () => {
  const f = fixture();
  try {
    f.setGroupResolution({ aliases: ['sudo'] });
    await assert.rejects(applyHostBoundary(f.adapter), /Zaruku host boundary/);
    assert.equal(f.calls.some(call => call.bin === '/usr/sbin/useradd'), false);
    const record = JSON.parse(fs.readFileSync(f.resolve(recordPath), 'utf8'));
    assert.equal(record.steps.length, 1);
    assert.equal(record.steps[0].after, null);
  } finally { f.close(); }
});

test('rollback uses only persisted creation authority and refuses foreign contents or replaced inodes', async () => {
  for (const attack of ['none', 'contents', 'inode', 'forged', 'record-link']) {
    const f = fixture();
    try {
      await applyHostBoundary(f.adapter);
      const record = JSON.parse(fs.readFileSync(f.resolve(recordPath)));
      if (attack === 'contents') f.write(`${roots[0]}/foreign`, 'unrelated');
      if (attack === 'inode') { fs.renameSync(f.resolve(roots[0]), f.resolve(`${roots[0]}-foreign`)); fs.mkdirSync(f.resolve(roots[0]), { mode: 0o700 }); }
      if (attack === 'forged') record.steps[0].target = 'dashboard-next';
      if (attack === 'record-link') fs.linkSync(f.resolve(recordPath), f.resolve(`${recordPath}.alias`));
      if (attack !== 'none') {
        await assert.rejects(rollbackNewHostBoundary(f.adapter, record), /Zaruku host boundary/);
        assert.equal(f.calls.some(call => call.bin.endsWith('del')), false);
        assert.ok(fs.existsSync(f.resolve(roots[0])));
      } else {
        await rollbackNewHostBoundary(f.adapter, record);
        for (const name of roots) assert.equal(fs.existsSync(f.resolve(name)), false);
        assert.deepEqual(f.calls.filter(call => call.bin.endsWith('del')), [
          { bin: '/usr/sbin/userdel', args: ['dashboard-zaruku'] }, { bin: '/usr/sbin/groupdel', args: ['dashboard-zaruku'] },
        ]);
        assert.ok(fs.existsSync(f.resolve(recordPath)));
      }
    } finally { f.close(); }
  }
});

test('secret installation reads only fixed source and inherited FD and publishes strict allowlisted 0600 bytes', async () => {
  const f = fixture();
  let fd;
  try {
    await applyHostBoundary(f.adapter);
    f.write(source, `# combined input\nDASHBOARD_AUTH_SECRET="${privateValue}"\nPUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium\nMETRIKA_TOKEN='excluded'\nMYSQL_PASSWORD=excluded\n`);
    f.write('/db-password', privateValue);
    fd = fs.openSync(f.resolve('/db-password'), 'r');
    const evidence = await installRuntimeSecrets(f.adapter, fd);
    assert.equal(evidence.installed, true);
    assert.ok(!JSON.stringify(evidence).includes(privateValue));
    const actual = fs.readFileSync(f.resolve(destination), 'utf8');
    assert.ok(actual.includes(`ZARUKU_DB_PASSWORD='${privateValue}'\n`));
    assert.ok(actual.includes(`DASHBOARD_AUTH_SECRET='${privateValue}'\n`));
    assert.ok(!actual.includes('excluded'));
    assert.ok(actual.includes("ZARUKU_DB_USER='dashboard_zaruku_reader'\n"));
    assert.ok(actual.includes("ZARUKU_DB_HOST='127.0.0.1'\n"));
    assert.equal(fs.statSync(f.resolve(destination)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.resolve(destination)).nlink, 1);
    assert.equal(f.descriptors.size, 0);
  } finally { if (fd !== undefined) fs.closeSync(fd); f.close(); }
});

test('secret installation rejects unsafe source, destinations, syntax and FD values without leaking', async () => {
  for (const attack of ['symlink', 'hardlink', 'ancestry', 'owner', 'duplicate', 'utf8', 'oversized', 'changed', 'destination-link', 'destination-mode', 'password', 'interpolation', 'export', 'inline-comment']) {
    const f = fixture();
    let fd;
    try {
      await applyHostBoundary(f.adapter);
      f.write(source, `DASHBOARD_AUTH_SECRET='${privateValue}'\n`);
      f.write('/db-password', attack === 'password' ? `${privateValue}\n` : privateValue);
      fd = fs.openSync(f.resolve('/db-password'), 'r');
      if (attack === 'symlink') { fs.renameSync(f.resolve(source), f.resolve(`${source}.real`)); fs.symlinkSync(f.resolve(`${source}.real`), f.resolve(source)); }
      if (attack === 'hardlink') fs.linkSync(f.resolve(source), f.resolve(`${source}.alias`));
      if (attack === 'ancestry') fs.chmodSync(f.resolve('/var/www/www-root'), 0o777);
      if (attack === 'owner') f.overrides.set(source, { uid: 1000 });
      if (attack === 'duplicate') f.write(source, `DASHBOARD_AUTH_SECRET=${privateValue}\nOTHER=x\nOTHER=y\n`);
      if (attack === 'utf8') f.write(source, Buffer.from([0xc3, 0x28]));
      if (attack === 'oversized') f.write(source, 'x'.repeat(65537));
      if (attack === 'interpolation') f.write(source, 'DASHBOARD_AUTH_SECRET=${OTHER}\n');
      if (attack === 'export') f.write(source, `export DASHBOARD_AUTH_SECRET=${privateValue}\n`);
      if (attack === 'inline-comment') f.write(source, `DASHBOARD_AUTH_SECRET=${privateValue} # nope\n`);
      if (attack === 'destination-link') fs.symlinkSync(f.resolve('/db-password'), f.resolve(destination));
      if (attack === 'destination-mode') f.write(destination, privateValue, 0o644);
      if (attack === 'changed') {
        const original = f.adapter.fs.readSync;
        f.adapter.fs = new Proxy(f.io, { get(target, key) { if (key !== 'readSync') return target[key]; return (...args) => { const count = original(...args); if (f.descriptors.get(args[0]) === source && count) fs.appendFileSync(f.resolve(source), '# changed\n'); return count; }; } });
      }
      await assert.rejects(installRuntimeSecrets(f.adapter, fd), error => error.message === 'Failed to install Zaruku runtime secrets' && !String(error.stack).includes(privateValue));
      if (!attack.startsWith('destination')) assert.equal(fs.existsSync(f.resolve(destination)), false);
      assert.equal(f.descriptors.size, 0);
    } finally { if (fd !== undefined) fs.closeSync(fd); f.close(); }
  }
});

test('host CLI refuses unknown operation and alternate authority before system inspection', () => {
  for (const args of [['apply', '/tmp/foreign'], ['create', 'deploy/zaruku/production-shadow.json']]) {
    const result = spawnSync(process.execPath, ['scripts/zaruku-shadow-host.mjs', ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Zaruku host boundary/);
  }
});

test('auth publication creates a single-link private file, rejects unsafe ancestry and refuses nonempty replacement', async () => {
  for (const attack of ['none', 'nonempty', 'symlink', 'hardlink', 'owner', 'ancestry', 'mode']) {
    const f = fixture();
    const filename = '/var/www/.dashboard-zaruku-shadow/auth.json';
    try {
      await applyHostBoundary(f.adapter);
      f.adapter.isTerminal = () => false;
      f.adapter.readStdin = () => Buffer.from(JSON.stringify({ headers: { cookie: privateValue } }));
      if (attack === 'nonempty') f.write(filename, 'existing');
      if (attack === 'symlink') fs.symlinkSync(f.resolve(source), f.resolve(filename));
      if (attack === 'hardlink') { f.write(filename, ''); fs.linkSync(f.resolve(filename), f.resolve(`${filename}.alias`)); }
      if (attack === 'owner') { f.write(filename, ''); f.overrides.set(filename, { uid: 1000 }); }
      if (attack === 'ancestry') fs.chmodSync(f.resolve('/var/www/.dashboard-zaruku-shadow'), 0o777);
      if (attack === 'mode') f.write(filename, '', 0o644);
      if (attack === 'none') {
        const result = await installShadowAuth(f.adapter);
        assert.equal(result.status, 'installed');
        assert.equal(fs.statSync(f.resolve(filename)).mode & 0o777, 0o600);
        assert.equal(fs.statSync(f.resolve(filename)).nlink, 1);
      } else await assert.rejects(installShadowAuth(f.adapter), error => !error.stack.includes(privateValue));
      assert.equal(f.descriptors.size, 0);
    } finally { f.close(); }
  }
});

test('atomic secret replacement preserves the old inode and fsyncs the new file before publishing', async () => {
  const f = fixture(); let fd, oldFd;
  try {
    await applyHostBoundary(f.adapter);
    f.write(source, `DASHBOARD_AUTH_SECRET=${privateValue}\n`);
    f.write('/db-password', privateValue);
    f.write(destination, 'previous');
    oldFd = fs.openSync(f.resolve(destination), 'r');
    const oldInode = fs.fstatSync(oldFd).ino;
    fd = fs.openSync(f.resolve('/db-password'), 'r');
    const events = [];
    f.adapter.fs = new Proxy(f.io, { get(target, key) {
      if (key === 'fsyncSync') return descriptor => { events.push(fs.fstatSync(descriptor).isDirectory() ? 'directory-fsync' : 'file-fsync'); target[key](descriptor); };
      if (key === 'renameSync') return (...args) => { events.push('publish'); target[key](...args); };
      return target[key];
    } });
    await installRuntimeSecrets(f.adapter, fd);
    assert.deepEqual(events, ['file-fsync', 'publish', 'directory-fsync']);
    assert.notEqual(fs.statSync(f.resolve(destination)).ino, oldInode);
    assert.equal(fs.readFileSync(oldFd, 'utf8'), 'previous');
  } finally { if (fd !== undefined) fs.closeSync(fd); if (oldFd !== undefined) fs.closeSync(oldFd); f.close(); }
});

test('host creation never journals unvalidated account metadata', async () => {
  const f = fixture();
  try {
    const original = f.adapter.createGroup;
    f.adapter.createGroup = () => { original(); f.setGroup({ gid: 901, members: [privateValue] }); };
    await assert.rejects(applyHostBoundary(f.adapter));
    assert.ok(!fs.readFileSync(f.resolve(recordPath), 'utf8').includes(privateValue));
  } finally { f.close(); }
});

test('rollback accepts userdel removing only its recorded matching primary group', async () => {
  const f = fixture();
  try {
    await applyHostBoundary(f.adapter);
    const record = JSON.parse(fs.readFileSync(f.resolve(recordPath)));
    const original = f.adapter.deleteUser;
    f.adapter.deleteUser = () => { original(); f.setGroup(null); };
    await rollbackNewHostBoundary(f.adapter, record);
    assert.equal(f.calls.some(call => call.bin === '/usr/sbin/groupdel'), false);
  } finally { f.close(); }
});
