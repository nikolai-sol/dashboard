import assert from 'node:assert/strict';
import test from 'node:test';
import { probePdfMatrix } from './probe-abbott-pdf-matrix.mjs';

const token = () => `${Buffer.from(JSON.stringify({ type:'viewer',dashboard_id:18,audience:'manager',credential_version:1,exp:Math.floor(Date.now()/1000)+600 })).toString('base64url')}.${'a'.repeat(43)}`;

test('PDF matrix exposes only fixed request labels and closed outcomes',async()=>{
  const secretToken=token(),secretEmbed='synthetic-private-embed';
  const input=Buffer.from(`manager_access_token\n${secretToken}\n${secretEmbed}\n`);
  let calls=0;
  const rows=await probePdfMatrix(input,new AbortController().signal,async url=>{
    calls++;
    if(url.port==='3004'&&url.pathname==='/api/dashboard/abbott/pdf'&&url.searchParams.has('embed_key')){
      return new Response('{}',{status:500,headers:{'content-type':'application/json','X-Abbott-PDF-Failure-Stage':'ready'}});
    }
    return new Response('%PDF',{status:200,headers:{'content-type':'application/pdf'}});
  });
  assert.equal(calls,8);assert.equal(rows.length,8);
  assert.deepEqual(rows.at(-1),{runtime:'candidate',audience:'embed',alias:'abbott',status:500,type:'application/json',failureStage:'ready',elapsedSeconds:1});
  assert.ok(rows.slice(0,-1).every(row=>row.status===200&&row.type==='application/pdf'&&row.failureStage===null));
  assert.doesNotMatch(JSON.stringify(rows),/synthetic|access_token|embed_key|eyJ/);
  input.fill(0);
});

test('PDF matrix closes thrown fetches into a status-zero row',async()=>{
  const input=Buffer.from(`manager_access_token\n${token()}\nembed\n`);let first=true;
  const rows=await probePdfMatrix(input,new AbortController().signal,async()=>{if(first){first=false;throw Error('private URL');}return new Response('%PDF',{status:200,headers:{'content-type':'application/pdf'}});});
  assert.deepEqual(rows[0],{runtime:'control',audience:'manager',alias:'18',status:0,type:'failed',failureStage:null,elapsedSeconds:1});
  assert.doesNotMatch(JSON.stringify(rows),/private|URL/);input.fill(0);
});
