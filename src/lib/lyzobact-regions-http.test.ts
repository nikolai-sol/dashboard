import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegionalGetHandler } from './lyzobact-regions-http';
const context = {id: 7, client_id:'lisobact', client_name:'Лизобакт', dashboard_name:'Лизобакт', auth_mode:'password_only'};
function fixture(access: unknown={authorized:true,audience:'manager',context}) {
 let reads=0; let enabled=true;
 const handler=createRegionalGetHandler({authorize:async()=>access as never,enabled:async()=>enabled,load:async()=>{reads++;return {rows:[]};}});
 return {handler,reads:()=>reads,disable:()=>{enabled=false;}};
}
const params={params:{id:'lisobact'}};
test('unauthorized regions cannot read the module',async()=>{const f=fixture({authorized:false,context});const r=await f.handler(new Request('https://test/api'),params);assert.equal(r.status,401);assert.equal(f.reads(),0);assert.equal(r.headers.get('Cache-Control'),'private, no-store');});
test('unknown dashboard and disabled module return 404 without data',async()=>{for(const f of [fixture({authorized:false,context:null}),fixture()]){f.disable();assert.equal((await f.handler(new Request('https://test/api'),params)).status,404);assert.equal(f.reads(),0);}});
test('a snapshot identifier cannot carry arbitrary input',async()=>{const f=fixture();assert.equal((await f.handler(new Request('https://test/api?snapshot=../../secret'),params)).status,400);assert.equal(f.reads(),0);});
test('availability checks never load facts',async()=>{const f=fixture();const r=await f.handler(new Request('https://test/api?availability=1'),params);assert.deepEqual(await r.json(),{enabled:true});assert.equal(f.reads(),0);});
test('authorized enabled module returns data and private cache policy',async()=>{const f=fixture();const r=await f.handler(new Request('https://test/api'),params);assert.equal(r.status,200);assert.equal(f.reads(),1);assert.equal(r.headers.get('Cache-Control'),'private, no-store');});
test('database failures are unavailable, never empty success or leaked details',async()=>{const h=createRegionalGetHandler({authorize:async()=>({authorized:true,audience:'manager',context}),enabled:async()=>true,load:async()=>{throw Error('private db details');}});const r=await h(new Request('https://test/api'),params);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private db details/);});
test('a public dashboard is rejected even when generic authorization succeeds',async()=>{const f=fixture({authorized:true,context:{...context,auth_mode:'public'}});assert.equal((await f.handler(new Request('https://test/api'),params)).status,403);assert.equal(f.reads(),0);});
test('embed audience cannot read manager-only regional sources',async()=>{const f=fixture({authorized:true,audience:'embed',context});assert.equal((await f.handler(new Request('https://test/api'),params)).status,403);assert.equal(f.reads(),0);});
test('disabled public dashboards stay absent',async()=>{const f=fixture({authorized:true,context:{...context,auth_mode:'public'}});f.disable();assert.equal((await f.handler(new Request('https://test/api'),params)).status,404);assert.equal(f.reads(),0);});

test('public opt-in serves only the intended dashboard and strips internal fields without changing manager data',async()=>{
 const payload={dashboardId:49,status:'ready',snapshots:[{id:'audit',label:'Audit',checkedAt:'2026-10-09',secret:'hidden'}],selectedSnapshotId:'audit',rows:[{regionKey:'Test',name:'Test',cases:0,wordstat:{version:1,status:'complete',priorPeriod:'2026-09-21/2026-09-27',currentPeriod:'2026-09-28/2026-10-04',providerRegionId:1,providerGeography:'Test',mappingStatus:'exact_or_spelling_alias',geographyNote:'',limitation:'',baskets:[{key:'flu',phrase:'(грипп|орви)',priorCount:0,currentCount:4,wowPct:null,zeroBaseline:true,daysReceived:14,httpStatus:200,retrievedAt:'2026-10-08',rawSha256:'a'.repeat(64),secret:'hidden'}],secret:'hidden'},secret:'hidden'}],sourcePages:[{id:1,regionKey:'Test',url:'https://example.org/report',period:'W40',data:'4 cases',evidenceRef:'/private/secret',remoteArchive:true,httpStatus:200,sourceHttpStatusRaw:'internal',rawSha256:'a'.repeat(64),secret:'hidden'}],errorCode:'internal',secret:'hidden'};
 const original=structuredClone(payload);
 const pub={...context,id:49,client_id:'lyzobact',auth_mode:'public'};
 const deps={authorize:async()=>({authorized:true,audience:'manager',context:pub}),enabled:async()=>true,publicRead:async()=>true,load:async()=>payload};
 const r=await createRegionalGetHandler(deps)(new Request('https://test/api'),{params:{id:'lyzobact'}});
 assert.equal(r.status,200);const body=await r.json();assert.equal(body.rows[0].cases,0);assert.equal(body.rows[0].wordstat.baskets[0].wowPct,null);assert.equal(body.sourcePages[0].url,'https://example.org/report');assert.equal(body.sourcePages[0].rawSha256,'a'.repeat(64));assert.doesNotMatch(JSON.stringify(body),/hidden|private\/secret|evidenceRef|errorCode|remoteArchive|sourceHttpStatusRaw/);assert.equal(body.sourcePages[0].httpStatus,undefined);assert.deepEqual(payload,original);
 const manager=await createRegionalGetHandler({...deps,authorize:async()=>({authorized:true,audience:'manager',context})})(new Request('https://test/api'),params);assert.deepEqual(await manager.json(),payload);
});
test('public opt-in cannot authorize another id, client, slug, disabled module or absent flag',async()=>{
 for(const [id,client,slug,enabled,flag,status] of [[48,'lyzobact','lyzobact',true,true,403],[49,'lisobact','lyzobact',true,true,403],[49,'lyzobact','other',true,true,403],[49,'lyzobact','lyzobact',false,true,404],[49,'lyzobact','lyzobact',true,false,403]] as const){
  let reads=0;const h=createRegionalGetHandler({authorize:async()=>({authorized:true,audience:'manager',context:{...context,id,client_id:client,auth_mode:'public'}}),enabled:async()=>enabled,publicRead:async()=>flag,load:async()=>{reads++;return {rows:[]};}});
  assert.equal((await h(new Request('https://test/api'),{params:{id:slug}})).status,status);assert.equal(reads,0);
 }
});

test('public weather is a dated allowlist independent of selected audit',async()=>{
 const payload={dashboardId:49,status:'ready',snapshots:[],selectedSnapshotId:'old-audit',rows:[],sourcePages:[],weather:{status:'ready',provider:'OpenWeather',checkedAt:'2026-10-12T08:00:00Z',secret:'private-key',regions:[{regionKey:'Test',centreName:'City',timeZone:'Europe/Moscow',dueDate:'2026-10-12',temperatureC:11.99,observedAt:'2026-10-12T05:00:00Z',retrievedAt:'2026-10-12T06:00:00Z',status:'active',consecutiveColdMornings:7,secret:'private-key',days:[{date:'2026-10-12',temperatureC:11.99,secret:'private-key'}]}]}};
 const h=createRegionalGetHandler({authorize:async()=>({authorized:true,context:{...context,id:49,client_id:'lyzobact',auth_mode:'public'}}),enabled:async()=>true,publicRead:async()=>true,load:async()=>payload});
 const r=await h(new Request('https://test/api'),{params:{id:'lyzobact'}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.weather.regions[0].dueDate,'2026-10-12');assert.equal(body.selectedSnapshotId,'old-audit');assert.doesNotMatch(JSON.stringify(body),/private-key|secret/);
});
