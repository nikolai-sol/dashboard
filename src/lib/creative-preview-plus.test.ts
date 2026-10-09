import test from 'node:test';
import assert from 'node:assert/strict';
import * as preview from './creative-preview-plus';
import * as contract from './creative-performance-contract';
import {groupCreativeRows} from './creative-performance-aggregation';
import {resolveCreativeSectionOrder} from './dashboard-presets';
import {normalizeDashboardSectionFieldOverrides} from './dashboard-section-fields';
import type {CreativeRow} from './creative-performance-contract';
const row:CreativeRow={source_key:'getintent',platform_account_id:'15480',platform_campaign_id:'campaign1',platform_creative_id:'904789',line_key:'l',channel:'Display',name:'Same name',size:'160 × 600',impressions:100,clicks:10,spend:1,ctr:10,cpc:0.1,postclick:null,availability:'Platform creative data'};
const url='https://px.adhigh.net/creative_preview?c=904789';
const mapping={source_key:row.source_key,platform_account_id:row.platform_account_id,platform_creative_id:row.platform_creative_id,preview_url:url};
test('Plus selects only exact source/account/native ID matches from bound canonical rows',()=>{
 const rows=preview.selectCreativePreviewRows([row,{...row,platform_account_id:'15510'},{...row,source_key:'hybrid'},{...row,platform_creative_id:'different'}],[mapping]);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].preview_urls,[url]);assert.equal(row.preview_urls,undefined);
});
test('invalid URL, embedded credentials and conflicting identity mappings fail closed',()=>{
 for(const preview_url of ['javascript:alert(1)','https://name:password@example.org/preview','http://example.org/preview','not a URL'])assert.equal(preview.selectCreativePreviewRows([row],[{...mapping,preview_url}]).length,0);
 assert.equal(preview.selectCreativePreviewRows([row],[mapping,{...mapping,preview_url:'https://example.org/other'}]).length,0);
 assert.equal(preview.selectCreativePreviewRows([row],[mapping,mapping]).length,1);
});
test('same size sums hidden identities and keeps every distinct preview, visible or hidden',()=>{
 const other={...row,platform_campaign_id:'campaign2',platform_creative_id:'second',impressions:900,clicks:9};
 const matched=preview.selectCreativePreviewRows([row,other],[mapping,{...mapping,platform_creative_id:'second',preview_url:'https://px.adhigh.net/creative_preview?c=second'}]);
 for(const fields of [['size','impressions','ctr'],['size','impressions','ctr','preview']]){
  const groups=groupCreativeRows(matched,fields as contract.CreativeFieldId[]);assert.equal(groups.length,1);assert.equal(groups[0].impressions,1000);assert.equal(groups[0].ctr,1.9);assert.deepEqual(groups[0].preview_urls,[url,'https://px.adhigh.net/creative_preview?c=second']);
 }
});
test('Plus fields/default-off section are separate from existing creative defaults',()=>{
 assert.deepEqual(contract.creativeFields(['preview','size'],false),['size']);
 assert.ok(preview.creativePlusFields(undefined,false).includes('preview'));
 assert.deepEqual(preview.creativePlusFields(['preview','size','preview','spend'],false),['preview','size']);
 assert.deepEqual(resolveCreativeSectionOrder(['kpi_grid'],'awareness',undefined,undefined),['kpi_grid','creative_performance']);
 assert.deepEqual(resolveCreativeSectionOrder(['kpi_grid'],'awareness',false,true),['kpi_grid','creative_performance_plus']);
 assert.deepEqual(resolveCreativeSectionOrder(['creative_performance_plus','kpi_grid'],'abbott_bi',true,true),['kpi_grid']);
 assert.deepEqual(normalizeDashboardSectionFieldOverrides({creative_performance_plus:{visible_fields:['size','preview']}}).creative_performance_plus?.visible_fields,['size','preview']);
});
test('generic wizard cannot erase or replace imported preview mapping namespace',()=>{
 const saved=[mapping];const config:Record<string,unknown>={creative_preview_links:[],show_creative_performance_plus:false};
 contract.preserveCreativeMappingNamespace(config,{creative_preview_links:saved});
 assert.equal(config.creative_preview_links,saved);assert.equal(config.show_creative_performance_plus,false);
});

test('Plus Excel enumerates all URLs and preserves weighted percent points',()=>{
 const groups=groupCreativeRows([{...row,preview_urls:[url]},{...row,platform_creative_id:'second',impressions:900,clicks:9,preview_urls:['https://example.org/second']}],['size','preview','impressions','ctr']);
 const columns=preview.creativePlusExcelColumns(['size','preview','impressions','ctr'],false);
 assert.deepEqual(columns.map(c=>c.label),['Size','Preview','Impressions','CTR %']);
 assert.deepEqual(columns.map(c=>c.value(groups[0])),['160 × 600',url+'\nhttps://example.org/second',1000,1.9]);
});

test('canonical preview fallback supports actual Hybrid HTTP only, preserving configured overrides',()=>{
 const actual='http://preview.hybrid.ai/?id=opaque';
 assert.equal(preview.safeCreativePreviewUrl(actual),actual);
 for(const bad of ['http://preview.hybrid.ai.evil.test/?id=x','http://user@preview.hybrid.ai/?id=x','http://preview.hybrid.ai:8080/?id=x','javascript:alert(1)','http://elsewhere.test/?id=x'])assert.equal(preview.safeCreativePreviewUrl(bad),null);
 const native={...row,source_key:'hybrid',platform_account_id:'native-account',platform_creative_id:'native-banner',canonical_preview_url:actual};
 assert.deepEqual(preview.selectCreativePreviewRows([native],undefined)[0]?.preview_urls,[actual]);
 const override={source_key:native.source_key,platform_account_id:native.platform_account_id,platform_creative_id:native.platform_creative_id,preview_url:url};
 assert.deepEqual(preview.selectCreativePreviewRows([native],[override])[0].preview_urls,[url]);
 assert.equal(preview.selectCreativePreviewRows([native],[{...override,preview_url:'javascript:alert(1)'}]).length,0);
 const separate=preview.selectCreativePreviewRows([native,{...native,platform_account_id:'other-account',canonical_preview_url:undefined}],[override]);
 assert.equal(separate.length,1);assert.equal(separate[0].platform_account_id,'native-account');
 assert.equal(preview.selectCreativePreviewRows([native],[override,{...override,preview_url:'https://example.org/conflict'}]).length,0);
 assert.equal(preview.selectCreativePreviewRows([{...native,canonical_preview_url:'http://evil.test'}],[]).length,0);
});
test('many native instances sharing one catalog preview retain all metrics and one grouped link',()=>{
 const actual='http://preview.hybrid.ai/?id=same';
 const rows=preview.selectCreativePreviewRows([{...row,canonical_preview_url:actual},{...row,platform_creative_id:'other',canonical_preview_url:actual,impressions:900,clicks:9}],[]);
 assert.equal(rows.length,2);
 const grouped=groupCreativeRows(rows,['size','impressions','clicks','ctr','preview']);
 assert.equal(grouped[0].impressions,1000);assert.equal(grouped[0].clicks,19);assert.equal(grouped[0].ctr,1.9);assert.deepEqual(grouped[0].preview_urls,[actual]);
});
