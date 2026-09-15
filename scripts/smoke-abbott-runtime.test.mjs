import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
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
  assert.deepEqual(m.assetInventory('<script src="/_next-abbott/_next/static/chunks/a.js"></script><link href="/_next-abbott/_next/static/css/a.css" rel="stylesheet">','http://127.0.0.1:3004'),['/_next-abbott/_next/static/chunks/a.js','/_next-abbott/_next/static/css/a.css']);
  for(const path of ['https://evil.test/a.js','//evil.test/a.js','/api/health','/_next/static/a.js','/_next-abbott/static/../private.js','/_next-abbott/static/a.js?token=synthetic','data:text/javascript,x']){
    assert.throws(()=>m.assetInventory(`<script src="${path}"></script>`,'http://127.0.0.1:3004'),/^Error: ABBOTT_SMOKE_REFUSED$/);
  }
});

test('inventory follows installed Next assetPrefix rewrite contract and local generated markup',async()=>{
  const m=await api();
  const config=(await import('../apps/abbott/next.config.js')).default;
  const {default:loadCustomRoutes}=await import('next/dist/lib/load-custom-routes.js');
  const routes=await loadCustomRoutes({...config,basePath:'',trailingSlash:false});
  assert.ok(routes.rewrites.beforeFiles.some(r=>r.source===config.assetPrefix+'/_next/:path+'&&r.destination==='/_next/:path+'));
  const html=fs.readFileSync(new URL('../apps/abbott/.next-abbott/server/app/_not-found.html',import.meta.url),'utf8');
  const inventory=m.assetInventory(html,'http://127.0.0.1:3004');
  assert.ok(inventory.length>0);assert.ok(inventory.every(p=>p.startsWith(config.assetPrefix+'/_next/static/')));
});

test('asset HTML refusal subcodes never include secret-bearing malformed input',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  const secret='synthetic-secret';
  const cases=[
    ['malformed_html',`<script src="${secret}`],
    ['malformed_html',`<script src=${secret}></script>`],
    ['no_assets',`<html>${secret}</html>`],
    ['unexpected_asset_origin',`<script src="https://invalid.test/${secret}?access_token=${secret}"></script>`],
    ['unexpected_asset_origin',`<script src="//invalid.test/${secret}"></script>`],
    ['unexpected_asset_path',`<script src="/_next/static/a.js?access_token=${secret}"></script>`],
    ['unexpected_asset_path',`<script src="/${secret}/../a.js"></script>`],
    ['body_limit',secret.repeat(2000000)],
    ['inventory_limit',Array.from({length:257},(_,i)=>`<script src="/_next/static/${secret}${i}.js"></script>`).join('')],
  ];
  for(const [reason,html]of cases){assert.throws(()=>m.assetInventory(html,'http://127.0.0.1:3001'),error=>{
    assert.equal(d.formatVerificationFailure(error),`ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=${reason}\n`);
    assert.doesNotMatch(d.formatVerificationFailure(error),/synthetic|invalid\.test|access_token/);return true;
  });}
});

test('inventory ignores favicon metadata queries but refuses script and stylesheet queries',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  for(const origin of ['http://127.0.0.1:3001','http://127.0.0.1:3004']){
    const prefix=(origin.endsWith('3004')?'/_next-abbott':'')+'/_next/static/';
    const script=`<script src="${prefix}chunks/a.js"></script>`;
    const metadata='<link rel="icon" href="/favicon.ico?synthetic-secret"><link rel="shortcut icon" href="/favicon.ico?synthetic-secret"><link rel="apple-touch-icon" href="/icon.png?synthetic-secret"><img src="/logo.png?synthetic-secret">';
    assert.deepEqual(m.assetInventory(metadata+script,origin),[prefix+'chunks/a.js']);
    for(const tag of [`<script src="${prefix}chunks/a.js?synthetic-secret"></script>`,`<link rel="stylesheet" href="${prefix}css/a.css?synthetic-secret">`,`<link rel="preload" href="${prefix}media/a.woff2?synthetic-secret">`,`<link rel="modulepreload" href="${prefix}chunks/a.js?synthetic-secret">`]){
      assert.throws(()=>m.assetInventory(script+tag,origin),error=>{assert.equal(d.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=unexpected_asset_path\n');return true;});
    }
    assert.throws(()=>m.assetInventory('<script src="/public.js"></script>',origin));
    assert.throws(()=>m.assetInventory('<link rel="stylesheet" href="/public.css">',origin));
    assert.throws(()=>m.assetInventory('<link rel="preload" href="/public.woff2">',origin));
  }
});

for(const [name,attributes]of [
  ['spaced_equals','rel = "stylesheet" href = "ASSET"'],
  ['padded_mixed_case',"HREF='ASSET' ReL=' \tStyleSheet\r\n '"],
  ['unordered_rel_tokens','rel="alternate\fpreload\tSTYLESHEET" href="ASSET"'],
])test(`exact asset parser recognizes stylesheet ${name} and refuses its unsafe URL`,async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  for(const origin of ['http://127.0.0.1:3001','http://127.0.0.1:3004']){
    const prefix=(origin.endsWith('3004')?'/_next-abbott':'')+'/_next/static/';
    const path=prefix+'css/a.css',script=`<script src="${prefix}chunks/a.js"></script>`;
    assert.deepEqual(m.assetInventory(`<LiNk ${attributes.replace('ASSET',path)}>`,origin),[path]);
    for(const [value,reason]of [[path+'?synthetic-secret','unexpected_asset_path'],['https://invalid.test/synthetic-secret.css','unexpected_asset_origin']]){
      assert.throws(()=>m.assetInventory(script+`<LiNk ${attributes.replace('ASSET',value)}>`,origin),error=>{assert.equal(d.formatVerificationFailure(error),`ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=${reason}\n`);return true;});
    }
  }
});

test('exact asset attribute names cannot be masked by data attributes or their values',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs'),origin='http://127.0.0.1:3001';
  const safe='/_next/static/chunks/a.js',script=`<script src="${safe}"></script>`;
  assert.deepEqual(m.assetInventory(script+`<script data-src="/_next/static/chunks/fake.js"></script>`,origin),[safe]);
  assert.deepEqual(m.assetInventory(`<SCRIPT data-note="src='synthetic-secret' >" SRC = '${safe}' async></SCRIPT>`,origin),[safe]);
  for(const tag of [
    `<script data-src="${safe}" src="https://invalid.test/synthetic-secret.js"></script>`,
    `<script data-src="${safe}" SRC = "/_next/static/chunks/b.js?synthetic-secret"></script>`,
    '<link data-rel="icon" rel="stylesheet" data-href="/_next/static/css/a.css" href="https://invalid.test/synthetic-secret.css">',
  ])assert.throws(()=>m.assetInventory(script+tag,origin),error=>{assert.match(d.formatVerificationFailure(error),/^ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=unexpected_asset_(origin|path)\n$/);return true;});
});

test('duplicate critical attributes and malformed relevant tags refuse without leaking values',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  const script='<script src="/_next/static/chunks/a.js"></script>';
  for(const tag of [
    '<script src="/_next/static/chunks/a.js" SRC="synthetic-secret"></script>',
    '<link rel="icon" REL="stylesheet" href="synthetic-secret">',
    '<link rel="stylesheet" href="/_next/static/css/a.css" HREF="synthetic-secret">',
    '<link rel=stylesheet href="synthetic-secret">',
    '<link rel="stylesheet" href=synthetic-secret>',
    '<script src = synthetic-secret></script>',
    '<link rel="stylesheet" href>',
    '<link rel="stylesheet">',
    '<link data-rel="stylesheet" href="synthetic-secret">',
    '<link rel="style&#115;heet" href="synthetic-secret">',
    '<link rel="icon" href=synthetic-secret>',
    '<script src="/_next/static/chunks/a.js"data-x="synthetic-secret"></script>',
    '<script src="synthetic-secret></script>',
    '<link rel="stylesheet" href="synthetic-secret"',
  ])assert.throws(()=>m.assetInventory(script+tag,'http://127.0.0.1:3001'),error=>{assert.equal(d.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=malformed_html\n');return true;});
});

test('metadata links are ignored only after exact rel tokens; critical tokens take precedence',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  const script='<script src="/_next/static/chunks/a.js"></script>';
  const icon='<LINK HREF = "/favicon.ico?synthetic-secret" REL = "  SHORTCUT\tICON  ">';
  assert.deepEqual(m.assetInventory(icon+script,'http://127.0.0.1:3001'),['/_next/static/chunks/a.js']);
  for(const rel of ['icon stylesheet','StyleSheet icon','icon\tMODULEPRELOAD','preload\nicon']){
    assert.throws(()=>m.assetInventory(script+`<link rel="${rel}" href="/_next/static/css/a.css?synthetic-secret">`,'http://127.0.0.1:3001'),error=>{assert.equal(d.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=unexpected_asset_path\n');return true;});
  }
});

test('asset tag scanning respects comments, quoted attributes, script text and exact tag names',async()=>{
  const m=await api();const origin='http://127.0.0.1:3001',path='/_next/static/chunks/a.js';
  const ignored='<!-- <link rel="stylesheet" href="https://invalid.test/synthetic-secret.css"> -->'+
    '<div data-note=\'<script src="https://invalid.test/synthetic-secret.js">\'></div>'+
    '<script>const text = \'<link rel="stylesheet" href="https://invalid.test/synthetic-secret.css">\';</script>'+
    '<script-widget data-src="https://invalid.test/synthetic-secret.js"></script-widget>';
  assert.deepEqual(m.assetInventory(ignored+`<script src="${path}"></script>`,origin),[path]);
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
  const manifest={version:1,releaseId:'6cd2f12e245a47dcbd5f6ce928c4ed83',sourceSha:'f80607fbc8a693aa2c720b0976938e88732cdf1a',assets:[{path:'/_next-abbott/_next/static/chunks/shared.js',size:asset.length,sha256:hash(asset)}]};
  const fetchImpl=async(url,options)=>{
    requests.push({url:new URL(url),options});const u=new URL(url);let body,status=200,type='application/json';
    if(u.pathname.endsWith('/abbott-admin-users')){status=u.searchParams.has('embed_key')?403:200;body=JSON.stringify(status===200?{user_ids:[]}:{error:'Forbidden'});}
    else if(u.pathname.endsWith('.js')){type='application/javascript';body=asset;}
    else if(u.pathname.endsWith('/pdf')){type='application/pdf';body=pdf();}
    else if(u.pathname.endsWith('/excel')){type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';body=await new ExcelJS.Workbook().xlsx.writeBuffer();}
    else if(u.pathname.startsWith('/dashboard/')){type='text/html';body=`<html><script src="${u.port==='3004'?'/_next-abbott':''}/_next/static/chunks/shared.js"></script></html>`;}
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

test('HTML transport and alias diagnostics are closed, with bounded body cancellation',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  for(const reason of ['http_status','content_type','body_limit','malformed_html','no_assets','alias_mismatch']){
    let cancelled=0;
    const f=fixture(r=>{if(r.u.pathname==='/dashboard/abbott'&&reason==='alias_mismatch')r.body='<script src="/_next/static/chunks/synthetic-secret.js"></script>';});
    const fetchImpl=async(url,options)=>{
      if(!url.pathname.startsWith('/dashboard/')||reason==='alias_mismatch')return f.fetchImpl(url,options);
      const body=reason==='malformed_html'?Uint8Array.of(0xff):Buffer.from('synthetic-secret');
      const headers={'cache-control':'private, no-store','content-type':reason==='content_type'?'text/synthetic-secret':'text/html','x-private':'synthetic-secret'};
      if(reason==='body_limit')headers['content-length']=String(16*1024*1024+1);
      return new Response(new ReadableStream({start(c){c.enqueue(body);},cancel(){cancelled++;}}),{status:reason==='http_status'?500:200,headers});
    };
    // Finite bodies for decode/empty-inventory checks; unread bodies stay pending
    // to prove cancellation at header-based refusals.
    const finiteFetch=async(url,options)=>['malformed_html','no_assets'].includes(reason)&&url.pathname.startsWith('/dashboard/')?new Response(reason==='malformed_html'?Uint8Array.of(0xff):'synthetic-secret',{headers:{'content-type':'text/html','cache-control':'private, no-store'}}):fetchImpl(url,options);
    const error=await m.runReadOnlySmoke({managerAccessToken:'synthetic-secret',embedKey:'synthetic-secret',manifest:f.manifest},new AbortController().signal,{fetchImpl:finiteFetch,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})}).catch(e=>e);
    assert.equal(d.formatVerificationFailure(error),`ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=${reason}\n`);
    if(['http_status','content_type','body_limit'].includes(reason))assert.equal(cancelled,1);
  }
});

test('candidate prefix normalization still compares overlapping asset hashes',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  const bytes=Buffer.from('candidate-different');const f=fixture(r=>{if(r.u.pathname.endsWith('.js')&&r.u.port==='3004')r.body=bytes;});
  Object.assign(f.manifest.assets[0],{size:bytes.length,sha256:hash(bytes)});
  const error=await m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})}).catch(e=>e);
  assert.equal(d.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=asset_compare reason=failed\n');
});

test('excluding image metadata from HTML inventory does not exclude any attested candidate public file',async()=>{
  const m=await api();const image=Buffer.from('synthetic-public-image');
  const f=fixture(r=>{if(r.u.pathname==='/logo.png'){r.body=image;r.type='image/png';}if(r.u.pathname.startsWith('/dashboard/'))r.body+='<link rel="icon" href="/favicon.ico?synthetic-secret"><img src="/logo.png">';});
  f.manifest.assets.push({path:'/logo.png',size:image.length,sha256:hash(image)});
  const result=await m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})});
  assert.equal(result.status,'passed');assert.equal(result.candidate_assets,2);
  assert.equal(f.requests.filter(r=>r.url.port==='3004'&&r.url.pathname==='/logo.png').length,1);
  assert.ok(f.requests.every(r=>r.url.pathname!=='/favicon.ico'));
});

test('smoke failures expose only exact stage enums and never response or exception content',async()=>{
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs').catch(()=>({}));assert.equal(typeof d.formatVerificationFailure,'function');
  const cases=[
    ['admin_manager',r=>{if(r.u.pathname.endsWith('/abbott-admin-users')&&!r.u.searchParams.has('embed_key'))r.status=500;}],
    ['admin_embed_denial',r=>{if(r.u.pathname.endsWith('/abbott-admin-users')&&r.u.searchParams.has('embed_key'))r.status=200;}],
    ['alias_manager_json',r=>{if(/^\/api\/dashboard\/(18|abbott)$/.test(r.u.pathname)&&!r.u.searchParams.has('embed_key'))r.body='secret-invalid-json';}],
    ['alias_embed_json',r=>{if(/^\/api\/dashboard\/(18|abbott)$/.test(r.u.pathname)&&r.u.searchParams.has('embed_key'))r.body='secret-invalid-json';}],
    ['privacy_shape',r=>{if(/^\/api\/dashboard\/(18|abbott)$/.test(r.u.pathname)&&r.u.searchParams.has('embed_key')){const body=JSON.parse(r.body);body.abbott_bi.session_journeys=null;r.body=JSON.stringify(body);}}],
    ['pdf_fetch',r=>{if(r.u.pathname.endsWith('/pdf'))r.status=500;}],
    ['asset_html',r=>{if(r.u.pathname.startsWith('/dashboard/'))r.body='<script src="https://invalid.test/?access_token=secret"></script>';}],
    ['asset_fetch',r=>{if(r.u.pathname.endsWith('.js'))r.status=500;}],
    ['asset_attestation',r=>{if(r.u.pathname.endsWith('.js')&&r.u.port==='3004')r.body='secret-modified';}],
  ];
  for(const [stage,change]of cases){
    const f=fixture(change);const error=await m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash('same')})}).catch(e=>e);
    assert.match(d.formatVerificationFailure(error),new RegExp(`^ABBOTT_VERIFICATION_REFUSED stage=${stage} reason=[a-z_]+\\n$`));assert.doesNotMatch(d.formatVerificationFailure(error),/secret|token|http|synthetic/);
  }
  const f=fixture();const error=await m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>{throw Object.assign(Error('secret'),{url:'secret',body:'secret'});}}).catch(e=>e);
  assert.equal(d.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=pdf_parse reason=failed\n');
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
  const m=await api(),d=await import('./abbott-verification-diagnostics.mjs');
  for(const kind of ['pdf','period','manager','unattested','type','empty']){
    let calls=0;const f=fixture(r=>{
      if(kind==='period'&&r.u.pathname==='/api/dashboard/abbott')r.body=String(r.body).replaceAll('2026-09-13','2026-09-12');
      if(kind==='manager'&&r.u.pathname.endsWith('/abbott-admin-users')&&!r.u.searchParams.has('embed_key'))r.status=403;
      if(kind==='unattested'&&r.u.port==='3004'&&r.u.pathname.startsWith('/dashboard/'))r.body='<script src="/_next-abbott/_next/static/chunks/new.js"></script>';
      if(kind==='type'&&r.u.pathname.endsWith('.js'))r.type='text/html';
      if(kind==='empty'&&r.u.pathname.startsWith('/dashboard/'))r.body='<html>login</html>';
    });
    await assert.rejects(m.runReadOnlySmoke({managerAccessToken:'synthetic-token',embedKey:'synthetic-embed',manifest:f.manifest},new AbortController().signal,{fetchImpl:f.fetchImpl,parsePdf:async()=>({pages:1,dimensions:[[612,792]],text_sha256:hash(kind==='pdf'?String(calls++):'same')})}),error=>{
      const stage={pdf:'pdf_compare',period:'alias_manager_json',manager:'admin_manager',unattested:'asset_attestation',type:'asset_fetch',empty:'asset_html'}[kind];
      assert.match(d.formatVerificationFailure(error),new RegExp(`^ABBOTT_VERIFICATION_REFUSED stage=${stage} reason=[a-z_]+\\n$`));return /^Error: ABBOTT_SMOKE_REFUSED$/.test(String(error));
    });
  }
});
