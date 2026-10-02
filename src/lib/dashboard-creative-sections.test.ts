import test from 'node:test';
import assert from 'node:assert/strict';
import * as presets from './dashboard-presets';

test('legacy Media sections keep other hidden blocks hidden and append creative by default',()=>{
 assert.equal(typeof presets.resolveCreativeSectionOrder,'function');
 for(const type of ['awareness','performance','overview','multibrand'] as const) {
  const order=presets.resolveCreativeSectionOrder(['kpi_grid'],type,undefined);
  assert.deepEqual(order,['kpi_grid','creative_performance']);
 }
});
test('saved explicit disable survives reload; enabled custom order survives spend toggles',()=>{
 assert.equal(typeof presets.resolveCreativeSectionOrder,'function');
 const stored=JSON.parse(JSON.stringify({section_order:['creative_performance','kpi_grid'],show_creative_performance:false}));
 assert.deepEqual(presets.resolveCreativeSectionOrder(stored.section_order,'awareness',stored.show_creative_performance),['kpi_grid']);
 for(const spend of [true,false]) {
  const order=presets.sanitizeSectionOrder(stored.section_order,'awareness',spend,false);
  assert.deepEqual(presets.resolveCreativeSectionOrder(order,'awareness',true),stored.section_order);
 }
});
test('isolated dashboard kinds cannot enable the creative section',()=>{
 assert.equal(typeof presets.resolveCreativeSectionOrder,'function');
 for(const type of ['abbott_bi','zaruku_bi'] as const) assert.deepEqual(presets.resolveCreativeSectionOrder(['creative_performance','kpi_grid'],type,true),['kpi_grid']);
});
