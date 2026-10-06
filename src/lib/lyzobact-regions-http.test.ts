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
