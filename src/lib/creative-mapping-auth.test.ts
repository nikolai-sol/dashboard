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
test('new mapping API is inactive for authenticated admins before database access',async()=>{
 const original=pool.getConnection;let accessed=false;
 pool.getConnection=(async()=>{accessed=true;throw Error('Database access is not allowed for the deferred feature');}) as typeof pool.getConnection;
 try{for(const method of [GET,PUT]){const response=await method(new Request('http://localhost/api/admin/dashboards/987/creative-mappings',{method:method===PUT?'PUT':'GET',headers:{cookie:`${ADMIN_SESSION_COOKIE}=${createAdminSession('admin@example.test')}`}}),{params:{id:'987'}});assert.equal(response.status,404);}assert.equal(accessed,false);}finally{pool.getConnection=original;}
});
import MappingPage from '../app/admin/dashboards/[id]/creative-mappings/page';
test('new mapping page is inactive',async()=>{await assert.rejects(()=>MappingPage({params:Promise.resolve({id:'987'})}),error=>Boolean(error&&typeof error==='object'&&'digest' in error&&String(error.digest).includes('404')));});
