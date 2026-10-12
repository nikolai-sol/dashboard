import assert from 'node:assert/strict';
import test from 'node:test';
import {buildRegionalWeather, validateWeatherSample, type WeatherCentre, type WeatherFact} from './lyzobact-weather';
const centre:WeatherCentre={regionKey:'Test',centreId:'1',centreName:'Test city',latitude:55.75,longitude:37.62,timeZone:'Europe/Moscow',sourceUrl:'https://www.geonames.org/1/'};
const sample=(date:string,temp=11.99):WeatherFact=>({centre_id:'1',local_date:date,status:'valid',temperature_c:temp,observed_at:date+'T05:30:00Z',retrieved_at:date+'T06:02:00Z'});
const seven=()=>Array.from({length:7},(_,i)=>sample('2026-10-'+String(12-i).padStart(2,'0')));
test('seven actual consecutive mornings below 12 are required and unrounded values decide',()=>{
 const facts=seven();assert.equal(buildRegionalWeather([centre],facts,new Date('2026-10-12T07:00:00Z')).regions[0].status,'active');
 facts[0]=sample('2026-10-12',12);const row=buildRegionalWeather([centre],facts,new Date('2026-10-12T07:00:00Z')).regions[0];assert.equal(row.status,'not_met');assert.equal(row.consecutiveColdMornings,0);
 facts[0]=sample('2026-10-12',11.999);assert.equal(buildRegionalWeather([centre],facts,new Date('2026-10-12T07:00:00Z')).regions[0].status,'active');
});
test('missing middle date breaks proof; missing latest temperature is null',()=>{
 const facts=seven().filter(f=>f.local_date!=='2026-10-09');const r=buildRegionalWeather([centre],facts,new Date('2026-10-12T07:00:00Z')).regions[0];assert.equal(r.status,'insufficient_data');assert.equal(r.consecutiveColdMornings,3);assert.equal(r.days.find(d=>d.date==='2026-10-09')?.temperatureC,null);
 const absent=buildRegionalWeather([centre],seven().slice(1),new Date('2026-10-12T07:00:00Z')).regions[0];assert.equal(absent.temperatureC,null);assert.equal(absent.status,'insufficient_data');
});
test('before local morning and during grace yesterday stays latest due unless today is sampled',()=>{
 for(const time of ['05:59:00','06:00:00','06:14:59'])assert.equal(buildRegionalWeather([centre],[],new Date('2026-10-12T'+time+'Z')).regions[0].dueDate,'2026-10-11');
 assert.equal(buildRegionalWeather([centre],[],new Date('2026-10-12T06:15:00Z')).regions[0].dueDate,'2026-10-12');
 assert.equal(buildRegionalWeather([centre],[sample('2026-10-12')],new Date('2026-10-12T06:03:00Z')).regions[0].dueDate,'2026-10-12');
});
test('provider freshness, future timestamp, correct local date and morning window are validated',()=>{
 assert(validateWeatherSample(sample('2026-10-12'),centre));
 for(const f of [{...sample('2026-10-12'),observed_at:'2026-10-12T02:00:00Z'},{...sample('2026-10-12'),observed_at:'2026-10-12T06:08:00Z'},{...sample('2026-10-12'),temperature_c:NaN},{...sample('2026-10-12'),retrieved_at:'2026-10-12T10:00:00Z'},{...sample('2026-10-12'),local_date:'2026-10-11'}])assert.equal(validateWeatherSample(f,centre),false);
});
test('shared centres reuse facts without changing region identity or inputs',()=>{
 const facts=seven(),before=JSON.stringify(facts);const rows=buildRegionalWeather([centre,{...centre,regionKey:'Second'}],facts,new Date('2026-10-12T07:00:00Z')).regions;
 assert.deepEqual(rows.map(r=>r.regionKey),['Test','Second']);assert(rows.every(r=>r.status==='active'));assert.equal(JSON.stringify(facts),before);
});

import centres from './lyzobact-weather-centres.json';
import {REGIONAL_CANONICAL_KEYS} from './lyzobact-regions-import';
import {loadRegionalWeather} from './lyzobact-weather-store';
test('catalogue covers exact regional register and consistent 84 unique centres',()=>{
 assert.deepEqual(centres.map(c=>c.regionKey).sort(),[...REGIONAL_CANONICAL_KEYS].sort());assert.equal(new Set(centres.map(c=>c.centreId)).size,84);
 const seen=new Map<string,string>();for(const c of centres){assert(Number.isFinite(c.latitude)&&Math.abs(c.latitude)<=90);assert(Number.isFinite(c.longitude)&&Math.abs(c.longitude)<=180);new Intl.DateTimeFormat('en',{timeZone:c.timeZone}).format();const identity=JSON.stringify([c.latitude,c.longitude,c.timeZone]);if(seen.has(c.centreId))assert.equal(identity,seen.get(c.centreId));seen.set(c.centreId,identity);}
});
test('weather reader isolates missing schema and reads only canonical facts',async()=>{
 const result=await loadRegionalWeather(async(sql)=>{assert.match(sql,/canonical_fact_lyzobact_weather_daily/);assert.doesNotMatch(sql,/snapshot/);throw Error('private SQL detail');},new Date('2026-10-12T07:00:00Z'));
 assert.equal(result.status,'unavailable');assert.equal(result.regions.length,0);assert.doesNotMatch(JSON.stringify(result),/private/);
 const empty=await loadRegionalWeather(async()=>[],new Date('2026-10-12T07:00:00Z'));assert.equal(empty.regions.length,85);assert(empty.regions.every(r=>r.status==='insufficient_data'&&r.temperatureC===null));
});
test('six mornings are insufficient, zero is valid, UTC+12 uses local calendar days',()=>{
 const now=new Date('2026-10-12T07:00:00Z');assert.equal(buildRegionalWeather([centre],seven().slice(0,6),now).regions[0].status,'insufficient_data');
 assert.equal(buildRegionalWeather([centre],seven().map(f=>({...f,temperature_c:0})),now).regions[0].status,'active');
 const east={...centre,timeZone:'Asia/Anadyr'};
 const f:WeatherFact={...sample('2026-10-12'),observed_at:'2026-10-11T20:30:00Z',retrieved_at:'2026-10-11T21:02:00Z'};
 assert(validateWeatherSample(f,east));assert.equal(buildRegionalWeather([east],[f],new Date('2026-10-11T21:03:00Z')).regions[0].dueDate,'2026-10-12');
 assert.equal(buildRegionalWeather([east],[],new Date('2026-10-11T20:59:00Z')).regions[0].dueDate,'2026-10-11');
});
