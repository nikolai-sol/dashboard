import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Table from './CreativePerformanceTable';
import type { CreativeRow } from '../lib/creative-performance-contract';
const row:CreativeRow={source_key:'getintent',platform_account_id:'a',platform_campaign_id:'c',platform_creative_id:'x',line_key:'l',channel:'Display',name:'Banner 160x600',size:'160 × 600 (parsed)',impressions:100,clicks:10,spend:4,ctr:10,cpc:0.4,postclick:null,availability:'No UTM mapping'};
test('unmapped platform row rendered without Metrica columns',()=>{const html=renderToStaticMarkup(<Table data={{rows:[row],has_mappings:false}} currency="RUB"/>);assert.match(html,/Banner 160x600/);assert.match(html,/Platform spend/);assert.doesNotMatch(html,/\(RUB\)/);assert.match(html,/currency not verified/);assert.doesNotMatch(html,/>Visits</);});
test('mapped table keeps unmapped rows nullable and print retains all pages',()=>{const html=renderToStaticMarkup(<Table data={{rows:Array.from({length:51},(_,i)=>({...row,platform_creative_id:String(i)})),has_mappings:true}}/>);assert.match(html,/>Visits</);assert.equal((html.match(/title="No UTM mapping"/g)||[]).length,51);assert.match(html,/hidden print:table-row/);assert.match(html,/—/);});
import Mapping from './admin/DashboardCreativeMappings';
test('cost visibility is preserved and mapping save is disabled before successful initial load',()=>{
 const html=renderToStaticMarkup(<Table data={{rows:[row],has_mappings:false}} showSpend={false}/>);assert.doesNotMatch(html,/Platform spend|CPC/);
 const admin=renderToStaticMarkup(<Mapping dashboardId="987"/>);assert.match(admin,/<button disabled=""[^>]*>Save mappings<\/button>/);
});
test('platform-only table contains no new UTM prompt or Metrica column',()=>{const html=renderToStaticMarkup(<Table data={{rows:[{...row,availability:'Platform creative data'}],has_mappings:false}}/>);assert.doesNotMatch(html,/UTM|Metrica|>Visits</);assert.match(html,/Banner 160x600/);});
