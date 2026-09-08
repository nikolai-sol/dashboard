import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COVERAGE_TABLES, observeCanonicalCoverage } from './zaruku-shadow-coverage.mjs';

function fixture() {
  const queries=[];
  const schema=COVERAGE_TABLES.flatMap(table=>Object.entries(table.columns).map(([columnName,columnType])=>({tableName:table.name,columnName,columnType})));
  const admin={query:async()=>schema};
  const reader={query:async sql=>{queries.push(sql);return [Object.fromEntries(['rowCount',...sql.match(/ AS m\d+/g).map(x=>x.slice(4))].map(key=>[key,key==='rowCount'?'12':'0'.repeat(64)]))];}};
  return {admin,reader,schema,queries};
}

test('coverage token uses every fixed selected family and only scoped metadata',async()=>{
  const f=fixture();const token=await observeCanonicalCoverage(f.admin,f.reader);
  assert.equal(COVERAGE_TABLES.length,25);assert.match(token.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(token),['sha256']);
  assert.equal(f.queries.length,25);
  // Keep varchar account keys in string comparison; a numeric literal would
  // also match unrelated keys such as 66624469-other through MySQL coercion.
  for(const sql of f.queries){assert.match(sql,/analytics_account_id` = '66624469'/);assert.doesNotMatch(sql,/SELECT \*|visits|query_text|password|source_payload|canonical_collector_runs|LOCK TABLES/);}
  for(const table of COVERAGE_TABLES){const sql=f.queries.find(sql=>sql.includes('`'+table.name+'`'));assert.equal(sql.includes("BETWEEN '2026-01-01' AND '2026-08-31'"),table.scope==='period');}
  assert.match(f.queries.find(sql=>sql.includes('`canonical_alice_visibility_snapshots`')),/publication_status` = 'published'/);
});

test('schema absence, unknown/changed metadata types and malformed outputs fail closed without rows',async()=>{
  for(const fault of ['missing','type','row','extra','secret']){
    const f=fixture();
    if(fault==='missing')f.schema.pop();
    if(fault==='type')f.schema[0].columnType='text';
    if(fault==='row')f.reader.query=async()=>[];
    if(fault==='extra')f.reader.query=async()=>[{rowCount:'0',password:'PRIVATE_SENTINEL'}];
    if(fault==='secret')f.reader.query=async()=>{throw new Error('PRIVATE_SENTINEL');};
    await assert.rejects(()=>observeCanonicalCoverage(f.admin,f.reader),error=>error.message==='Zaruku canonical coverage check failed');
  }
});

test('only changed scoped metadata changes the token and no metadata rows are returned',async()=>{
  const f=fixture(); const first=await observeCanonicalCoverage(f.admin,f.reader);
  assert.deepEqual(await observeCanonicalCoverage(f.admin,f.reader),first);
  const query=f.reader.query;f.reader.query=async sql=>(await query(sql)).map(row=>({...row,rowCount:'13'}));
  const changed=await observeCanonicalCoverage(f.admin,f.reader);assert.notEqual(changed.sha256,first.sha256);
  assert.ok(JSON.stringify(changed).length<100);
});
