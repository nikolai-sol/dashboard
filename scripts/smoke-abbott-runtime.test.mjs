import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
const api = async () => { try { return await import('./smoke-abbott-runtime.mjs'); } catch(e) { if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e; } };
const hash = x => createHash('sha256').update(x).digest('hex');

test('recursive embed scan rejects identifier variants and private collections without leaking contents',async()=>{
  const m=await api();assert.equal(typeof m.scanEmbedPrivacy,'function');
  m.scanEmbedPrivacy({abbott_bi:{sessions:10,has_user_id:true,session_journeys:{rows:[]},return_frequency:{groups:[]}}});
  for(const value of [{deep:[{userId:'synthetic-private'}]},{raw_user_ids_json:'synthetic-private'},{session_journeys:{rows:[{}]}},{users_summary:[{}]},{client_id_hash:'synthetic-private'},{return_frequency:{user_directions:[{}]}},{admin_user_filter:{}}]){
    assert.throws(()=>m.scanEmbedPrivacy(value),/^Error: ABBOTT_SMOKE_REFUSED$/);
  }
});

for(const [shape,value]of Object.entries({null:null,array:[],array_objects:[{}],missing_rows:{},null_rows:{rows:null},object_rows:{rows:{}},string_rows:{rows:'synthetic-private'},nonempty_rows:{rows:[{}]},string:'malformed',number:1})){
  test(`every recursive session_journeys occurrence refuses ${shape}`,async()=>{
    const m=await api();
    for(const field of ['session_journeys','sessionJourneys']){
      assert.throws(()=>m.scanEmbedPrivacy({abbott_bi:{session_journeys:{rows:[]},nested:[{[field]:value}]}}),/^Error: ABBOTT_SMOKE_REFUSED$/);
    }
  });
}

test('recursive journey objects accept empty rows and do not accept inherited rows',async()=>{
  const m=await api();
  m.scanEmbedPrivacy({abbott_bi:{session_journeys:{available:true,rows:[]},nested:[{sessionJourneys:{rows:[]}}]}});
  assert.throws(()=>m.scanEmbedPrivacy({session_journeys:Object.create({rows:[]})}),/^Error: ABBOTT_SMOKE_REFUSED$/);
});

test('asset inventory rejects redirects, foreign origins, dynamic and traversal paths',async()=>{
  const m=await api();assert.equal(typeof m.assetInventory,'function');
  assert.deepEqual(m.assetInventory('<script src="/_next-abbott/static/chunks/a.js"></script><link href="/_next-abbott/static/css/a.css" rel="stylesheet">','http://127.0.0.1:3004'),['/_next-abbott/static/chunks/a.js','/_next-abbott/static/css/a.css']);
  for(const path of ['https://evil.test/a.js','//evil.test/a.js','/api/health','/_next/static/a.js','/_next-abbott/static/../private.js','/_next-abbott/static/a.js?token=synthetic','data:text/javascript,x']){
    assert.throws(()=>m.assetInventory(`<script src="${path}"></script>`,'http://127.0.0.1:3004'),/^Error: ABBOTT_SMOKE_REFUSED$/);
  }
});

function pdf(text='Synthetic Abbott') {
  const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream=`BT /F1 12 Tf 30 750 Td (${text}) Tj ET`;bodies.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let out='%PDF-1.4\n';const offsets=[0];for(let i=0;i<bodies.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${bodies[i]}\nendobj\n`;}
  const start=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(out);
}
test('PDF parser consumes pipes and returns only valid pages, dimensions and normalized text hash',async()=>{
  const m=await api();assert.equal(typeof m.summarizePdf,'function');
  const bytes=pdf();const result=await m.summarizePdf(bytes,new AbortController().signal);
  assert.deepEqual(result,{pages:1,dimensions:[[612,792]],text_sha256:hash('Synthetic Abbott')});
  await assert.rejects(m.summarizePdf(Buffer.from('%PDF-1.4\ninvalid'),new AbortController().signal),/^Error: ABBOTT_SMOKE_REFUSED$/);
  const controller=new AbortController();controller.abort();await assert.rejects(m.summarizePdf(bytes,controller.signal),/^Error: ABBOTT_SMOKE_REFUSED$/);bytes.fill(0);
});

function fixture(change=()=>{}) {
  const requests=[],bodies=[];const asset=Buffer.from('synthetic-static');
  const manifest={version:1,releaseId:'6cd2f12e245a47dcbd5f6ce928c4ed83',sourceSha:'f80607fbc8a693aa2c720b0976938e88732cdf1a',assets:[{path:'/_next-abbott/static/chunks/shared.js',size:asset.length,sha256:hash(asset)}]};
  const fetchImpl=async(url,options)=>{
    requests.push({url:new URL(url),options});const u=new URL(url);let body,status=200,type='application/json';
    if(u.pathname.endsWith('/abbott-admin-users')){status=u.searchParams.has('embed_key')?403:200;body=JSON.stringify(status===200?{user_ids:[]}:{error:'Forbidden'});}
    else if(u.pathname.endsWith('.js')){type='application/javascript';body=asset;}
    else if(u.pathname.endsWith('/pdf')){type='application/pdf';body=pdf();}
    else if(u.pathname.endsWith('/excel')){type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';body=await new ExcelJS.Workbook().xlsx.writeBuffer();}
    else if(u.pathname.startsWith('/dashboard/')){type='text/html';body=`<html><script src="/${u.port==='3004'?'_next-abbott':'_next'}/static/chunks/shared.js"></script></html>`;}
    else {
      const data={...Object.fromEntries(['counters','traffic_summary','page_stats','bitrix_pages','external_events','external_clicks','returning','general_materials'].map(x=>[x,[]])),data_quality:{},time_buckets:{overall:[],materials:[],by_page:[]},session_journeys:{rows:[]},return_frequency:{available:false,period_local:true,identified_visitors:0,unidentified_visits:0,groups:[],user_directions:[],return_pages:[]}};
      if(!u.searchParams.has('embed_key'))Object.assign(data,{users_summary:[],users_summary_without_admins:[],user_actions:[],admin_user_filter:{}});
      // Match loadAbbottDashboardDataWithDependencies().data: dashboard_id is
      // internal loader metadata, not a field in the serialized API dashboard.
      body=JSON.stringify({
        dashboard:{client_name:'Abbott fixture',dashboard_name:'Abbott fixture dashboard',logo_url:null,type:'abbott_bi',period:{from:'2026-09-01',to:'2026-09-13'},currency:'RUB',language:'ru',show_spend:false,filter_scope:'platform',section_order:[],multibrand:null},
        ai_summary_enabled:false,kpi_config:[],visible_metrics:[],
        kpi:Object.fromEntries(['total_impressions','total_clicks','total_spend','total_conversions','avg_ctr','avg_cpm','prev_impressions','prev_clicks','prev_spend','prev_conversions','prev_ctr','prev_cpm'].map(key=>[key,0])),
        platforms:[],timeseries:[],plan_vs_fact:[],abbott_bi:data,
      });
    }
    const record={u,options,body,status,type};change(record);const bytes=Buffer.from(record.body);bodies.push(bytes);
    return new Response(bytes,{status:record.status,headers:{'content-type':record.type,'cache-control':'private, no-store'}});
  };
  return {requests,bodies,manifest,fetchImpl};
}
test('real API shape without dashboard.id passes exact aliases, audiences, exports and attested assets',async()=>{
  const m=await api();assert.equal(typeof m.runReadOnlySmoke,'function');const f=fixture();
  const result=await m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})});
  assert.equal(result.status,'passed');assert.equal(result.aliases,2);assert.equal(result.audiences,2);
  assert.equal(f.requests.filter(x=>x.url.pathname.endsWith('/pdf')).length,8);
  assert.equal(f.requests.filter(x=>x.url.pathname.endsWith('/excel')).length,8);
  for(const {url,options}of f.requests){assert.ok(['http://127.0.0.1:3001','http://127.0.0.1:3004'].includes(url.origin));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(!url.href.includes('synthetic-token'));if(!url.pathname.includes('/static/')){assert.equal(url.searchParams.get('from'),'2026-09-01');assert.equal(url.searchParams.get('to'),'2026-09-13');}}
  assert.ok(!JSON.stringify(result).includes('synthetic'));
});
test('wrong aliases/period/privacy/PDF/assets/status/types and redirects fail with fixed diagnostics',async()=>{
  const m=await api();assert.equal(typeof m.runReadOnlySmoke,'function');
  for(const mutate of [
    r=>{if(r.u.pathname==='/api/dashboard/abbott'){const body=JSON.parse(r.body);body.dashboard.type='zaruku_bi';r.body=JSON.stringify(body);}},
    r=>{if(r.u.pathname==='/api/dashboard/18'&&r.u.searchParams.has('embed_key')){const body=JSON.parse(r.body);body.abbott_bi.nested={visit_id:'private'};r.body=JSON.stringify(body);}},
    r=>{if(r.u.pathname.endsWith('/abbott-admin-users')&&r.u.searchParams.has('embed_key'))r.status=200;},
    r=>{if(r.u.pathname.endsWith('/pdf'))r.type='text/html';},
    r=>{if(r.u.pathname.endsWith('.js')&&r.u.port==='3004')r.body='changed';},
    r=>{if(r.u.pathname.startsWith('/dashboard/'))r.body='<script src="/_next-abbott/static/chunks/unattested.js"></script>';},
    r=>{r.status=302;},r=>{r.status=500;},
  ]){const f=fixture(mutate);await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})}),/^Error: ABBOTT_SMOKE_REFUSED$/);}
});

test('Abbott schema remains mandatory even when both runtimes return the same malformed payload',async()=>{
  const m=await api();
  for(const mutate of [data=>{data.dashboard.type='zaruku_bi';},data=>{delete data.abbott_bi;},data=>{delete data.abbott_bi.traffic_summary;},data=>{data.abbott_bi.time_buckets.overall=null;}]){
    const f=fixture(r=>{if(/^\/api\/dashboard\/(?:18|abbott)$/.test(r.u.pathname)){const data=JSON.parse(r.body);mutate(data);r.body=JSON.stringify(data);}});
    await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl}),/^Error: ABBOTT_SMOKE_REFUSED$/);
  }
});
test('abort cancels pending GETs and parser failures cannot leak raw diagnostics',async()=>{
  const m=await api();assert.equal(typeof m.runReadOnlySmoke,'function');const f=fixture();const controller=new AbortController();let aborted=false;
  const fetchImpl=async(url,options)=>{await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('secret-url'));},{once:true});setImmediate(()=>controller.abort());});};
  await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},controller.signal,{fetchImpl}),/^Error: ABBOTT_SMOKE_REFUSED$/);assert.equal(aborted,true);
  await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>{throw Error('private PDF text');}}),/^Error: ABBOTT_SMOKE_REFUSED$/);
});

test('failed response headers cancel the unread body before returning refusal',async()=>{
  const m=await api(),f=fixture();let cancelled=0;
  const fetchImpl=async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{status:500});
  await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl}),/^Error: ABBOTT_SMOKE_REFUSED$/);
  assert.equal(cancelled,1);
});

test('semantic PDF differences, period drift, manager denial and unapproved inventory fail',async()=>{
  const m=await api();
  for(const kind of ['pdf','period','manager','unattested','type','empty']){
    let calls=0;const f=fixture(r=>{
      if(kind==='period'&&r.u.pathname==='/api/dashboard/abbott')r.body=String(r.body).replaceAll('2026-09-13','2026-09-12');
      if(kind==='manager'&&r.u.pathname.endsWith('/abbott-admin-users')&&!r.u.searchParams.has('embed_key'))r.status=403;
      if(kind==='unattested'&&r.u.port==='3004'&&r.u.pathname.startsWith('/dashboard/'))r.body='<script src="/_next-abbott/static/chunks/new.js"></script>';
      if(kind==='type'&&r.u.pathname.endsWith('.js'))r.type='text/html';
      if(kind==='empty'&&r.u.pathname.startsWith('/dashboard/'))r.body='<html>login</html>';
    });
    await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash(kind==='pdf'?String(calls++):'same')})}),/^Error: ABBOTT_SMOKE_REFUSED$/);
  }
});
