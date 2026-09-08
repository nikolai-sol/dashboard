import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  loadMysqlTableAuthority,
  loadShadowAuthority,
  scanZarukuRuntimeMysqlTables,
} from './zaruku-production-shadow-contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const authorityPath = path.join(root, 'deploy/zaruku/production-shadow.json');
const mysqlAuthorityPath = path.join(root, 'deploy/zaruku/mysql-read-tables.json');

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

test('grant authority contains every physical Zaruku read table and no advertising/private table', () => {
  const tables = loadMysqlTableAuthority(mysqlAuthorityPath).tables;
  assert.ok(tables.includes('canonical_fact_site_analytics_daily'));
  assert.ok(tables.includes('canonical_fact_wordstat_requests_snapshot'));
  assert.ok(tables.includes('canonical_alice_visibility_snapshots'));
  assert.ok(tables.includes('seo_positions_weekly'));
  assert.ok(tables.includes('dashboard_sources'));
  assert.ok(tables.includes('dashboard_access_users'));
  assert.ok(tables.includes('dashboard_shared_access_settings'));
  assert.ok(!tables.includes('source_catalog'));
  assert.ok(!tables.includes('canonical_fact_gsc_pages_daily'));
  assert.ok(!tables.includes('canonical_fact_gsc_countries_daily'));
  assert.ok(!tables.includes('canonical_fact_gsc_summary_daily'));
  assert.ok(!tables.some(name => /abbott|advertising|ads_daily|report_bd_private/.test(name)));
  assert.deepEqual(tables, [...tables].sort());
});

test('grant authority exactly matches the complete transitive Zaruku SQL owner graph', () => {
  const tables = loadMysqlTableAuthority(mysqlAuthorityPath).tables;
  assert.deepEqual(scanZarukuRuntimeMysqlTables(root), tables);
});

test('transitive SQL owner scan follows runtime imports and excludes CTE aliases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-owner-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'src/lib'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'apps/zaruku/src/entry.ts'), 'import "@/lib/query";\n');
    fs.writeFileSync(path.join(directory, 'src/lib/query.ts'), `
      export const sql = \`
        WITH scoped_rows AS (
          SELECT id FROM dashboards
        ), latest_rows AS (
          SELECT dashboard_id FROM dashboard_sources
          JOIN scoped_rows ON scoped_rows.id = dashboard_sources.dashboard_id
        )
        SELECT * FROM latest_rows
        JOIN dashboard_access_users ON dashboard_access_users.dashboard_id = latest_rows.dashboard_id
      \`;
    `);
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), [
      'dashboard_access_users',
      'dashboard_sources',
      'dashboards',
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan reconstructs concatenated SQL literals', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-concat-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'apps/zaruku/src/entry.ts'),
      'export const sql = "SELECT * " + "FROM newly_imported_table";\n',
    );
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), ['newly_imported_table']);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan recognizes lowercase and mixed-case SQL keywords', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-case-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'apps/zaruku/src/entry.ts'), `
      export const lowerSql = "select * from lowercase_table";
      export const mixedSql = "SeLeCt * FrOm mixed_case_table";
    `);
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), [
      'lowercase_table',
      'mixed_case_table',
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan rejects lowercase foreign-schema reads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-lower-foreign-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'apps/zaruku/src/entry.ts'),
      'export const sql = "select * from report_bd_private.canonical_fact_metrika_visits";\n',
    );
    assert.throws(() => scanZarukuRuntimeMysqlTables(directory), /foreign|schema|SQL owner|authority/i);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan fails closed on dynamic table-position SQL composition', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-dynamic-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'apps/zaruku/src/entry.ts'),
      'declare function runtimeTable(): string;\nexport const sql = `SELECT * FROM ${runtimeTable()}`;\n',
    );
    assert.throws(() => scanZarukuRuntimeMysqlTables(directory), /dynamic|composition|SQL owner|authority/i);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan rejects every foreign-schema table reference', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-foreign-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'apps/zaruku/src/entry.ts'),
      'export const sql = "SELECT * FROM report_bd_private.canonical_fact_metrika_visits";\n',
    );
    assert.throws(() => scanZarukuRuntimeMysqlTables(directory), /foreign|schema|SQL owner|authority/i);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan scopes CTE aliases to one composed statement', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-cte-scope-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'apps/zaruku/src/entry.ts'), `
      export const cteSql = \`
        WITH shared_rows AS (SELECT id FROM dashboards)
        SELECT * FROM shared_rows
      \`;
      export const physicalSql = "SELECT * FROM shared_rows";
    `);
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), ['dashboards', 'shared_rows']);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan keeps conditional SQL alternatives in separate CTE scopes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-conditional-cte-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'apps/zaruku/src/entry.ts'), `
      declare const flag: boolean;
      export const sql = flag
        ? "WITH shared_rows AS (SELECT id FROM dashboards) SELECT * FROM shared_rows"
        : "SELECT * FROM shared_rows";
    `);
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), ['dashboards', 'shared_rows']);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('transitive SQL owner scan never treats a schema-qualified physical table as a CTE alias', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-qualified-cte-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/zaruku/src'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'apps/zaruku/src/entry.ts'),
      'export const sql = "WITH shared_rows AS (SELECT id FROM dashboards) SELECT * FROM report_bd.shared_rows";\n',
    );
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), ['dashboards', 'shared_rows']);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
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
