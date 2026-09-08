import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Exact information_schema COLUMN_TYPE authority reviewed for the selected live
// read model. Account-only families are also account-only in manager reads.
const table = (name, account, id, ingestion, times, scope='account', extra={}) => {
  const columns={analytics_account_id:account,...(id?{id}:{}),...(ingestion?{ingestion_run_id:ingestion}:{}),...times,...extra};
  const metadata=Object.keys(columns).filter(key=>!['analytics_account_id','report_date','period_month','publication_status'].includes(key));
  return Object.freeze({name,scope,columns:Object.freeze(columns),metadata:Object.freeze(metadata)});
};
const timestamps={created_at:'timestamp',updated_at:'timestamp'};
const daily=(name,account,id,ingestion)=>table(name,account,id,ingestion,timestamps,'period',{report_date:'date'});
export const COVERAGE_TABLES=Object.freeze([
  daily('canonical_fact_site_analytics_daily','varchar(128)','bigint','bigint'),
  daily('canonical_fact_metrika_returning_pages_daily','bigint','bigint unsigned','bigint'),
  daily('canonical_fact_metrika_breakdowns_daily','varchar(128)','bigint','bigint'),
  daily('canonical_metrika_breakdown_coverage_daily','varchar(128)','bigint','bigint'),
  ...['summary','queries','pages','query_pages'].map(name=>daily(`canonical_fact_webmaster_${name}_daily`,'varchar(128)','bigint unsigned','bigint unsigned')),
  daily('canonical_fact_gsc_queries_daily','bigint','bigint unsigned','varchar(64)'),
  ...['search_appearance','search_type'].map(name=>daily(`canonical_fact_gsc_${name}_daily`,'bigint','bigint unsigned','bigint')),
  table('canonical_wordstat_coverage','varchar(128)','bigint unsigned','bigint',timestamps),
  daily('canonical_fact_wordstat_dynamics_daily','varchar(128)','bigint unsigned','bigint'),
  ...['requests','regions'].map(name=>table(`canonical_fact_wordstat_${name}_snapshot`,'varchar(128)','bigint unsigned','bigint',timestamps)),
  ...['seed_registry','query_classifications'].map(name=>table(`canonical_wordstat_${name}`,'varchar(128)','bigint unsigned',null,timestamps)),
  table('canonical_alice_visibility_snapshots','varchar(128)','bigint','varchar(128)',{...timestamps,captured_at:'datetime'},'period',{period_month:'date',publication_status:'varchar(32)',source_sha256:'char(64)',snapshot_fingerprint_sha256:'char(64)'}),
  table('seo_positions_weekly','bigint','bigint unsigned','varchar(64)',{checked_at:'datetime'}),
  table('seo_opportunities','bigint','bigint unsigned','varchar(64)',{decided_at:'datetime'}),
  table('seo_tasks','bigint',null,'varchar(64)',{created_at:'datetime',updated_at:'datetime'}),
  table('seo_weekly_runs','bigint','bigint unsigned','varchar(64)',{finished_at:'datetime'}),
  table('seo_section_patterns','bigint','int unsigned',null,{updated_at:'timestamp'}),
  table('seo_sov_weekly','bigint','bigint unsigned','varchar(64)',{snapshot_date:'date',date_start:'date',date_end:'date'}),
  table('seo_ai_visibility','bigint','bigint unsigned','varchar(64)',{captured_at:'datetime'}),
]);

export async function observeCanonicalCoverage(admin,reader) {
  try {
    const schema=await admin.query("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd' AND TABLE_NAME IN ("+COVERAGE_TABLES.map(row=>`'${row.name}'`).join(',')+')');
    if(!Array.isArray(schema)||schema.length>2048)throw new Error();
    const keys=new Map();
    for(const row of schema){
      if(!isDeepStrictEqual(Object.keys(row).sort(),['columnName','columnType','tableName'])||typeof row.columnName!=='string'||typeof row.columnType!=='string'||!COVERAGE_TABLES.some(table=>table.name===row.tableName))throw new Error();
      const key=row.tableName+'.'+row.columnName;if(keys.has(key))throw new Error();keys.set(key,row.columnType);
    }
    for(const table of COVERAGE_TABLES)for(const [name,type]of Object.entries(table.columns))if(keys.get(table.name+'.'+name)!==type)throw new Error();
    const observations=[];
    for(const table of COVERAGE_TABLES){
      const metadata=table.metadata.map((name,i)=>`SHA2(COALESCE(CAST(MAX(\`${name}\`) AS CHAR), ''), 256) AS m${i}`);
      const scope=table.scope==='period'?` AND \`${table.name==='canonical_alice_visibility_snapshots'?'period_month':'report_date'}\` BETWEEN '2026-01-01' AND '2026-08-31'`:'';
      const published=table.name==='canonical_alice_visibility_snapshots'?" AND `publication_status` = 'published'":'';
      const rows=await reader.query(`SELECT COUNT(*) AS rowCount, ${metadata.join(', ')} FROM \`report_bd\`.\`${table.name}\` WHERE \`analytics_account_id\` = '66624469'${scope}${published}`);
      const expected=['rowCount',...table.metadata.map((_,i)=>`m${i}`)];
      if(!Array.isArray(rows)||rows.length!==1||!isDeepStrictEqual(Object.keys(rows[0]).sort(),expected.sort())||!/^[0-9]{1,20}$/.test(rows[0].rowCount)||table.metadata.some((_,i)=>!/^[a-f0-9]{64}$/.test(rows[0][`m${i}`])))throw new Error();
      observations.push([table.name,rows[0]]);
    }
    return Object.freeze({sha256:createHash('sha256').update(JSON.stringify(observations)).digest('hex')});
  } catch { throw new Error('Zaruku canonical coverage check failed'); }
}
