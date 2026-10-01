import test from 'node:test';
import assert from 'node:assert/strict';
import type pool from './db';
import { loadCreativePerformance } from './creative-performance';
import { advertisingFactTable } from './canonical-adapter';
const bindings=[{line_key:'L1',channel:'Display',source_key:'getintent',platform_account_id:'account-A',platform_campaign_id:'campaign-A',effective_from:'2026-09-01',effective_to:'2026-09-30'},{line_key:'L2',channel:'Video',source_key:'getintent',platform_account_id:'account-A',platform_campaign_id:'campaign-B',effective_from:'2026-09-01',effective_to:'2026-09-30'}];
test('unmapped creatives retain platform facts and separate shared creative ID by campaign',async()=>{
 const calls:string[]=[];
 const executor={execute:async(sql:string)=>{calls.push(sql);if(sql.includes('SELECT DISTINCT line_key'))return[bindings];return[bindings.map((b,i)=>({...b,platform_creative_id:'shared-creative',report_date:'2026-09-29',impressions:(i+1)*100,clicks:10,spend:5,spend_rows:1,fact_rows:1,creative_name:'Known creative',raw_payload:{}}))];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],undefined,[],{executor});
 assert.equal(data.rows.length,2);assert.equal(data.rows.reduce((n,r)=>n+r.impressions,0),300);assert.equal(data.has_mappings,false);assert.equal(data.rows[0].postclick,null);
 assert.equal(calls.length,2);assert.match(calls[1],/FROM canonical_fact_ads_daily f/);assert.doesNotMatch(calls[1],/canonical_advertising_facts_current/);
 assert.match(calls[1],/c.platform_account_id=f.platform_account_id/);assert.doesNotMatch(calls[1],/c.platform_campaign_id=f.platform_campaign_id/);
});
test('creative projection uses same published/historical authority as existing Direct reader',()=>{
 const sql=advertisingFactTable('yandex_direct',true);assert.match(sql,/canonical_advertising_facts_current/);assert.match(sql,/legacy.report_date < coverage_start.first_covered_date/);assert.match(sql,/platform_creative_id/);
 assert.equal(advertisingFactTable('getintent',true),advertisingFactTable('getintent'));
});
test('optional analytics query failure preserves platform rows with explicit unavailable state',async()=>{
 const mapping={...bindings[0],platform_creative_id:'creative',counter_id:'counter',tuples:[{utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''}]};
 const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[[bindings[0]]];if(sql.includes('canonical_fact_site_analytics_daily'))throw Object.assign(new Error('test timeout'),{code:'ETIMEDOUT'});return[[{...bindings[0],platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-29','2026-09-29',[mapping],undefined,[],{executor,counters:['counter']});
 assert.equal(data.rows.length,1);assert.equal(data.rows[0].impressions,100);assert.equal(data.rows[0].postclick,null);assert.match(data.rows[0].availability,/unavailable/);
});
test('future campaign range clips only analytics to UTC yesterday and keeps missing past coverage unknown',async()=>{
 const b={...bindings[0],effective_to:'2026-12-30'};const tuple={utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''};const mapping={...b,platform_creative_id:'creative',counter_id:'counter',tuples:[tuple]};let coveragePresent=true;const queryEnds:string[]=[];
 const executor={execute:async(sql:string,args:unknown[])=>{if(sql.includes('SELECT DISTINCT line_key'))return[[b]];if(sql.includes('canonical_fact_site_analytics_daily')){queryEnds.push(String(args.at(-1)));return[[{...tuple,analytics_scope:'creative_traffic',attribution:'last',report_date:'2026-09-30',visits:5,users:3,pageviews:8,bounce_rate:20,avg_visit_duration_seconds:30}]];}if(sql.includes('canonical_media_creative_coverage_daily'))return[coveragePresent?['creative_traffic','creative_goal'].map(analytics_scope=>({report_date:'2026-09-30',analytics_scope,attribution:'last',status:'complete_with_data'})):[]];return[[{...b,platform_creative_id:'creative',report_date:'2026-09-30',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const options={executor,counters:['counter'],now:new Date('2026-10-01T12:00:00Z')};
 const data=await loadCreativePerformance(987,'2026-09-30','2026-12-30',[mapping],undefined,[],options);assert.equal(data.rows[0].postclick?.visits,5);assert.equal(data.analytics_through,'2026-09-30');assert.deepEqual(queryEnds,['2026-09-30']);
 coveragePresent=false;const gap=await loadCreativePerformance(987,'2026-09-30','2026-12-30',[mapping],undefined,[],options);assert.equal(gap.rows[0].postclick,null);assert.equal(gap.rows[0].impressions,100);
});
test('stable binding line key survives a renamed display channel',async()=>{
 const b={...bindings[0],channel:'Программати'};
 const executor={execute:async(sql:string)=>sql.includes('SELECT DISTINCT line_key')?[[b]]:[[{...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,raw_payload:{}}]]} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],[{line_key:'L1',channel:'Программатик'}],[],{executor});
 assert.equal(data.rows.length,1);assert.equal(data.rows[0].line_key,'L1');assert.equal(data.rows[0].channel,'Программатик');assert.equal(data.rows[0].impressions,100);
});
test('an empty visible line selection yields no creative rows',async()=>{
 let queries=0;const executor={execute:async()=>{queries++;return[bindings];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],[],[],{executor});assert.equal(data.rows.length,0);assert.equal(queries,1);
});
test('platform-only reader ignores stale mappings and never queries new analytics tables',async()=>{
 const b=bindings[0];const mapping={...b,platform_creative_id:'creative',counter_id:'counter',tuples:[{utm_source:'a',utm_medium:'b',utm_campaign:'c',utm_content:'d',utm_term:''}]};const calls:string[]=[];
 const executor={execute:async(sql:string)=>{calls.push(sql);if(sql.includes('SELECT DISTINCT line_key'))return[[b]];if(sql.includes('canonical_fact_site_analytics_daily')||sql.includes('canonical_media_creative_coverage_daily'))throw Error('Creative analytics must be inactive');return[[{...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,spend:4,spend_rows:1,fact_rows:1,raw_payload:{}}]];}} as unknown as Pick<typeof pool,'execute'>;
 const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[mapping],undefined,[],{executor,counters:['counter'],platformOnly:true});assert.equal(data.rows.length,1);assert.equal(data.rows[0].impressions,100);assert.equal(data.rows[0].cpc,2);assert.equal(data.has_mappings,false);assert.equal(data.rows[0].postclick,null);assert.equal(data.analytics_through,undefined);assert.equal(calls.length,2);
});
test('unknown platform cost stays null within or across daily groups; known zero stays zero',async()=>{
 const b=bindings[0];
 const run=async(facts:Record<string,unknown>[])=>{let sql='';const executor={execute:async(query:string)=>{if(query.includes('SELECT DISTINCT line_key'))return[[b]];sql=query;return[facts.map(f=>({...b,platform_creative_id:'creative',report_date:'2026-09-29',impressions:100,clicks:2,raw_payload:{},...f}))];}} as unknown as Pick<typeof pool,'execute'>;const data=await loadCreativePerformance(987,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});assert.match(sql,/COUNT\(f\.spend\)/);assert.match(sql,/COUNT\(\*\)/);return data.rows[0];};
 const missing=await run([{spend:null,spend_rows:0,fact_rows:1}]);assert.equal(missing.spend,null);assert.equal(missing.cpc,null);
 const mixedGroup=await run([{spend:4,spend_rows:1,fact_rows:2}]);assert.equal(mixedGroup.spend,null);assert.equal(mixedGroup.cpc,null);
 const mixedDays=await run([{spend:4,spend_rows:1,fact_rows:1},{report_date:'2026-09-30',spend:null,spend_rows:0,fact_rows:1}]);assert.equal(mixedDays.spend,null);assert.equal(mixedDays.cpc,null);
 const zero=await run([{spend:0,spend_rows:1,fact_rows:1}]);assert.equal(zero.spend,0);assert.equal(zero.cpc,0);
});

test('cross-table creative identity comparisons use the canonical compatible collation',async()=>{
 const queries:string[]=[];const executor={execute:async(sql:string)=>{if(sql.includes('SELECT DISTINCT line_key'))return[bindings];queries.push(sql);return[[]];}} as unknown as Pick<typeof pool,'execute'>;await loadCreativePerformance(42,'2026-09-01','2026-09-30',[],undefined,[],{executor,platformOnly:true});
 for(const expression of ['c.source_key=f.source_key','c.platform_account_id=f.platform_account_id','c.platform_creative_id=f.platform_creative_id','b.source_key=f.source_key','b.platform_account_id=f.platform_account_id','b.platform_campaign_id=f.platform_campaign_id']) assert.ok(queries[0].includes(expression+' COLLATE utf8mb4_unicode_ci'));
});
