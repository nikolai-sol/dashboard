import test from 'node:test';
import assert from 'node:assert/strict';
import type pool from './db';
import { loadCreativePerformance, hybridCreativeFactTable } from './creative-performance';
import { advertisingFactTable } from './canonical-adapter';
const bindings=[{line_key:'L1',channel:'Display',source_key:'getintent',platform_account_id:'account-A',platform_campaign_id:'campaign-A',effective_from:'2026-09-01',effective_to:'2026-09-30'},{line_key:'L2',channel:'Video',source_key:'getintent',platform_account_id:'account-A',platform_campaign_id:'campaign-B',effective_from:'2026-09-01',effective_to:'2026-09-30'}];
test('Hybrid native authority requires accepted exact account-day publication lineage and suppresses empty fallback',()=>{
 const sql=hybridCreativeFactTable();
 assert.match(sql,/canonical_advertising_facts_current/);
 assert.match(sql,/native_grain='creative'/);assert.match(sql,/breakdown_scope='native_creative'/);
 assert.match(sql,/UNION ALL/);assert.match(sql,/NOT EXISTS/);
 for(const value of ['canonical_ad_coverage_daily','canonical_ad_publications','canonical_collector_run_events','complete_with_data','complete_empty','hybrid_native_creative_publication','contract_version','account_banner_id','full_account_day'])assert.ok(sql.includes(value),value);
 for(const alias of ['native','legacy'])for(const field of ['source_key','platform_account_id','report_date'])assert.ok(sql.includes(`p.${field}=${alias}.${field}`),`${alias}.${field}`);
 assert.match(sql,/coverage\.publication_id=p\.id/);assert.match(sql,/coverage\.ingestion_run_id=p\.ingestion_run_id/);assert.match(sql,/e\.run_id=p\.ingestion_run_id/);
 assert.match(sql,/p\.status='published'/);assert.match(sql,/p\.is_active=1/);
 // No fact-presence test is used as completeness proof: complete-empty must hide stale groups.
 assert.doesNotMatch(sql,/COUNT\(|rows_published\s*>\s*0/);
});
test('Hybrid native names and sizes stay native while legacy fallback remains a group',async()=>{
 const b={...bindings[0],source_key:'hybrid'};let query='';
 const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[[b]];query=sql;return[[{...b,platform_creative_id:'banner-1',native_creative:1,creative_name:'Banner 160x600',raw_payload:{creative_size:{version:1,status:'single',variants:[{width:160,height:600,source:'native'}]}},report_date:'2026-09-29',impressions:80,clicks:4,spend:null,fact_rows:1,impressions_rows:1,clicks_rows:1,spend_rows:0},{...b,platform_creative_id:'c_570',native_creative:0,creative_name:'First misleading banner',raw_payload:{},report_date:'2026-09-28',impressions:20,clicks:1,spend:null,fact_rows:1,impressions_rows:1,clicks_rows:1,spend_rows:0}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(42,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});
 assert.equal(data.rows.length,2);assert.equal(data.rows[0].name,'Banner 160x600');assert.equal(data.rows[1].name,'c_570 (creative group)');assert.equal(data.rows.reduce((sum,r)=>sum+(r.impressions??0),0),100);assert.match(query,/MAX\(f.native_creative\)/);
});
test('unmapped creatives retain platform facts and separate shared creative ID by campaign',async()=>{
 const calls:string[]=[];
 const executor={execute:async(sql:string)=>{calls.push(sql);if(sql.includes('SELECT DISTINCT line_key'))return[bindings];return[bindings.map((b,i)=>({...b,platform_creative_id:'shared-creative',report_date:'2026-09-29',impressions:(i+1)*100,clicks:10,spend:5,spend_rows:1,fact_rows:1,impressions_rows:1,clicks_rows:1,creative_name:'Known creative',raw_payload:{}}))];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],undefined,[],{executor});
 assert.equal(data.rows.length,2);assert.equal(data.rows.reduce((n,r)=>n+(r.impressions??0),0),300);assert.equal(data.has_mappings,false);assert.equal(data.rows[0].postclick,null);
 assert.equal(calls.length,2);assert.match(calls[1],/FROM canonical_fact_ads_daily f/);assert.doesNotMatch(calls[1],/canonical_advertising_facts_current/);
 assert.match(calls[1],/c.platform_account_id=f.platform_account_id/);assert.doesNotMatch(calls[1],/c.platform_campaign_id=f.platform_campaign_id/);
});
test('creative projection uses same published/historical authority as existing Direct reader',()=>{
 const sql=advertisingFactTable('yandex_direct',true);assert.match(sql,/canonical_advertising_facts_current/);assert.match(sql,/legacy.report_date < coverage_start.first_covered_date/);assert.match(sql,/platform_creative_id/);
 assert.equal(advertisingFactTable('getintent',true),advertisingFactTable('getintent'));
});
test('optional analytics query failure preserves platform rows with explicit unavailable state',async()=>{
 const mapping={...bindings[0],platform_creative_id:'creative',counter_id:'counter',tuples:[{utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''}]};
 const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[[bindings[0]]];if(sql.includes('canonical_fact_site_analytics_daily'))throw Object.assign(new Error('test timeout'),{code:'ETIMEDOUT'});return[[{...bindings[0],platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,impressions_rows:1,clicks_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-29','2026-09-29',[mapping],undefined,[],{executor,counters:['counter']});
 assert.equal(data.rows.length,1);assert.equal(data.rows[0].impressions,100);assert.equal(data.rows[0].postclick,null);assert.match(data.rows[0].availability,/unavailable/);
});
test('future campaign range clips only analytics to UTC yesterday and keeps missing past coverage unknown',async()=>{
 const b={...bindings[0],effective_to:'2026-12-30'};const tuple={utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''};const mapping={...b,platform_creative_id:'creative',counter_id:'counter',tuples:[tuple]};let coveragePresent=true;const queryEnds:string[]=[];
 const executor={execute:async(sql:string,args:unknown[])=>{if(sql.includes('SELECT DISTINCT line_key'))return[[b]];if(sql.includes('canonical_fact_site_analytics_daily')){queryEnds.push(String(args.at(-1)));return[[{...tuple,analytics_scope:'creative_traffic',attribution:'last',report_date:'2026-09-30',visits:5,users:3,pageviews:8,bounce_rate:20,avg_visit_duration_seconds:30}]];}if(sql.includes('canonical_media_creative_coverage_daily'))return[coveragePresent?['creative_traffic','creative_goal'].map(analytics_scope=>({report_date:'2026-09-30',analytics_scope,attribution:'last',status:'complete_with_data'})):[]];return[[{...b,platform_creative_id:'creative',report_date:'2026-09-30',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,impressions_rows:1,clicks_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const options={executor,counters:['counter'],now:new Date('2026-10-01T12:00:00Z')};
 const data=await loadCreativePerformance(987,'2026-09-30','2026-12-30',[mapping],undefined,[],options);assert.equal(data.rows[0].postclick?.visits,5);assert.equal(data.analytics_through,'2026-09-30');assert.deepEqual(queryEnds,['2026-09-30']);
 coveragePresent=false;const gap=await loadCreativePerformance(987,'2026-09-30','2026-12-30',[mapping],undefined,[],options);assert.equal(gap.rows[0].postclick,null);assert.equal(gap.rows[0].impressions,100);
});
test('stable binding line key survives a renamed display channel',async()=>{
 const b={...bindings[0],channel:'Программати'};
 const executor={execute:async(sql:string)=>sql.includes('SELECT DISTINCT line_key')?[[b]]:[[{...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,impressions_rows:1,clicks_rows:1,raw_payload:{}}]]} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],[{line_key:'L1',channel:'Программатик'}],[],{executor});
 assert.equal(data.rows.length,1);assert.equal(data.rows[0].line_key,'L1');assert.equal(data.rows[0].channel,'Программатик');assert.equal(data.rows[0].impressions,100);
});
test('an empty visible line selection yields no creative rows',async()=>{
 let queries=0;const executor={execute:async()=>{queries++;return[bindings];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],[],[],{executor});assert.equal(data.rows.length,0);assert.equal(queries,1);
});
test('platform-only reader ignores stale mappings and never queries new analytics tables',async()=>{
 const b=bindings[0];const mapping={...b,platform_creative_id:'creative',counter_id:'counter',tuples:[{utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''}]};const calls:string[]=[];
 const executor={execute:async(sql:string)=>{calls.push(sql);if(sql.includes('SELECT DISTINCT line_key'))return[[b]];if(sql.includes('canonical_fact_site_analytics_daily')||sql.includes('canonical_media_creative_coverage_daily'))throw Error('Creative analytics must be inactive');return[[{...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,impressions_rows:1,clicks_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[mapping],undefined,[],{executor,counters:['counter'],platformOnly:true});assert.equal(data.rows.length,1);assert.equal(data.rows[0].impressions,100);assert.equal(data.rows[0].cpc,2);assert.equal(data.has_mappings,false);assert.equal(data.rows[0].postclick,null);assert.equal(data.analytics_through,undefined);assert.equal(calls.length,2);
});
test('unknown platform cost stays null within or across daily groups; known zero stays zero',async()=>{
 const b=bindings[0];
 const run=async(facts:Record<string,unknown>[])=>{let sql='';const executor={execute:async(query:string)=>{if(query.includes('SELECT DISTINCT line_key'))return[[b]];sql=query;return[facts.map(f=>({...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,raw_payload:{},impressions_rows:f.fact_rows,clicks_rows:f.fact_rows,...f}))];}} as unknown as Pick<typeof pool,'execute'>;const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});assert.match(sql,/COUNT\(f\.spend\)/);assert.match(sql,/COUNT\(\*\)/);return data.rows[0];};
 const missing=await run([{spend:null,spend_rows:0,fact_rows:1}]);assert.equal(missing.spend,null);assert.equal(missing.cpc,null);
 const mixedGroup=await run([{spend:4,spend_rows:1,fact_rows:2}]);assert.equal(mixedGroup.spend,null);assert.equal(mixedGroup.cpc,null);
 const mixedDays=await run([{spend:4,spend_rows:1,fact_rows:1},{report_date:'2026-09-30',spend:null,spend_rows:0,fact_rows:1}]);assert.equal(mixedDays.spend,null);assert.equal(mixedDays.cpc,null);
 const zero=await run([{spend:0,spend_rows:1,fact_rows:1}]);assert.equal(zero.spend,0);assert.equal(zero.cpc,0);
});

test('cross-table creative identity comparisons use the canonical compatible collation',async()=>{
 const queries:string[]=[];const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[bindings];queries.push(sql);return[[]];}} as unknown as Pick<typeof pool,'execute'>;await loadCreativePerformance(42,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});
 for(const expression of ['c.source_key=f.source_key','c.platform_account_id=f.platform_account_id','c.platform_creative_id=f.platform_creative_id','b.source_key=f.source_key','b.platform_account_id=f.platform_account_id','b.platform_campaign_id=f.platform_campaign_id']) assert.ok(queries[0].includes(expression+' COLLATE utf8mb4_unicode_ci'));
});
test('creative CTR weights daily impressions and preserves unknown clicks and zero denominator',async()=>{
 const b=bindings[0];const run=async(values:Record<string,unknown>[])=>{const executor={execute:async(sql:string)=>sql.includes('SELECT DISTINCT line_key')?[[b]]:[values.map((v,i)=>({...b,platform_creative_id:'x',report_date:`2026-09-${29+i}`,raw_payload:{},spend:1,fact_rows:1,impressions_rows:1,clicks_rows:1,spend_rows:1,...v}))]} as unknown as Pick<typeof pool,'execute'>;return(await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true})).rows[0];};
 assert.equal((await run([{impressions:100,clicks:10,ctr:10},{impressions:900,clicks:9,ctr:1}])).ctr,1.9);
 const missing=await run([{impressions:100,clicks:null,clicks_rows:0}]);assert.equal(missing.clicks,null);assert.equal(missing.ctr,null);
 const partial=await run([{impressions:100,clicks:10},{impressions:900,clicks:null,clicks_rows:0}]);assert.equal(partial.ctr,null);
 assert.equal((await run([{impressions:100,clicks:0}])).ctr,0);
 assert.equal((await run([{impressions:0,clicks:0}])).ctr,null);
});

test('catalog preview reaches only already-bound exact creative rows without changing metrics or original preview column',async()=>{
 const b={...bindings[0],source_key:'hybrid'};let query='';
 const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[[b]];query=sql;return[[{...b,platform_creative_id:'native-1',native_creative:1,creative_name:'Banner',preview_url:'http://preview.hybrid.ai/?id=actual',raw_payload:{},report_date:'2026-09-29',impressions:80,clicks:4,spend:null,fact_rows:1,impressions_rows:1,clicks_rows:1,spend_rows:0}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(42,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});
 assert.match(query,/MAX\(c\.preview_url\) preview_url/);
 assert.equal(data.rows[0].canonical_preview_url,'http://preview.hybrid.ai/?id=actual');
 assert.equal(data.rows[0].preview_urls,undefined);assert.equal(data.rows[0].impressions,80);assert.equal(data.rows[0].clicks,4);
 assert.match(query,/b\.dashboard_id=\?/);assert.match(query,/c\.platform_account_id=f\.platform_account_id/);assert.match(query,/c\.platform_creative_id=f\.platform_creative_id/);
});
