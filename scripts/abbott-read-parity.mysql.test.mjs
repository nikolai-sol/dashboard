import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import mysql from 'mysql2/promise';
import bi from '../src/lib/abbott-bi.ts';
import store from '../src/lib/abbott-private-store.ts';
import requests from '../src/lib/abbott-read-request.ts';
const { loadAbbottBiDataWithDependencies } = bi;
const { withReadOnlyAbbottExecutor } = store;
const { abbottBaseAvailableViews } = requests;

const port = Number(process.env.ABBOTT_TEST_MYSQL_PORT);
assert(Number.isInteger(port) && port > 0, 'Run with the owned fixture helper');
const config = { host: '127.0.0.1', port, user: 'root', password: process.env.ABBOTT_TEST_MYSQL_PASSWORD, dateStrings: ['DATE', 'DATETIME'], multipleStatements: false };
let writer, pool, previousPool;
const source = { source_status: 'missing', test_dump: true, snapshot_id: null, generated_at: null, period_from: null, period_to: null };
const workbook = { generalMaterials: [], externalEvents: [], contentByUrl: new Map(), contentByTitle: new Map(), contentBySlug: new Map(), urlReturnDirections: new Map(), lookupQuality: { ambiguousGroups: 0, collapsedGroups: 0 }, ymUrlReturn: [], userDirections: new Map([['001', 'Cardiology'], ['1\n2', 'Collision first'], ['1', 'Collision second']]) };
const release = { id: 41 };
const from = '2026-01-01', to = '2026-01-03';
before(async () => {
  writer = await mysql.createConnection(config);
  console.log(JSON.stringify({ mysql: (await writer.query('SELECT VERSION() AS version'))[0][0].version, node: process.version, icu: process.versions.icu }));
  await writer.query('CREATE DATABASE report_bd_private CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await writer.query(`CREATE TABLE report_bd_private.canonical_fact_metrika_visits (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, canonical_release_id BIGINT UNSIGNED NOT NULL,
    counter_id BIGINT UNSIGNED NOT NULL, report_date DATE NOT NULL, visit_id_hash CHAR(64) NOT NULL,
    session_started_at DATETIME NOT NULL, utm_source VARCHAR(500), raw_user_id TEXT,
    raw_user_ids_json JSON, client_id_hash CHAR(64), traffic_source VARCHAR(500) NOT NULL,
    start_url TEXT NOT NULL, end_url TEXT NOT NULL, pageviews BIGINT UNSIGNED NOT NULL,
    duration_seconds BIGINT UNSIGNED NOT NULL, is_bounce TINYINT(1) NOT NULL,
    UNIQUE KEY visit_identity (canonical_release_id,counter_id,report_date,visit_id_hash),
    KEY release_date_source (canonical_release_id,report_date,traffic_source)
  ) ENGINE=InnoDB`);
  await writer.query('CREATE TABLE report_bd_private.portal_abbott_admin_user_exclusions (dashboard_id BIGINT NOT NULL, raw_user_id VARCHAR(32) NOT NULL) ENGINE=InnoDB');
  pool = mysql.createPool({ ...config, connectionLimit: 1 });
  previousPool = globalThis.__abbottPrivateMysqlPool;
  globalThis.__abbottPrivateMysqlPool = pool;
});
after(async () => {
  if (previousPool === undefined) delete globalThis.__abbottPrivateMysqlPool;
  else globalThis.__abbottPrivateMysqlPool = previousPool;
  await pool?.end(); await writer?.end();
});

function visit(overrides = {}) {
  return { canonical_release_id: 41, counter_id: '90602537', report_date: from, visit_id_hash: 'v0001', session_started_at: `${from} 10:00:00`, utm_source: null, raw_user_id: '001', raw_user_ids_json: '["001"]', client_id_hash: 'client-a', traffic_source: 'Direct', start_url: '/start', end_url: '/end', pageviews: '3', duration_seconds: '10', is_bounce: 0, ...overrides };
}
async function seed(rows, admins = []) {
  await writer.query('DELETE FROM report_bd_private.canonical_fact_metrika_visits');
  await writer.query('DELETE FROM report_bd_private.portal_abbott_admin_user_exclusions');
  for (const id of admins) await writer.execute('INSERT INTO report_bd_private.portal_abbott_admin_user_exclusions VALUES (7, ?)', [id]);
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100), keys = Object.keys(batch[0]);
    await writer.query(`INSERT INTO report_bd_private.canonical_fact_metrika_visits (${keys.join(',')}) VALUES ${batch.map(() => `(${keys.map(() => '?').join(',')})`).join(',')}`, batch.flatMap(row => keys.map(key => row[key])));
  }
}
async function load(view, afterPage, visitSql = sql => sql) {
  const queries = [], rowCounts = [];
  let sqlError;
  const result = await withReadOnlyAbbottExecutor('manager', async executor => {
    const privateExecutor = { async forEachRow(sql, params, consume) {
      queries.push(sql);
      try {
        await executor.forEachRow(visitSql(sql), params, row => { rowCounts.push(1); consume(row); });
        if (afterPage) await afterPage();
      } catch (error) { sqlError = error; throw error; }
    }, async query(sql, params) {
      queries.push(sql);
      try {
        const rows = await executor.query(sql, params); rowCounts.push(rows.length);
        if (sql.includes('LIMIT 1000') && afterPage) await afterPage();
        return rows;
      } catch (error) { sqlError = error; throw error; }
    } };
    return loadAbbottBiDataWithDependencies(7, ['90602537'], from, to, 'manager', {
      aggregateExecutor: { async query(sql) {
        if (!sql.includes('canonical_source_coverage_daily')) return [];
        return [from, '2026-01-02', to].flatMap(report_date => ['other','traffic','page','user_behavior','returning'].map(scope_key => ({ counter_id: '90602537', report_date, scope_key, collection_status: 'success', pagination_complete: 1, is_sampled: 0, empty_reconciled: 0 })));
      } }, privateExecutor,
      async resolveRelease() { return release; },
      async loadLookupQuality() { return workbook.lookupQuality; },
      async loadReleaseBundle(_release, audience, _from, _to, request) {
        return { releaseId: 41, audience, workbook, bitrixPages: { source, summary: null, rows: [] }, journeys: { source, rows: [] }, ...(request ? { availableViews: abbottBaseAvailableViews(audience) } : {}) };
      },
    }, view ? { view } : undefined);
  });
  return { result, queries, rowCounts, sqlError };
}
async function parity(rows, admins = [], expectedStatus = 'complete') {
  await seed(rows, admins);
  const full = await load(), scoped = await load('users_summary');
  assert.equal(full.result.data_quality.status, expectedStatus, full.sqlError?.message);
  assert.equal(scoped.result.data_quality.status, expectedStatus, scoped.sqlError?.message);
  assert.deepEqual(scoped.result.users_summary, full.result.users_summary);
  assert.deepEqual(scoped.result.users_summary_without_admins, full.result.users_summary_without_admins);
  assert.deepEqual(scoped.result.traffic_summary, full.result.traffic_summary);
  assert.deepEqual(scoped.result.data_quality, full.result.data_quality);
  assert.deepEqual(scoped.result.admin_user_filter, full.result.admin_user_filter);
  assert(scoped.queries.filter(sql => sql.includes('SELECT report_date')).every(sql => !/LIMIT|start_url|end_url/.test(sql)));
  return scoped;
}

test('real decoding: whole-period clients, null hashes, admins, multi IDs, JSON fallback, whitespace and Unicode', async () => {
  const variants = [
    {}, { report_date: '2026-01-02', session_started_at: '2026-01-02 10:00:00' },
    { client_id_hash: null }, { client_id_hash: 'client-b', is_bounce: 1 },
    { raw_user_id: null, raw_user_ids_json: '["001","002"]' },
    { raw_user_id: null, raw_user_ids_json: '[]', client_id_hash: 'anonymous' },
    { raw_user_ids_json: null }, { raw_user_ids_json: 'null' },
    { raw_user_ids_json: JSON.stringify('["001"]') }, { raw_user_ids_json: JSON.stringify('null') },
    { raw_user_id: ' É ', raw_user_ids_json: '[" É "]', traffic_source: ' search ' },
    { raw_user_id: 'é', raw_user_ids_json: '["é"]', traffic_source: 'SEARCH' },
    { traffic_source: 'Direct ' }, { client_id_hash: 'CLIENT-A' }, { client_id_hash: 'client-a ' },
    { client_id_hash: 'client-a ', raw_user_id: '', raw_user_ids_json: 'null' },
  ];
  await parity(variants.map((v, i) => visit({ ...v, visit_id_hash: `v${i.toString().padStart(4, '0')}` })), ['001']);
});

test('exact newline key collisions keep independent first representatives and stable sorting', async () => {
  const rows = [
    visit({ raw_user_id: '1\n2', raw_user_ids_json: '["1\\n2"]', traffic_source: 'x', visit_id_hash: 'v1' }),
    visit({ raw_user_id: '1', raw_user_ids_json: '["1"]', traffic_source: '2\nx', visit_id_hash: 'v2', client_id_hash: 'client-b' }),
    visit({ raw_user_id: 'é', raw_user_ids_json: '["é"]', traffic_source: 'a', visit_id_hash: 'v3' }),
    visit({ raw_user_id: 'é', raw_user_ids_json: '["é"]', traffic_source: 'a', visit_id_hash: 'v4' }),
  ];
  await parity(rows, ['1']);
  await parity(rows.map((row, i) => ({ ...row, visit_id_hash: `v${rows.length - i}` })), ['1']);
});

test('unsafe individual/cumulative integers preserve JS ordered sums, rounding and bounce2=false', async () => {
  for (const values of [['9007199254740993','1','1'], ['9007199254740991','2','2'], ['18446744073709551615','1','5'], ['1','2','2']]) {
    await parity(values.map((value, i) => visit({ visit_id_hash: `v${i}`, pageviews: value, duration_seconds: value, is_bounce: i === 1 ? 2 : i === 2 ? 1 : 0 })));
  }
});

test('malformed identities including excluded admin visits fail identically before DISTINCT', async () => {
  for (const invalid of [
    { raw_user_ids_json: '[""]' }, { raw_user_ids_json: '["  "]' },
    { raw_user_ids_json: '["001","001"]' }, { raw_user_ids_json: '[1]' },
    { raw_user_ids_json: '{}' }, { raw_user_ids_json: JSON.stringify('bad-json') },
    { raw_user_ids_json: '["002"]' }, { client_id_hash: '' },
  ]) {
    const result = await parity([visit(invalid)], ['001'], 'incomplete');
    assert(!result.queries.some(sql => sql.includes('abbott-summary-distinct')));
  }
});

test('1001 chronological visits use one prepared consumer and repeat clients across dates', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => visit({ visit_id_hash: `v${i.toString().padStart(4,'0')}`, report_date: i < 1000 ? from : to, session_started_at: `${i < 1000 ? from : to} 10:00:00`, client_id_hash: `client-${i % 17}` }));
  const scoped = await parity(rows);
  assert.equal(scoped.queries.length, 3);
  assert.equal(scoped.queries.filter(sql => sql.includes('SELECT report_date')).length, 1);
  assert(scoped.rowCounts.every(n => n <= 1000));
  assert.equal(scoped.result.users_summary[0].users, 17);
  const invalidLast = rows.map((row, i) => i === 1000 ? { ...row, raw_user_ids_json: '["001","001"]' } : row);
  const invalid = await parity(invalidLast, ['001'], 'incomplete');
  assert.equal(invalid.queries.filter(sql => sql.includes('SELECT report_date')).length, 1);
  assert(!invalid.queries.some(sql => sql.includes('abbott-summary-distinct')));
  await parity([]);
});

test('transaction-local RR preserves snapshot between row consumption and distinct after concurrent insert', async () => {
  await seed([visit()]);
  // A weaker connection default must not leak into this transaction. The
  // one-connection pool ensures the helper receives this exact connection.
  await pool.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  let inserted = false;
  const result = await load('users_summary', async () => {
    if (inserted) return; inserted = true;
    const row = visit({ visit_id_hash: 'later', client_id_hash: 'later' });
    const keys = Object.keys(row);
    await writer.execute(`INSERT INTO report_bd_private.canonical_fact_metrika_visits (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row));
  });
  assert.equal(result.result.data_quality.status, 'complete', result.sqlError?.message);
  assert.equal(result.result.users_summary[0].visits, 1);
  assert.equal(result.result.users_summary[0].users, 1);
  const fresh = await load('users_summary');
  assert.equal(fresh.result.users_summary[0].visits, 2);
  assert.equal(fresh.result.users_summary[0].users, 2);
});

test('real prepared driver drains validation and server errors without retaining rows or poisoning reuse', async () => {
  await seed(Array.from({ length: 1001 }, (_, i) => visit({ visit_id_hash: `v${i.toString().padStart(4, '0')}` })));
  const inspected = await pool.getConnection(), core = inspected.connection, original = core.execute;
  let retainedRows, preparedWithoutCallback = false;
  core.execute = function(sql, params, callback) {
    const command = original.call(this, sql, params, callback);
    if (sql.includes('fixture-drain')) {
      preparedWithoutCallback = callback === undefined && command.onResult === undefined;
      command.once('end', () => { retainedRows = command._rows.flat().length; });
    }
    return command;
  };
  inspected.release();
  try {
    await withReadOnlyAbbottExecutor('manager', async executor => {
      const before = (await executor.query('SELECT CONNECTION_ID() AS id', []))[0].id;
      let visited = 0;
      await assert.rejects(executor.forEachRow('SELECT /* fixture-drain */ visit_id_hash FROM report_bd_private.canonical_fact_metrika_visits ORDER BY report_date,session_started_at,visit_id_hash', [], () => { visited++; throw Error('fixture invalid visit'); }), /fixture invalid visit/);
      assert.equal(visited, 1);
      assert.equal(retainedRows, 0); assert.equal(preparedWithoutCallback, true);
      const after = (await executor.query('SELECT CONNECTION_ID() AS id', []))[0].id;
      assert.equal(after, before);
      // A real prepared-statement server error must finish before the next
      // command, without turning the established incomplete path into fatal.
      await assert.rejects(executor.forEachRow('SELECT * FROM report_bd_private.missing_fixture_table', [], () => assert.fail()), /doesn.t exist/);
      assert.equal((await executor.query('SELECT CONNECTION_ID() AS id', []))[0].id, before);
    });
  } finally { core.execute = original; }
  const unavailable = await load('users_summary', undefined, sql => sql.replace('visit_id_hash', 'missing_fixture_column'));
  assert.equal(unavailable.result.data_quality.status, 'incomplete');
  assert.equal(unavailable.sqlError.sqlState, '42S22');
  assert.equal((await load('users_summary')).result.data_quality.status, 'complete');
});

test('owned transport loss discards exactly the failed connection before pool reuse', async () => {
  await seed(Array.from({ length: 1001 }, (_, i) => visit({ visit_id_hash: `v${i.toString().padStart(4, '0')}` })));
  const inspected = await pool.getConnection(), core = inspected.connection, priorId = core.threadId;
  inspected.release();
  let interrupted = false;
  await assert.rejects(withReadOnlyAbbottExecutor('manager', async executor => {
    await executor.forEachRow("SELECT REPEAT('x',10000) AS payload FROM report_bd_private.canonical_fact_metrika_visits", [], () => {
      if (!interrupted) { interrupted = true; core.stream.destroy(Error('fixture owned transport interruption')); }
    });
  }), /Abbott private data is unavailable/);
  assert.equal(interrupted, true);
  const replacement = await pool.getConnection();
  try {
    assert.notEqual(replacement.connection.threadId, priorId);
    assert.equal((await replacement.execute('SELECT 1 AS ok'))[0][0].ok, 1);
    assert.equal(core._pool, null);
  } finally { replacement.release(); }
});

test('defensive legacy NULL traffic parity (fixture-only deviation from canonical NOT NULL)', async () => {
  await writer.query('ALTER TABLE report_bd_private.canonical_fact_metrika_visits MODIFY traffic_source VARCHAR(500) NULL');
  try {
    const scoped = await parity([
      visit({ traffic_source: null }),
      visit({ visit_id_hash: 'empty-source', traffic_source: '', client_id_hash: 'client-b' }),
    ]);
    assert.equal(scoped.result.users_summary.length, 1);
    assert.equal(scoped.result.users_summary[0].traffic_source, '');
    assert.equal(scoped.result.users_summary[0].users, 2);
  } finally {
    await seed([]);
    await writer.query('ALTER TABLE report_bd_private.canonical_fact_metrika_visits MODIFY traffic_source VARCHAR(500) NOT NULL');
  }
});
