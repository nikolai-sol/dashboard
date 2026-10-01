import test from 'node:test';
import assert from 'node:assert/strict';
import { creativeKey, validateMappings, creativeSize, tupleKey, isMediaCreativeDashboard } from './creative-performance-contract';
const target = {source_key:'getintent',platform_account_id:'a',platform_campaign_id:'c',platform_creative_id:'x',line_key:'line'};
const tuple={utm_source:'programmatic',utm_medium:'get',utm_campaign:'c',utm_content:'x',utm_term:''};
test('creative identity separates account, campaign and plan line',()=>{
 assert.notEqual(creativeKey(target),creativeKey({...target,platform_account_id:'b'}));
 assert.notEqual(creativeKey(target),creativeKey({...target,platform_campaign_id:'d'}));
});
test('empty mappings valid; full exact tuples required and blanks are exact',()=>{
 assert.deepEqual(validateMappings([], [target], ['1']),[]);
 assert.throws(()=>validateMappings([{...target,counter_id:'1',tuples:[{utm_source:'x'}]}],[target],['1']),/five/);
 assert.notEqual(tupleKey(tuple),tupleKey({...tuple,utm_term:' '}));
});
test('counter tuple cannot belong to two targets and foreign targets rejected',()=>{
 const other={...target,platform_creative_id:'y'};
 assert.throws(()=>validateMappings([{...target,counter_id:'1',tuples:[tuple]},{...other,counter_id:'1',tuples:[tuple]}],[target,other],['1']),/assigned/);
 assert.throws(()=>validateMappings([{...target,counter_id:'9',tuples:[tuple]}],[target],['1']),/counter/);
});
test('mixed metadata never chooses arbitrary first size',()=>{
 assert.equal(creativeSize({creative_size:{version:1,status:'mixed',variants:[{width:160,height:600,source:'parsed'}]}}),'Mixed sizes');
 assert.equal(creativeSize({creative_size:{version:1,status:'single',variants:[{width:160,height:600,source:'parsed'}]}}),'160 × 600 (parsed)');
 assert.equal(creativeSize({}),'—');
});

test('actual Media dashboard types include Hudeem awareness, excluding isolated apps',()=>{assert.equal(isMediaCreativeDashboard('awareness'),true);assert.equal(isMediaCreativeDashboard('multibrand'),true);assert.equal(isMediaCreativeDashboard('abbott_bi'),false);assert.equal(isMediaCreativeDashboard('zaruku_bi'),false);});
import { aggregateCreativePostclick } from './creative-postclick';
test('creative postclick exact tuple needs both scopes coverage; absent dimensions cannot match',()=>{
 const fact={report_date:'2026-09-30',analytics_scope:'creative_traffic',attribution:'last',...tuple,visits:10,users:8,pageviews:20,bounce_rate:20,avg_visit_duration_seconds:30};
 assert.equal(aggregateCreativePostclick([fact],[],[tuple],['2026-09-30'],[]),null);
 const coverage=['creative_traffic','creative_goal'].map(analytics_scope=>({report_date:'2026-09-30',analytics_scope,status:'complete_with_data',attribution:'last'}));
 assert.equal(aggregateCreativePostclick([fact],coverage,[tuple],['2026-09-30'],[])?.visits,10);
 assert.equal(aggregateCreativePostclick([{...fact,utm_content:undefined}],coverage,[tuple],['2026-09-30'],[]),null);
 assert.equal(aggregateCreativePostclick([{...fact,utm_source:'PROGRAMMATIC'}],coverage,[tuple],['2026-09-30'],[])?.visits,0);
});
test('accepted empty is zero; users do not sum across days and weighted rates use visits',()=>{
 const days=['2026-09-29','2026-09-30'];const coverage=days.flatMap(report_date=>['creative_traffic','creative_goal'].map(analytics_scope=>({report_date,analytics_scope,status:'complete_empty',attribution:'last'})));
 const empty=aggregateCreativePostclick([],coverage,[tuple],days,[]);assert.equal(empty?.visits,0);assert.equal(empty?.goal_reaches,0);
 const facts=days.map((report_date,i)=>({...tuple,report_date,analytics_scope:'creative_traffic',attribution:'last',visits:i?30:10,users:8,pageviews:i?90:20,bounce_rate:i?40:20,avg_visit_duration_seconds:30}));
 const value=aggregateCreativePostclick(facts,coverage,[tuple],days,[]);assert.equal(value?.users,null);assert.equal(value?.bounce_rate,35);assert.equal(value?.page_depth,2.75);
});

test('selected goal mode with no goals never counts all goals',()=>{const day='2026-09-30';const coverage=['creative_traffic','creative_goal'].map(analytics_scope=>({report_date:day,analytics_scope,status:'complete_with_data',attribution:'last'}));const fact={...tuple,report_date:day,analytics_scope:'creative_goal',attribution:'last',goal_id:'1',goal_reaches:5};assert.equal(aggregateCreativePostclick([fact],coverage,[tuple],[day],[],'selected')?.goal_reaches,0);assert.equal(aggregateCreativePostclick([fact],coverage,[tuple],[day],[],'all')?.goal_reaches,5);});
import { preserveCreativeMappingNamespace } from './creative-performance-contract';
test('generic wizard preserves mapping namespace even when stale payload includes it',()=>{const saved=[{...target,counter_id:'1',tuples:[tuple]}];const config:Record<string,unknown>={title:'New title',creative_utm_bindings:[]};preserveCreativeMappingNamespace(config,{creative_utm_bindings:saved});assert.equal(config.creative_utm_bindings,saved);assert.equal(config.title,'New title');});
import { creativeAnalyticsThrough } from './creative-performance-contract';
test('creative analytics uses UTC completed days, not future campaign end or latest coverage',()=>{const now=new Date('2026-10-01T00:01:00Z');assert.equal(creativeAnalyticsThrough('2026-12-30',now),'2026-09-30');assert.equal(creativeAnalyticsThrough('2026-09-15',now),'2026-09-15');});

test('generic wizard preserves explicit creative collection opt-in without requiring a mapping',()=>{const config:Record<string,unknown>={creative_analytics:{counter_ids:[]},title:'Updated'};preserveCreativeMappingNamespace(config,{creative_analytics:{counter_ids:['112718783']}});assert.deepEqual(config.creative_analytics,{counter_ids:['112718783']});assert.equal(config.creative_utm_bindings,undefined);});
