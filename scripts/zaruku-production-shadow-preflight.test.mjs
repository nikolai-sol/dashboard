import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertShadowPrerequisites, inspectShadowPrerequisites } from './zaruku-production-shadow-preflight.mjs';

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
    mysqlIdentity: { exists: false },
    resources: safeResources,
    ...overrides,
  };
  return {
    async currentIdentity() { return state.currentIdentity; },
    async combinedProcess() { return state.combined; },
    async readNginx() { return { text: state.nginxText, sha256: state.nginxSha256 }; },
    async listeners() { return state.listeners; },
    async tools() { return state.tools; },
    async mysql() { return state.mysql; },
    async serviceIdentity() { return state.serviceIdentity; },
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
    mode: resource.path.endsWith('.env') || resource.path.endsWith('.json') || resource.path.endsWith('.tsv') ? '0600' : '0700',
    links: resource.path.endsWith('.env') || resource.path.endsWith('.json') || resource.path.endsWith('.tsv') ? 1 : 2,
  }));
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({
    serviceIdentity: {
      exists: true, name: 'dashboard-zaruku', uid: 991, gid: 991,
      group: 'dashboard-zaruku', shell: '/usr/sbin/nologin', home: '/nonexistent', supplementaryGroups: [],
    },
    mysqlIdentity: { exists: true, account: 'dashboard_zaruku_reader@127.0.0.1' },
    resources,
  }));
  assert.doesNotThrow(() => assertShadowPrerequisites(evidence));
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
