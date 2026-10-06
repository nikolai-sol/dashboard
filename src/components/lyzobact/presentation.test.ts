import assert from 'node:assert/strict';
import test from 'node:test';
import { signalState, campaignState, moduleHref } from './presentation';
test('missing and historical changes stay unknown; zero remains stable',()=>{
 assert.equal(signalState({reportedWowPct:null,calculatedWowPct:null,isHistorical:false}),'unknown');
 assert.equal(signalState({reportedWowPct:15,calculatedWowPct:null,isHistorical:true}),'unknown');
 assert.equal(signalState({reportedWowPct:0,calculatedWowPct:null,isHistorical:false}),'stable');
 assert.equal(signalState({reportedWowPct:-2,calculatedWowPct:null,isHistorical:false}),'decline');
 assert.equal(signalState({reportedWowPct:null,calculatedWowPct:3,isHistorical:false}),'growth');
});
test('campaign state does not inherit epidemic growth',()=>{assert.equal(campaignState('unknown'),'unknown');assert.equal(campaignState('active'),'active');assert.equal(campaignState(null),'unknown');});
test('navigation preserves only accepted viewer credentials',()=>{assert.equal(moduleHref('lisobact',new URLSearchParams('access_token=test&snapshot=x&evil=https://evil')),'/dashboard/lisobact/regions?access_token=test');});
import { isRegionalNavigationCandidate } from './presentation';
test('existing unrelated and numeric dashboard routes do not make new module probes',()=>{assert.equal(isRegionalNavigationCandidate('abbott'),false);assert.equal(isRegionalNavigationCandidate('zaruku'),false);assert.equal(isRegionalNavigationCandidate('19'),false);assert.equal(isRegionalNavigationCandidate('lyzobact'),true);});
