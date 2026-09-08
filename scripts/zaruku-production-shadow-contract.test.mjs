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
  assert.deepEqual(authority.otherRuntimeShaEntries,[{name:'combined-dashboard',path:'/var/www/dashboard/.release-source-sha'}]);
  assert.ok(Object.isFrozen(authority.otherRuntimeShaEntries));
  assert.deepEqual(authority.verifierTimeout,{binary:'/usr/bin/timeout',seconds:180,killAfterSeconds:5,lockWaitSeconds:210});assert.ok(Object.isFrozen(authority.verifierTimeout));
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
    { ...valid, otherRuntimeShaEntries: [] },
    { ...valid, otherRuntimeShaEntries: [{name:'combined-dashboard',path:'/var/www/dashboard/.env'}] },
    { ...valid, otherRuntimeShaEntries: [{name:'other',path:'/var/www/other/.release-source-sha'}] },
    { ...valid, period: { ...valid.period, to: '2026-09-01' } },
    ...[{binary:'/tmp/timeout'},{seconds:0},{killAfterSeconds:0},{lockWaitSeconds:241},{pid:1}].map(change=>({...valid,verifierTimeout:{...valid.verifierTimeout,...change}})),
  ]) {
    withJson(invalid, filename => assert.throws(() => loadShadowAuthority(filename), /authority|contract/i));
  }
});

test('strict authority JSON rejects duplicate keys even when values are identical', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-json-'));
  try {
    const filename=path.join(directory,'authority.json');
    fs.writeFileSync(filename,fs.readFileSync(authorityPath,'utf8').replace('"scope": "zaruku",','"scope": "zaruku", "scope": "zaruku",'));
    assert.throws(()=>loadShadowAuthority(filename),/authority/i);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
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

test('SQL owner scanner detects comma joins and comments in every table position', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-sql-token-'));
  const filename = path.join(directory, 'apps/zaruku/entry.ts');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    for (const sql of [
      'SELECT * FROM dashboards, report_bd_private.canonical_fact_metrika_visits',
      'SELECT * FROM /* gap */ report_bd_private.canonical_fact_metrika_visits',
      'SELECT * FROM dashboards d, /* gap */ `report_bd_private` . `canonical_fact_metrika_visits` v',
      'SELECT * FROM dashboards JOIN -- gap\n report_bd_private.canonical_fact_metrika_visits USING (id)',
    ]) {
      fs.writeFileSync(filename, `export const sql = ${JSON.stringify(sql)};`);
      assert.throws(() => scanZarukuRuntimeMysqlTables(directory), /foreign|schema|SQL owner|authority/i, sql);
    }
    fs.writeFileSync(filename, 'export const sql = "WITH `rows` AS (SELECT id FROM /* gap */ dashboards) SELECT * FROM `rows` r, `report_bd`.`dashboard_sources` s JOIN dashboard_access_users a ON a.id=s.id WHERE s.id IN (SELECT id FROM dashboards)";');
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory), ['dashboard_access_users', 'dashboard_sources', 'dashboards']);
    for (const sql of ['SELECT * FROM dashboards, __ZARUKU_DYNAMIC_SQL__', 'SELECT * FROM /*!50000 report_bd_private.canonical_fact_metrika_visits */ dashboards', 'SELECT * FROM /* unclosed']) {
      fs.writeFileSync(filename, `export const sql = ${JSON.stringify(sql)};`);
      assert.throws(() => scanZarukuRuntimeMysqlTables(directory), /SQL|authority/i, sql);
    }
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('SQL owner scanner refuses grouped tables without hiding owners in nested queries or CTEs', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-sql-group-')),filename=path.join(directory,'apps/zaruku/entry.ts');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const scan=sql=>{fs.writeFileSync(filename,`export const sql = ${JSON.stringify(sql)};`);return scanZarukuRuntimeMysqlTables(directory);};
  try {
    for(const sql of [
      'SELECT * FROM (dashboards, report_bd_private.canonical_fact_metrika_visits)',
      'SELECT * FROM dashboards JOIN (report_bd_private.canonical_fact_metrika_visits) ON 1=1',
      'SELECT * FROM ((dashboards, report_bd_private.canonical_fact_metrika_visits))',
      'SELECT * FROM (SELECT * FROM dashboards JOIN (report_bd_private.canonical_fact_metrika_visits) ON 1=1) q',
      'WITH rows AS (SELECT * FROM (dashboards, report_bd_private.canonical_fact_metrika_visits)) SELECT * FROM rows',
      'SELECT * FROM (SELECT * FROM report_bd_private.canonical_fact_metrika_visits) q',
      'SELECT * FROM (SELECT * FROM dashboards',
    ]) assert.throws(()=>scan(sql),/SQL|schema|authority/i,sql);
    assert.deepEqual(scan('WITH rows AS (SELECT * FROM dashboards) SELECT * FROM ((SELECT * FROM rows)) q JOIN dashboard_sources s ON 1=1'),['dashboard_sources','dashboards']);
    assert.deepEqual(scan('SELECT * FROM (WITH rows AS (SELECT * FROM dashboards) SELECT * FROM rows) q JOIN rows r ON 1=1'),['dashboards','rows']);
    assert.deepEqual(scan('WITH rows AS (SELECT * FROM rows) SELECT * FROM rows'),['rows']);
    assert.deepEqual(scan('WITH RECURSIVE rows AS (SELECT * FROM dashboards UNION SELECT * FROM rows) SELECT * FROM rows'),['dashboards']);
    assert.throws(()=>scan('WITH rows AS (SELECT * FROM dashboards) SELECT * FROM rows; SELECT * FROM rows'),/SQL|authority/i);
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('SQL owner scan resolves static mapped subqueries but never permits dynamic or private mapped owners', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-sql-map-')),filename=path.join(directory,'apps/zaruku/entry.ts');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const scan=body=>{fs.writeFileSync(filename,`const reports=[0,1]; function query() { return ${body}; } const blocks=reports.map(report=>\`(\${query()})\`); export const sql=\`SELECT * FROM (\${blocks.join(" UNION ALL ")}) q\`;`);return scanZarukuRuntimeMysqlTables(directory);};
  try {
    assert.deepEqual(scan('"SELECT * FROM dashboards"'),['dashboards']);
    assert.throws(()=>scan('"SELECT * FROM report_bd_private.canonical_fact_metrika_visits"'),/SQL|schema|authority/i);
    assert.throws(()=>scan('runtimeSql()'),/SQL|authority/i);
    fs.writeFileSync(filename,'export const sql=["SELECT *", "FROM dashboards"].join(" ");');
    assert.deepEqual(scanZarukuRuntimeMysqlTables(directory),['dashboards']);
    fs.writeFileSync(filename,'declare const reports: unknown[]; export const sql=reports.map(()=>"SELECT * FROM dashboards").join(" UNION SELECT * FROM report_bd_private.canonical_fact_metrika_visits UNION ");');
    assert.throws(()=>scanZarukuRuntimeMysqlTables(directory),/SQL|schema|authority/i);
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('SQL owner scan rejects mixed mapped alternatives and dynamic cross-boundary fragments', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-sql-map-boundary-')),filename=path.join(directory,'apps/zaruku/entry.ts');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  try {
    for(const source of [
      'const items=[0,1]; export const sql=items.map((item,index)=>index===0 ? "SELECT * FR" : "OM report_bd_private.canonical_fact_metrika_visits").join("");',
      'const items=[0,1]; export const sql=items.map((item,index)=>{if(index===0)return "SELECT * FR";return "OM report_bd_private.canonical_fact_metrika_visits";}).join("");',
      'const items=[0,1]; export const sql=items.map((item,index)=>index===0 ? "SELECT * FROM report_" : "bd_private.canonical_fact_metrika_visits").join("");',
      'declare const items: unknown[]; export const sql=items.map((item,index)=>index===0 ? "SELECT * FR" : "OM report_bd_private.canonical_fact_metrika_visits").join("");',
      'declare const items: unknown[]; export const sql=items.map((item,index)=>{if(index===0)return "SELECT * FR";return "OM report_bd_private.canonical_fact_metrika_visits";}).join("");',
      'declare const items: unknown[]; export const sql=items.map((item,index)=>index===0 ? "SELECT * FROM report_" : "bd_private.canonical_fact_metrika_visits").join("");',
      'declare const items: unknown[]; export const sql="SELECT * FR"+items.map(()=>runtimeFragment()).join("");',
      'declare const items: unknown[]; export const sql=items.map(()=>"SELECT * FR"+runtimeFragment()).join("");',
      'declare const items: unknown[]; export const sql=items.map(()=>"SELECT * FROM dashboards").join(runtimeSeparator());',
      'declare const items: unknown[]; export const sql=items.map((item,index)=>index===0 ? "SELECT 1 /*" : "*/ FROM report_bd_private.canonical_fact_metrika_visits").join("");',
    ]) {
      fs.writeFileSync(filename,source);
      assert.throws(()=>scanZarukuRuntimeMysqlTables(directory),/SQL|schema|composition|authority/i,source);
    }
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('SQL mapped composition is scoped, bounded and permits only exact unknown-length placeholders', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-sql-map-scope-')),filename=path.join(directory,'apps/zaruku/entry.ts');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const scan=source=>{fs.writeFileSync(filename,source);return scanZarukuRuntimeMysqlTables(directory);};
  try {
    assert.deepEqual(scan('const rows=[{table:"dashboards"},{table:"dashboard_sources"}]; export const sql=rows.map(row=>`SELECT * FROM ${row.table}`).join(" UNION ALL ");'),['dashboard_sources','dashboards']);
    assert.throws(()=>scan('const rows=[{table:"dashboards"},{table:"report_bd_private.canonical_fact_metrika_visits"}]; export const sql=rows.map(row=>`SELECT * FROM ${row.table}`).join(" UNION ALL ");'),/SQL|schema|authority/i);
    assert.throws(()=>scan('const rows=[0]; const part="FROM dashboards"; export const sql=rows.map(()=>{const part="FROM report_bd_private.canonical_fact_metrika_visits";return `SELECT * ${part}`;}).join(" UNION ALL ");'),/SQL|schema|authority/i);
    assert.throws(()=>scan('const rows=[0,1,2]; export const sql=rows.map((row,index)=>index===0 ? "SELECT * " : index===1 ? "FR" : "OM report_bd_private.canonical_fact_metrika_visits").join("");'),/SQL|schema|authority/i);
    assert.deepEqual(scan('declare const flag: boolean; const rows=[0,1]; function query() {const selection=flag ? "id" : "*";return `SELECT ${selection} FROM dashboards`;} export const sql=rows.map(()=>query()).join(" UNION ALL ");'),['dashboards']);
    assert.throws(()=>scan('declare const flag: boolean; const rows=[0,1]; export const sql=rows.map((row,index)=>flag ? (index===0 ? "SELECT * FR" : "OM report_bd_private.canonical_fact_metrika_visits") : "SELECT * FROM dashboards").join("");'),/SQL|schema|authority/i);
    assert.deepEqual(scan('declare const values: unknown[]; function placeholders(values: unknown[]) {return values.map(()=>"?").join(", ");} export const sql=`SELECT * FROM dashboards WHERE id IN (${placeholders(values)})`;'),['dashboards']);
    for(const source of [
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(value=>value).join(", ")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(value=>value ? "?" : "?").join(", ")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(()=>runtimeFragment()).join(", ")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(()=>`?`).join(", ")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(async()=>"?").join(", ")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(()=>"?").join(",")})`;',
      'declare const values: unknown[]; export const sql=`SELECT * FROM dashboards WHERE id IN (${values.map(()=>{sideEffect();return "?";}).join(", ")})`;',
      'const rows=[0,1]; export const sql=rows.map(()=>"SELECT * FROM dashboards").join(" UNION SELECT * FROM report_bd_private.canonical_fact_metrika_visits UNION ");',
      'let rows=[0]; export const sql=rows.map(()=>"SELECT * FROM dashboards").join(" UNION ALL ");',
      'const rows='+JSON.stringify(Array.from({length:65},(_,index)=>index))+'; export const sql=rows.map(()=>"SELECT * FROM dashboards").join(" UNION ALL ");',
      'declare const flags: Record<string,boolean>; const rows=[0]; export const sql=rows.map(()=>'+Array.from({length:7},(_,index)=>`(flags.f${index} ? "SELECT 1 " : "SELECT 2 ")`).join('+')+').join(" UNION ALL ");',
    ])assert.throws(()=>scan(source),/SQL|composition|authority/i,source);
    assert.deepEqual(scanZarukuRuntimeMysqlTables(root),loadMysqlTableAuthority(mysqlAuthorityPath).tables);
    assert.equal(loadMysqlTableAuthority(mysqlAuthorityPath).tables.length,35);
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('source-only shadow tests are a dedicated predeploy gate with no apply mode', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gate=pkg.scripts['test:zaruku-production-shadow'];
  for(const name of ['zaruku-production-shadow-contract','zaruku-production-shadow-preflight','zaruku-shadow-db','zaruku-shadow-host','install-zaruku-shadow-auth','install-zaruku-shadow-inventory','stage-zaruku-shadow-control','run-zaruku-production-shadow','zaruku-production-shadow-worker','zaruku-production-shadow-remote','zaruku-shadow-coverage','zaruku-shadow-evidence','runtime-boot-environment'])assert.ok(gate.includes(`scripts/${name}.test.mjs`));
  for(const name of ['zaruku-shadow-mysql','zaruku-xlsx-semantic','zaruku-shadow-evidence-lock'])assert.ok(gate.includes(`python3 -I -B scripts/${name}.test.py`));
  assert.ok(gate.includes('bash scripts/run-zaruku-linux-fixtures.test.sh'));
  assert.doesNotMatch(gate,/build-zaruku-linux-fixture|run-zaruku-linux-fixtures\.sh|--lock|ssh|pm2|nginx/);
  const predeploy = fs.readFileSync(path.join(root, 'scripts/predeploy-verify.sh'), 'utf8');
  assert.equal(predeploy.split(/\r?\n/).filter(line => line.trim() === 'npm run test:zaruku-production-shadow').length, 1);
  assert.doesNotMatch(predeploy, /zaruku-production-shadow[^\n]*--apply/);
});
