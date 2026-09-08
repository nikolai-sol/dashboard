import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadMysqlTableAuthority, loadShadowAuthority } from './zaruku-production-shadow-contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const authorityPath = path.join(root, 'deploy/zaruku/production-shadow.json');

function withJson(value, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-shadow-authority-'));
  const filename = path.join(directory, 'authority.json');
  try {
    fs.writeFileSync(filename, `${JSON.stringify(value)}\n`);
    return callback(filename);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}

test('production shadow authority is loopback-only and cannot authorize cutover', () => {
  const authority = loadShadowAuthority(authorityPath);
  assert.equal(authority.scope, 'zaruku');
  assert.equal(authority.combinedUrl, 'http://127.0.0.1:3001');
  assert.equal(authority.isolatedUrl, 'http://127.0.0.1:3002');
  assert.equal(authority.publicCutover, false);
  assert.deepEqual(authority.period, { from: '2026-01-01', to: '2026-08-31' });
  assert.equal(authority.serviceAccount, 'dashboard-zaruku');
  assert.equal(authority.mysqlAccount, 'dashboard_zaruku_reader@127.0.0.1');
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.period));
});

test('shadow authority rejects every extra key and fixed-value override', () => {
  const valid = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  for (const invalid of [
    { ...valid, unexpected: true },
    { ...valid, publicCutover: true },
    { ...valid, scope: 'combined' },
    { ...valid, isolatedUrl: 'http://0.0.0.0:3002' },
    { ...valid, combinedUrl: 'https://dashboards.adreports.ru' },
    { ...valid, secretFile: '/tmp/runtime.env' },
    { ...valid, period: { ...valid.period, to: '2026-09-01' } },
  ]) {
    withJson(invalid, filename => assert.throws(() => loadShadowAuthority(filename), /authority|contract/i));
  }
});

test('mysql table authority loader accepts only a frozen sorted exact-key boundary', () => {
  const valid = {
    scope: 'zaruku',
    account: 'dashboard_zaruku_reader@127.0.0.1',
    database: 'report_bd',
    tables: ['dashboard_sources', 'dashboards'],
  };
  withJson(valid, filename => {
    const authority = loadMysqlTableAuthority(filename);
    assert.deepEqual(authority, valid);
    assert.ok(Object.isFrozen(authority));
    assert.ok(Object.isFrozen(authority.tables));
  });
  withJson({ ...valid, tables: [...valid.tables].reverse() }, filename => {
    assert.throws(() => loadMysqlTableAuthority(filename), /sorted|authority/i);
  });
  withJson({ ...valid, password: 'must-never-be-accepted' }, filename => {
    assert.throws(() => loadMysqlTableAuthority(filename), error =>
      /authority/i.test(error.message) && !error.message.includes('must-never-be-accepted'));
  });
});

test('source-only shadow tests are a dedicated predeploy gate with no apply mode', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts['test:zaruku-production-shadow'],
    'node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs',
  );
  const predeploy = fs.readFileSync(path.join(root, 'scripts/predeploy-verify.sh'), 'utf8');
  assert.equal(predeploy.split(/\r?\n/).filter(line => line.trim() === 'npm run test:zaruku-production-shadow').length, 1);
  assert.doesNotMatch(predeploy, /zaruku-production-shadow[^\n]*--apply/);
});
