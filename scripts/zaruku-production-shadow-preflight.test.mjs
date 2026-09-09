import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  assertShadowPrerequisites,
  createReadOnlyPreflightAdapter,
  inspectShadowPrerequisites,
  readNginxIncludeGraph,
} from './zaruku-production-shadow-preflight.mjs';

const safeResources = [
  { path: '/var/www/dashboard-zaruku-releases', exists: false },
  { path: '/var/www/dashboard-zaruku-backups', exists: false },
  { path: '/var/www/.dashboard-zaruku-control', exists: false },
  { path: '/var/www/.dashboard-zaruku-secrets', exists: false },
  { path: '/var/www/.dashboard-zaruku-secrets/runtime.env', exists: false },
  { path: '/var/www/.dashboard-zaruku-shadow', exists: false },
  { path: '/var/www/.dashboard-zaruku-shadow/auth.json', exists: false },
  { path: '/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv', exists: false },
  { path: '/var/www/.dashboard-zaruku-shadow/evidence', exists: false },
];

function fixtureAdapter(overrides = {}) {
  const state = {
    currentIdentity: { uid: 0, user: 'root' },
    combined: { name: 'dashboard-next', port: 3001, status: 'online', pid: 4101 },
    nginxText: 'proxy_pass http://127.0.0.1:3001;',
    nginxSha256: 'a'.repeat(64),
    listeners: [{ host: '127.0.0.1', port: 3001, process: 'dashboard-next', pid: 4101 }],
    tools: { setpriv: '/usr/bin/setpriv', python3: '/usr/bin/python3' },
    mysql: { rootSocketAdmin: true, currentUser: 'root@localhost', database: 'report_bd' },
    serviceIdentity: { exists: false },
    serviceGroupIdentity: { exists: false },
    mysqlIdentity: { exists: false },
    resources: safeResources,
    ...overrides,
  };
  return {
    async currentIdentity() { return state.currentIdentity; },
    async combinedProcess() { return state.combined; },
    async readNginx() { return state.nginxInspection ?? { text: state.nginxText, sha256: state.nginxSha256 }; },
    async listeners() { return state.listeners; },
    async tools() { return state.tools; },
    async mysql() { return state.mysql; },
    async serviceIdentity() { return state.serviceIdentity; },
    async serviceGroupIdentity() { return state.serviceGroupIdentity; },
    async mysqlIdentity() { return state.mysqlIdentity; },
    async resources() { return state.resources; },
  };
}

test('preflight returns sanitized evidence for the fixed read-only prerequisites', async () => {
  const secret = 'fixture-secret-must-not-escape';
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({ secretMarker: secret }));
  assert.equal(evidence.combined.port, 3001);
  assert.equal(evidence.combined.status, 'online');
  assert.equal(evidence.isolatedPort.free, true);
  assert.equal(evidence.nginx.referencesIsolatedPort, false);
  assert.equal(evidence.tools.setpriv, '/usr/bin/setpriv');
  assert.equal(evidence.tools.python3, '/usr/bin/python3');
  assert.equal(evidence.mysql.rootSocketAdmin, true);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secret));
  assert.doesNotThrow(() => assertShadowPrerequisites(evidence));
});

test('preflight fails when nginx mentions port 3002 or another process owns it', async () => {
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({
    nginxText: 'proxy_pass http://127.0.0.1:3002;',
    listeners: [
      { host: '127.0.0.1', port: 3001, process: 'dashboard-next', pid: 4101 },
      { host: '127.0.0.1', port: 3002, process: 'foreign', pid: 9912 },
    ],
  }));
  assert.throws(() => assertShadowPrerequisites(evidence), /public routing|port 3002/);
});

test('preflight fails closed for unsafe or partial existing Zaruku state', async () => {
  const unsafe = await inspectShadowPrerequisites(fixtureAdapter({
    serviceIdentity: {
      exists: true, name: 'dashboard-zaruku', uid: 991, gid: 991,
      group: 'dashboard-zaruku', shell: '/bin/bash', home: '/nonexistent', supplementaryGroups: [],
    },
    resources: [
      ...safeResources.slice(0, 3),
      { path: '/var/www/.dashboard-zaruku-secrets', exists: true, type: 'directory', owner: 'root', group: 'root', mode: '0700', links: 2 },
      ...safeResources.slice(4),
    ],
  }));
  assert.throws(() => assertShadowPrerequisites(unsafe), /identity|resource|partial/i);
});

test('preflight accepts only fully compliant existing Zaruku identities and roots', async () => {
  const resources = safeResources.map(resource => ({
    ...resource,
    exists: true,
    type: resource.path.endsWith('.env') || resource.path.endsWith('.json') || resource.path.endsWith('.tsv') ? 'file' : 'directory',
    owner: 'root', group: 'root',
    mode: /dashboard-zaruku-(releases|backups)$/.test(resource.path) ? '0711' : resource.path.endsWith('.env') || resource.path.endsWith('.json') || resource.path.endsWith('.tsv') ? '0600' : '0700',
    links: resource.path.endsWith('.env') || resource.path.endsWith('.json') || resource.path.endsWith('.tsv') ? 1 : 2,
  }));
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({
    serviceIdentity: {
      exists: true, name: 'dashboard-zaruku', uid: 991, gid: 991,
      group: 'dashboard-zaruku', shell: '/usr/sbin/nologin', home: '/nonexistent', supplementaryGroups: [],
    },
    serviceGroupIdentity: { exists: true, name: 'dashboard-zaruku', gid: 991, members: [] },
    mysqlIdentity: { exists: true, account: 'dashboard_zaruku_reader@127.0.0.1' },
    resources,
  }));
  assert.doesNotThrow(() => assertShadowPrerequisites(evidence));
});

test('preflight rejects root-equivalent service IDs and validates the dedicated group independently', async () => {
  const privileged = await inspectShadowPrerequisites(fixtureAdapter({
    serviceIdentity: {
      exists: true, name: 'dashboard-zaruku', uid: 0, gid: 0,
      group: 'dashboard-zaruku', shell: '/usr/sbin/nologin', home: '/nonexistent', supplementaryGroups: [],
    },
    serviceGroupIdentity: { exists: true, name: 'dashboard-zaruku', gid: 0, members: [] },
  }));
  assert.throws(() => assertShadowPrerequisites(privileged), /privileged|identity|group/i);

  const orphanGroup = await inspectShadowPrerequisites(fixtureAdapter({
    serviceGroupIdentity: { exists: true, name: 'dashboard-zaruku', gid: 991, members: [] },
  }));
  assert.throws(() => assertShadowPrerequisites(orphanGroup), /partial|identity|group/i);
});

test('preflight distinguishes confirmed absence from failed or incomplete inspection', async () => {
  for (const overrides of [
    { serviceIdentity: { exists: null } },
    { serviceGroupIdentity: { exists: null } },
    { mysqlIdentity: { exists: null } },
    { resources: safeResources.map((resource, index) => index === 0 ? { path: resource.path, exists: null } : resource) },
    {
      serviceIdentity: {
        exists: true, name: 'dashboard-zaruku', uid: 991, gid: 991,
        group: 'dashboard-zaruku', shell: '/usr/sbin/nologin', home: '/nonexistent', supplementaryGroups: null,
      },
      serviceGroupIdentity: { exists: true, name: 'dashboard-zaruku', gid: 991, members: [] },
    },
  ]) {
    const evidence = await inspectShadowPrerequisites(fixtureAdapter(overrides));
    assert.throws(() => assertShadowPrerequisites(evidence), /inspection|incomplete|identity|resource/i);
  }
});

test('preflight rejects wrong combined runtime, tools, or socket authority', async () => {
  for (const overrides of [
    { combined: { name: 'dashboard-next', port: 3001, status: 'stopped', pid: null } },
    { tools: { setpriv: '/usr/local/bin/setpriv', python3: '/usr/bin/python3' } },
    { mysql: { rootSocketAdmin: false, currentUser: null, database: null } },
    { listeners: [] },
  ]) {
    const evidence = await inspectShadowPrerequisites(fixtureAdapter(overrides));
    assert.throws(() => assertShadowPrerequisites(evidence), /combined|tool|MySQL/i);
  }
});

test('preflight evidence excludes raw nginx, environment, database rows, and process environment', async () => {
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({
    nginxText: 'proxy_pass http://127.0.0.1:3001; # PRIVATE_MARKER',
    environment: { PRIVATE_MARKER: 'secret' },
    databaseRows: [{ PRIVATE_MARKER: 'secret' }],
    pm2Environment: { PRIVATE_MARKER: 'secret' },
  }));
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /PRIVATE_MARKER|proxy_pass|databaseRows|pm2Environment|environment/);
});

test('Nginx inspection follows the complete active include graph and finds an otherwise omitted port-3002 route', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-graph-'));
  try {
    const customDirectory = path.join(directory, 'custom-routing');
    fs.mkdirSync(customDirectory);
    const route = path.join(customDirectory, 'shadow.conf');
    fs.writeFileSync(route, 'location /shadow { proxy_pass http://127.0.0.1:3002; }\n');
    const entry = path.join(directory, 'nginx.conf');
    fs.writeFileSync(entry, 'http { include custom-routing/*.conf; }\n');

    const nginx = readNginxIncludeGraph(entry, { prefix: directory });
    const evidence = await inspectShadowPrerequisites(fixtureAdapter({ nginxInspection: nginx }));
    assert.equal(evidence.nginx.referencesIsolatedPort, true);
    assert.throws(() => assertShadowPrerequisites(evidence), /public routing|3002/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Nginx inspection reads and hashes the graph when wildcard includes match no files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-empty-glob-'));
  try {
    fs.mkdirSync(path.join(directory, 'optional'));
    const entry = path.join(directory, 'nginx.conf');
    const route = path.join(directory, 'active.conf');
    const sources = new Map([
      [entry, 'http { include optional/*.conf; include optional/?.conf; include active.conf; }\n'],
      [route, 'location / { proxy_pass http://127.0.0.1:3001; }\n'],
    ]);
    for (const [filename, source] of sources) fs.writeFileSync(filename, source);

    const graph = readNginxIncludeGraph(entry, { prefix: directory });
    const records = [...sources].map(([filename, source]) => [fs.realpathSync(filename), source])
      .sort(([left], [right]) => left.localeCompare(right));
    const digest = createHash('sha256');
    for (const [filename, source] of records) {
      digest.update(`${filename}\0${createHash('sha256').update(source).digest('hex')}\n`);
    }
    assert.equal(graph.fileCount, 2);
    assert.equal(graph.text, records.map(([, source]) => source).join('\n'));
    assert.equal(graph.sha256, digest.digest('hex'));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Nginx inspection fails closed for a missing literal include or wildcard base directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-missing-'));
  try {
    const entry = path.join(directory, 'nginx.conf');
    for (const include of ['missing.conf', 'missing/*.conf']) {
      fs.writeFileSync(entry, `http { include ${include}; }\n`);
      assert.throws(() => readNginxIncludeGraph(entry, { prefix: directory }), /include|Nginx/i);
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Nginx inspection rejects POSIX negated bracket globs before they can omit a port-3002 route', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-bracket-'));
  try {
    const routes = path.join(directory, 'routes');
    fs.mkdirSync(routes);
    fs.writeFileSync(path.join(routes, 'a.conf'), 'proxy_pass http://127.0.0.1:3001;\n');
    fs.writeFileSync(path.join(routes, 'b.conf'), 'proxy_pass http://127.0.0.1:3002;\n');
    const entry = path.join(directory, 'nginx.conf');
    fs.writeFileSync(entry, 'http { include routes/[!a]*.conf; }\n');
    assert.throws(() => readNginxIncludeGraph(entry, { prefix: directory }), /unsupported|bracket|include|Nginx/i);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Nginx glob traversal inspects a symlinked directory beside an ordinary matching directory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-symlink-'));
  try {
    const routes = path.join(directory, 'routes');
    const ordinary = path.join(routes, 'ordinary');
    const linkedTarget = path.join(directory, 'linked-target');
    fs.mkdirSync(ordinary, { recursive: true });
    fs.mkdirSync(linkedTarget);
    fs.writeFileSync(path.join(ordinary, 'combined.conf'), 'proxy_pass http://127.0.0.1:3001;\n');
    fs.writeFileSync(path.join(linkedTarget, 'shadow.conf'), 'proxy_pass http://127.0.0.1:3002;\n');
    fs.symlinkSync(linkedTarget, path.join(routes, 'linked'));
    const entry = path.join(directory, 'nginx.conf');
    fs.writeFileSync(entry, 'http { include routes/*/*.conf; }\n');

    const nginx = readNginxIncludeGraph(entry, { prefix: directory });
    const evidence = await inspectShadowPrerequisites(fixtureAdapter({ nginxInspection: nginx }));
    assert.equal(evidence.nginx.referencesIsolatedPort, true);
    assert.throws(() => assertShadowPrerequisites(evidence), /public routing|3002/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Nginx glob traversal fails closed on a symlinked directory cycle', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-nginx-cycle-'));
  try {
    const ordinary = path.join(directory, 'routes', 'ordinary');
    fs.mkdirSync(ordinary, { recursive: true });
    fs.writeFileSync(path.join(ordinary, 'combined.conf'), 'proxy_pass http://127.0.0.1:3001;\n');
    fs.symlinkSync(path.join(directory, 'routes'), path.join(directory, 'routes', 'cycle'));
    const entry = path.join(directory, 'nginx.conf');
    fs.writeFileSync(entry, 'http { include routes/*/*.conf; }\n');
    assert.throws(() => readNginxIncludeGraph(entry, { prefix: directory }), /cycle|include|Nginx/i);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('real adapter distinguishes confirmed absence from stat, getent, group, and supplementary-group command failure', () => {
  const result = (status, stdout = '', stderr = '') => ({ status, stdout, stderr, signal: null });
  const absent = createReadOnlyPreflightAdapter({
    commandRunner(filename, args) {
      if (filename === '/usr/bin/getent' && args[0] === 'passwd') return result(2);
      if (filename === '/usr/bin/getent' && args[0] === 'group') return result(2);
      return result(1, '', 'unexpected command');
    },
  });
  assert.deepEqual(absent.serviceIdentity(), { exists: false });
  assert.deepEqual(absent.serviceGroupIdentity(), { exists: false });

  const statFailure = createReadOnlyPreflightAdapter({ commandRunner: () => result(1, '', 'Permission denied') });
  assert.throws(() => statFailure.resources(), /command failed|inspection/i);

  const getentFailure = createReadOnlyPreflightAdapter({
    commandRunner(filename, args) {
      if (filename === '/usr/bin/getent' && args[0] === 'passwd') return result(1, '', 'backend unavailable');
      return result(2);
    },
  });
  assert.throws(() => getentFailure.serviceIdentity(), /command failed|inspection/i);

  const groupFailure = createReadOnlyPreflightAdapter({
    commandRunner(filename, args) {
      if (filename === '/usr/bin/getent' && args[0] === 'group') return result(1, '', 'backend unavailable');
      return result(2);
    },
  });
  assert.throws(() => groupFailure.serviceGroupIdentity(), /command failed|inspection/i);

  const groupsFailure = createReadOnlyPreflightAdapter({
    commandRunner(filename, args) {
      if (filename === '/usr/bin/getent' && args[0] === 'passwd') return result(0, 'dashboard-zaruku:x:991:991::/nonexistent:/usr/sbin/nologin\n');
      if (filename === '/usr/bin/getent' && args[0] === 'group') return result(0, 'dashboard-zaruku:x:991:\n');
      if (filename === '/usr/bin/id' && args[0] === '-Gn') return result(1, '', 'group lookup failed');
      return result(1, '', 'unexpected command');
    },
  });
  assert.throws(() => groupsFailure.serviceIdentity(), /command failed|inspection/i);
});

function adminFsFixture() {
  const info = (directory, mode, ino) => ({ dev: 1, ino, uid: 0, gid: 0, mode, nlink: 1, size: 10, mtimeMs: 1, ctimeMs: 1,
    isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false });
  const state = { parent: info(true, 0o40700, 10), file: info(false, 0o100400, 11), login: null, opened: [], closed: [] };
  const absent = () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
  state.io = {
    openSync(filename, flags) {
      assert.ok(flags & fs.constants.O_NOFOLLOW);
      if (filename === '/root') { assert.ok(flags & fs.constants.O_DIRECTORY); state.opened.push(40); return 40; }
      assert.equal(filename, '/proc/self/fd/40/.my.cnf');
      if (state.absentFile) return absent();
      state.opened.push(41); return 41;
    },
    fstatSync(fd) { return fd === 40 ? state.parent : state.file; },
    lstatSync(filename) {
      if (filename === '/root') return state.parent;
      assert.equal(filename, '/proc/self/fd/40/.mylogin.cnf');
      if (state.login === null) return absent();
      if (state.login instanceof Error) throw state.login;
      return state.login;
    },
    closeSync(fd) { state.closed.push(fd); },
  };
  return state;
}

test('preflight pins admin FD, inherits it as fd 3, and closes it without reopening the pathname', () => {
  for (const mode of [0o400, 0o600]) {
    const state = adminFsFixture(); state.file.mode = 0o100000 | mode;
    const adapter = createReadOnlyPreflightAdapter({ adminFs: state.io, commandRunner(filename, args, options) {
      if (filename === '/usr/bin/mysql') {
        assert.deepEqual(args.slice(0, 3), ['--defaults-file=/proc/self/fd/3', '--protocol=socket', '--user=root']);
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe', 41]);
        // A pathname replacement after opening must never be used by the child.
        state.io.openSync = () => { throw new Error('pathname reopened'); };
        return { status: 0, stdout: 'root@localhost\nreport_bd\n', stderr: '', signal: null };
      }
      return { status: 0, stdout: '/usr/bin/mysql', stderr: '', signal: null };
    } });
    assert.equal(adapter.mysql().rootSocketAdmin, true);
    assert.deepEqual(state.closed, [41, 40]);
  }
});

test('preflight rejects unsafe parents, files and login-path existence or inspection failures before MySQL', () => {
  const mutations = [s => { s.absentFile = true; }, s => { s.parent.isDirectory = () => false; },
    s => { s.parent.isSymbolicLink = () => true; },
    ...['uid', 'gid'].flatMap(key => [s => { s.parent[key] = 1; }, s => { s.file[key] = 1; }]),
    s => { s.parent.mode = 0o40755; }, s => { s.file.isFile = () => false; }, s => { s.file.nlink = 2; },
    ...[0, 0o444, 0o640, 0o700, 0o4600].map(mode => s => { s.file.mode = 0o100000 | mode; }),
    s => { s.login = {}; }, s => { s.login = { isSymbolicLink: () => true }; },
    s => { s.login = Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'EACCES' }); }];
  for (const mutate of mutations) {
    const state = adminFsFixture(); mutate(state); let called = false;
    const adapter = createReadOnlyPreflightAdapter({ adminFs: state.io, commandRunner(filename) {
      if (filename === '/usr/bin/mysql') called = true;
      return { status: 0, stdout: '/usr/bin/mysql', stderr: '', signal: null };
    } });
    assert.throws(() => adapter.mysql(), /admin defaults/);
    assert.equal(called, false);
    assert.deepEqual(state.closed, state.opened.toReversed());
  }
});

test('preflight rejects descriptor mutation and closes both FDs after query failure', () => {
  for (const change of ['identity', 'metadata', 'parent', 'login', 'query']) {
    const state = adminFsFixture();
    const adapter = createReadOnlyPreflightAdapter({ adminFs: state.io, commandRunner(filename) {
      if (filename !== '/usr/bin/mysql') return { status: 0, stdout: '/usr/bin/mysql', stderr: '', signal: null };
      if (change === 'identity') state.file.ino++;
      if (change === 'metadata') state.file.ctimeMs++;
      if (change === 'parent') state.parent.mode = 0o40755;
      if (change === 'login') state.login = {};
      return { status: change === 'query' ? 1 : 0, stdout: 'root@localhost\nreport_bd\n', stderr: '', signal: null };
    } });
    assert.throws(() => adapter.mysql(), /admin defaults|preflight command failed/);
    assert.deepEqual(state.closed, [41, 40]);
  }
});
