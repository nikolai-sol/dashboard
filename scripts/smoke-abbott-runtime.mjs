import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildAuthorizedRequest, summarizeAbbottPayload, summarizeWorkbook } from './compare-abbott-runtime.mjs';
import { captureBoundedChild } from './verify-abbott-shadow.mjs';

const fail = () => { throw new Error('ABBOTT_SMOKE_REFUSED'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const ORIGINS = ['http://127.0.0.1:3001','http://127.0.0.1:3004'];
const RELEASE = '6cd2f12e245a47dcbd5f6ce928c4ed83';
const SOURCE = 'f80607fbc8a693aa2c720b0976938e88732cdf1a';
const active = signal => { if(signal?.aborted)fail(); };

export function scanEmbedPrivacy(value) {
  let count=0;
  function visit(node,depth=0,parent='') {
    if(++count>1000000||depth>64)fail();
    if(Array.isArray(node)){for(const item of node)visit(item,depth+1,parent);return;}
    if(typeof node==='string'&&/(?:access_token|embed_key|access_code)=/i.test(node))fail();
    if(!node||typeof node!=='object')return;
    for(const [key,nested]of Object.entries(node)){
      const name=key.replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
      if(['user_actions','users_summary','users_summary_without_admins','admin_user_filter','raw_user_ids_json','raw_user_ids','start_url','end_url','access_token','embed_key','cookie'].includes(name))fail();
      if(!/^(?:has|is|sessions|users|visits)_/.test(name)&&/(?:^|_)(?:user|session|visit|client)_(?:id|identifier|hash)(?:s|_hash)?$/.test(name))fail();
      if(name==='session_journeys'&&(!nested||typeof nested!=='object'||Array.isArray(nested)||!Object.hasOwn(nested,'rows')||!Array.isArray(nested.rows)||nested.rows.length!==0))fail();
      if(parent==='return_frequency'&&['groups','user_directions','return_pages'].includes(name)&&(!Array.isArray(nested)||nested.length))fail();
      visit(nested,depth+1,name);
    }
  }
  visit(value);
}

function safeAssetPath(value,origin) {
  if(!ORIGINS.includes(origin)||typeof value!=='string'||value.length>512||!value.startsWith('/')||value.startsWith('//')||/[\\%?#\s<>"'&]/.test(value)||value.split('/').some(x=>x==='.'||x==='..'))fail();
  const prefix=origin===ORIGINS[1]?'/_next-abbott/static/':'/_next/static/';
  if(value.startsWith('/_next')&&!value.startsWith(prefix))fail();
  if(!value.startsWith(prefix)&&!/^\/[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|ico|woff2?)$/.test(value))fail();
  if(!/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/.test(value))fail();
  return value;
}

export function assetInventory(html,origin) {
  if(typeof html!=='string'||Buffer.byteLength(html)>16*1024*1024)fail();
  const paths=new Set();
  for(const tag of html.matchAll(/<(script|link|img)\b[^>]*>/gi)){
    if(tag[1].toLowerCase()==='link'&&!/\brel=["'](?:stylesheet|preload|modulepreload|icon|shortcut icon)["']/i.test(tag[0]))continue;
    const name=tag[1].toLowerCase()==='link'?'href':'src';
    const match=new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(tag[0]);
    if(match)paths.add(safeAssetPath(match[1],origin));
    if(paths.size>256)fail();
  }
  if(!paths.size)fail();
  return [...paths].sort();
}

export async function summarizePdf(bytes,signal) {
  let input,info,text;
  try{
    active(signal);
    if(!Buffer.isBuffer(bytes)||bytes.length>32*1024*1024||!bytes.subarray(0,8).toString().startsWith('%PDF-'))fail();
    input=Buffer.from(bytes);
    const root='/opt/homebrew/Cellar/poppler/26.04.0/bin/';
    for(const name of ['pdfinfo','pdftotext']){const p=root+name,s=fs.lstatSync(p);if(!s.isFile()||s.mode&0o022||fs.realpathSync(p)!==p)fail();}
    info=await captureBoundedChild(root+'pdfinfo',['-f','1','-l','500','-box','-'],{input,signal,timeout:30000,maxBytes:1024*1024,cwd:'/'});
    if(info.status!==0||info.signal||info.stderr.length)fail();
    const metadata=info.stdout.toString('utf8'),pages=Number(/^Pages:\s+(\d+)\s*$/m.exec(metadata)?.[1]);
    const dimensions=[...metadata.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts\b/gm)].map(m=>[Number(m[1]),Number(m[2])]);
    if(!Number.isSafeInteger(pages)||pages<1||pages>500||dimensions.length!==pages||dimensions.flat().some(x=>!Number.isFinite(x)||x<=0))fail();
    text=await captureBoundedChild(root+'pdftotext',['-enc','UTF-8','-eol','unix','-nopgbrk','-','-'],{input,signal,timeout:30000,maxBytes:16*1024*1024,cwd:'/'});
    if(text.status!==0||text.signal||text.stderr.length)fail();
    const normalized=new TextDecoder('utf8',{fatal:true}).decode(text.stdout).normalize('NFC').replace(/\s+/gu,' ').trim();
    if(!normalized)fail();active(signal);
    return {pages,dimensions,text_sha256:hash(normalized)};
  }catch{fail();}finally{input?.fill(0);for(const result of [info,text]){result?.stdout?.fill(0);result?.stderr?.fill(0);}}
}

function validateManifest(manifest) {
  if(manifest?.version!==1||manifest.releaseId!==RELEASE||manifest.sourceSha!==SOURCE||!Array.isArray(manifest.assets)||manifest.assets.length<1||manifest.assets.length>256)fail();
  const entries=new Map();
  for(const item of manifest.assets){safeAssetPath(item.path,ORIGINS[1]);if(entries.has(item.path)||!Number.isSafeInteger(item.size)||item.size<0||item.size>16*1024*1024||! /^[a-f0-9]{64}$/.test(item.sha256))fail();entries.set(item.path,item);}
  return entries;
}
function assetType(p,type) {
  const extension=p.split('.').pop();
  const types={js:['application/javascript','text/javascript'],css:['text/css'],svg:['image/svg+xml'],png:['image/png'],jpg:['image/jpeg'],jpeg:['image/jpeg'],webp:['image/webp'],ico:['image/x-icon','image/vnd.microsoft.icon'],woff:['font/woff','application/font-woff'],woff2:['font/woff2']};
  return types[extension]?.includes(type);
}

export async function runReadOnlySmoke({managerAccessToken,embedKey,manifest},signal,seams={}) {
  signal=AbortSignal.any([signal,AbortSignal.timeout(480000)]);
  const fetchImpl=seams.fetchImpl??fetch,parsePdf=seams.parsePdf??summarizePdf;
  let checks=0;const summaries=new Map(),inventories=new Map(),assetResults=new Map();
  try{
    active(signal);
    if(typeof managerAccessToken!=='string'||!managerAccessToken||typeof embedKey!=='string'||!embedKey||/[\r\n\0]/.test(managerAccessToken+embedKey))fail();
    const approved=validateManifest(manifest);
    async function request(origin,endpoint,credential,kind,denied=false) {
      active(signal);
      const {url,options}=credential?buildAuthorizedRequest(origin,endpoint,credential):{url:new URL(endpoint,origin),options:{}};
      if(url.origin!==origin||!ORIGINS.includes(origin))fail();
      const bounded=AbortSignal.any([signal,AbortSignal.timeout(kind==='pdf'?120000:30000)]);
      const response=await fetchImpl(url,{...options,method:'GET',redirect:'error',cache:'no-store',signal:bounded});
      try{
      if(response.redirected||response.url&&new URL(response.url).origin!==origin)fail();
      if(denied){if(![401,403].includes(response.status))fail();await response.body?.cancel();checks++;return null;}
      const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
      if(response.status!==200||(kind==='json'&&type!=='application/json')||(kind==='html'&&type!=='text/html')||(kind==='pdf'&&type!=='application/pdf')||(kind==='excel'&&type!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')||(kind==='asset'&&!assetType(endpoint,type)))fail();
      if(kind!=='asset'&&(!/private/.test(response.headers.get('cache-control')??'')||!/no-store/.test(response.headers.get('cache-control')??'')))fail();
      const max=kind==='pdf'?32*1024*1024:16*1024*1024;
      if(Number(response.headers.get('content-length'))>max)fail();
      const chunks=[];let length=0,bytes;const reader=response.body?.getReader();if(!reader)fail();
      try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>max){item.value.fill(0);fail();}chunks.push(Buffer.from(item.value));item.value.fill(0);}bytes=Buffer.concat(chunks);active(signal);checks++;return {bytes,type};}
      catch{await reader.cancel().catch(()=>{});bytes?.fill(0);fail();}finally{for(const chunk of chunks)chunk.fill(0);reader.releaseLock();}
      }catch{await response.body?.cancel().catch(()=>{});fail();}
    }
    async function inspect(origin,endpoint,credential,kind,operation) {
      const result=await request(origin,endpoint,credential,kind);
      try{return await operation(result.bytes,result.type);}finally{result.bytes.fill(0);}
    }
    for(const audience of ['manager','embed'])for(const origin of ORIGINS)for(const alias of ['18','abbott']){
      const credential={kind:audience,value:audience==='manager'?managerAccessToken:embedKey};
      const admin='/api/dashboard/'+alias+'/abbott-admin-users';let administratorExclusionCount=null;
      if(audience==='embed')await request(origin,admin,credential,'json',true);
      else administratorExclusionCount=await inspect(origin,admin,credential,'json',bytes=>{const data=JSON.parse(bytes);if(!Array.isArray(data.user_ids)||data.user_ids.some(x=>typeof x!=='string'))fail();return data.user_ids.length;});
      const summary=await inspect(origin,'/api/dashboard/'+alias,credential,'json',bytes=>{
        // The public loader omits dashboard.id. Fixed aliases/authentication and
        // the Abbott-specific schema/period checked below establish identity.
        const data=JSON.parse(bytes);if(audience==='embed')scanEmbedPrivacy(data);
        return summarizeAbbottPayload(data,{audience,administratorExclusionCount});
      });
      const pdf=await inspect(origin,'/api/dashboard/'+alias+'/pdf',credential,'pdf',bytes=>parsePdf(bytes,signal));
      const workbook=await inspect(origin,'/api/dashboard/'+alias+'/excel',credential,'excel',bytes=>summarizeWorkbook(bytes));
      const paths=await inspect(origin,'/dashboard/'+alias,credential,'html',bytes=>assetInventory(new TextDecoder('utf8',{fatal:true}).decode(bytes),origin));
      const combined={summary,pdf,workbook};if(summaries.has(audience)&&!isDeepStrictEqual(summaries.get(audience),combined))fail();summaries.set(audience,combined);
      if(inventories.has(origin)&&!isDeepStrictEqual(inventories.get(origin),paths))fail();inventories.set(origin,paths);
    }
    for(const origin of ORIGINS){
      const paths=inventories.get(origin);
      if(origin===ORIGINS[1]&&paths.some(p=>!approved.has(p)))fail();
      const all=origin===ORIGINS[1]?[...approved.keys()].sort():paths;
      for(const p of all){const result=await inspect(origin,p,null,'asset',(bytes,type)=>({size:bytes.length,sha256:hash(bytes),type}));
        if(origin===ORIGINS[1]&&(result.sha256!==approved.get(p).sha256||result.size!==approved.get(p).size))fail();
        const normalized=p.replace(/^\/_next(?:-abbott)?\//,'/_next/');
        if(assetResults.has(normalized)&&!isDeepStrictEqual(assetResults.get(normalized),result))fail();assetResults.set(normalized,result);
      }
    }
    active(signal);
    return {status:'passed',period:{from:'2026-09-01',to:'2026-09-13'},aliases:2,audiences:2,checks,pdfs:Object.fromEntries([...summaries].map(([key,value])=>[key,value.pdf])),workbooks:Object.fromEntries([...summaries].map(([key,value])=>[key,hash(JSON.stringify(value.workbook))])),candidate_assets:approved.size,reference_assets:inventories.get(ORIGINS[0]).length};
  }catch{fail();}
}
