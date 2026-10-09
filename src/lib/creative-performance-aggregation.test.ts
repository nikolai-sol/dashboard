import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCreativeRows, searchCreativeGroups, filterCreativeRows } from './creative-performance-aggregation';
import { creativeExcelColumns, type CreativeRow } from './creative-performance-contract';
const row: CreativeRow = {source_key:'getintent',platform_account_id:'a',platform_campaign_id:'c',platform_creative_id:'x',line_key:'l',channel:'Display',name:'Banner 160',size:'160 × 600',impressions:100,clicks:10,spend:4,ctr:10,cpc:.4,postclick:null,availability:'Platform creative data'};
test('size groups across hidden identifiers and weights ratios; visible names retain distinct pairs',()=>{
 const input=[row,{...row,platform_campaign_id:'other',platform_creative_id:'y',name:'Other',impressions:900,clicks:9,spend:6}];
 const grouped=groupCreativeRows(input,['size','impressions','ctr']);
 assert.equal(grouped.length,1);assert.equal(grouped[0].impressions,1000);assert.equal(grouped[0].clicks,19);assert.equal(grouped[0].ctr,1.9);assert.equal(grouped[0].spend,10);assert.equal(grouped[0].cpc,10/19);
 assert.equal(groupCreativeRows(input,['name','size','impressions']).length,2);
 const columns=creativeExcelColumns(['size','impressions','ctr'],false);assert.deepEqual(grouped.map(r=>columns.map(c=>c.value(r))),[['160 × 600',1000,1.9]]);
 assert.equal(input[0].impressions,100);
});
test('metrics-only is one summary and empty rows stay empty; visible IDs match across hidden accounts',()=>{
 const input=[row,{...row,source_key:'hybrid',platform_account_id:'b',size:'728 × 90'}];
 assert.equal(groupCreativeRows(input,['impressions','ctr']).length,1);
 assert.equal(groupCreativeRows(input,['creative_id','impressions']).length,1);
 assert.equal(groupCreativeRows(input,['source_account','creative_id']).length,2);
 assert.deepEqual(groupCreativeRows([],['impressions']),[]);
});
test('unknown counts propagate, zero CTR is real and incompatible reporting units hide spend/CPC',()=>{
 const partial=groupCreativeRows([row,{...row,clicks:null}],['size'])[0];assert.equal(partial.clicks,null);assert.equal(partial.ctr,null);
 assert.equal(groupCreativeRows([{...row,impressions:0,clicks:0}],['size'])[0].ctr,null);
 assert.equal(groupCreativeRows([{...row,clicks:0}],['size'])[0].ctr,0);
 const mixed=groupCreativeRows([row,{...row,platform_account_id:'other'}],['size','spend','cpc'])[0];assert.equal(mixed.spend,null);assert.equal(mixed.cpc,null);assert.equal(mixed.mixed_cost_basis,true);
 assert.equal(groupCreativeRows([row,{...row,spend:null}],['size'])[0].spend,null);
});
test('search sees only visible grouped descriptions and ignores hidden-name matches',()=>{
 const grouped=groupCreativeRows([row,{...row,size:'728 × 90',name:'Hidden 160'}],['size','impressions']);
 assert.deepEqual(searchCreativeGroups(grouped,['size','impressions'],'160').map(r=>r.size),['160 × 600']);
 assert.equal(searchCreativeGroups(groupCreativeRows([row],['impressions']),['impressions'],'hidden').length,1);
 // Caller applies channel filters first; grouping does not reintroduce excluded rows.
 assert.equal(groupCreativeRows([row,{...row,channel:'Video',impressions:900}].filter(r=>r.channel==='Display'),['size'])[0].impressions,100);
});

test('unequal small and large size rows use totals rather than averaging percentages',()=>{
 const impressions=[48,56,60,54,821],clicks=[0,0,0,1,8];
 const grouped=groupCreativeRows(impressions.map((value,i)=>({...row,platform_creative_id:String(i),impressions:value,clicks:clicks[i]})),['size','impressions','ctr']);
 assert.equal(grouped.length,1);assert.equal(grouped[0].impressions,1039);assert.equal(grouped[0].ctr,900/1039);
});

test('platform selection excludes a different source sharing the same plan channel before grouping',()=>{
 const input=[row,{...row,source_key:'hybrid',impressions:900,clicks:9}];
 assert.equal(groupCreativeRows(filterCreativeRows(input,['Display'],['git']),['size'])[0].impressions,100);
 assert.equal(groupCreativeRows(filterCreativeRows(input,['Display'],['hybrid']),['size'])[0].impressions,900);
 assert.equal(groupCreativeRows(filterCreativeRows(input,['Display']),['size'])[0].impressions,1000);
 assert.deepEqual(filterCreativeRows(input,[]),[]);
 assert.deepEqual(filterCreativeRows(input,['Display'],[]),[]);
});


test('minimum impressions filters after visible grouping and keeps the exact boundary with hidden counts',()=>{
 const input=[{...row,name:'merged',impressions:600,clicks:6},{...row,name:'merged',platform_creative_id:'second',impressions:600,clicks:12},{...row,name:'below',impressions:999},{...row,name:'boundary',impressions:1000,clicks:5}];
 const groups=groupCreativeRows(input,['name','ctr'],1000);
 assert.deepEqual(groups.map(r=>[r.name,r.impressions,r.clicks,r.ctr]),[['merged',1200,18,1.5],['boundary',1000,5,.5]]);
 assert.equal(input[0].impressions,600);assert.equal(input.length,4);
 assert.deepEqual(searchCreativeGroups(groups,['name','ctr'],'below'),[]);
 assert.deepEqual(groups.map(r=>creativeExcelColumns(['name','ctr'],false).map(c=>c.value(r))),[['merged',1.5],['boundary',.5]]);
});
test('zero minimum retains unknown and zero counts; positive minimum cannot qualify unknown counts',()=>{
 const input=[{...row,name:'unknown',impressions:null},{...row,name:'zero',impressions:0},{...row,name:'small',impressions:1}];
 assert.equal(groupCreativeRows(input,['name'],0).length,3);
 assert.deepEqual(groupCreativeRows(input,['name'],1).map(r=>r.name),['small']);
});
