import test from 'node:test';
import assert from 'node:assert/strict';
import { GET,PUT } from '../app/api/admin/dashboards/[id]/creative-mappings/route';
import {createViewerSession,ADMIN_SESSION_COOKIE} from './access-auth';
test('mapping read and write reject missing auth and viewer sessions before database access',async()=>{
 for(const method of [GET,PUT])for(const cookie of ['',`${ADMIN_SESSION_COOKIE}=${createViewerSession(987,'viewer@example.test','manager')}`]){
  const response=await method(new Request('http://localhost/api/admin/dashboards/987/creative-mappings',{headers:{cookie}}),{params:{id:'987'}});assert.equal(response.status,401);
 }
});
import pool from './db';
import {createAdminSession} from './access-auth';
test('authenticated narrow save locks and preserves unrelated config and releases its single connection',async()=>{
 const original=pool.getConnection;let stored:Record<string,unknown>|null=null;const calls:string[]=[];
 const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql:string,args?:unknown[])=>{calls.push(sql);if(sql.startsWith('SELECT config'))return[[{dashboard_type:'awareness',config:{period_from:'2026-09-01',period_to:'2026-09-30',custom_setting:{preserve:true},creative_utm_bindings:[{old:true}]}}]];if(sql.startsWith('UPDATE dashboards')){stored=JSON.parse(String(args?.[0]));return[{}];}return[[]];}};
 pool.getConnection=(async()=>conn) as unknown as typeof pool.getConnection;
 try{const response=await PUT(new Request('http://localhost/api/admin/dashboards/987/creative-mappings',{method:'PUT',headers:{cookie:`${ADMIN_SESSION_COOKIE}=${createAdminSession('admin@example.test')}`},body:JSON.stringify({mappings:[]})}),{params:{id:'987'}});assert.equal(response.status,200);assert.deepEqual(stored?.['custom_setting'],{preserve:true});assert.deepEqual(stored?.['creative_utm_bindings'],[]);assert.ok(calls.some(c=>c.endsWith('FOR UPDATE')));assert.ok(calls.includes('commit'));assert.equal(calls.at(-1),'release');}finally{pool.getConnection=original;}
});
