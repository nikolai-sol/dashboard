import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildAuthorizedRequest, summarizeAbbottPayload, summarizeWorkbook } from './compare-abbott-runtime.mjs';
import { captureBoundedChild } from './abbott-bounded-child.mjs';
import { markDiagnostic, carryDiagnostic } from './abbott-verification-diagnostics.mjs';

const fail = () => { throw new Error('ABBOTT_SMOKE_REFUSED'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const ORIGINS = ['http://127.0.0.1:3001','http://127.0.0.1:3004'];
const RELEASE = '1fdaecbdad47430a9d1375566abad001';
const SOURCE = 'dfd6267a742d1c7d88ccac636b89661df9b96f9f';
const CONTROL_PDF_UNAVAILABLE = Symbol('control_pdf_unavailable_5xx');
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

function safeAssetPath(value,origin,stage='asset_attestation') {
  const reject=reason=>{throw markDiagnostic(new Error('ABBOTT_SMOKE_REFUSED'),stage,reason);};
  if(!ORIGINS.includes(origin)||typeof value==='string'&&(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//')))reject('unexpected_asset_origin');
  if(typeof value!=='string'||value.length>512||!value.startsWith('/'))reject('unexpected_asset_path');
  // Next URL-encodes the literal [id] directory in its client-reference HTML,
  // while the attested physical static tree uses [id]. Canonicalize only that
  // exact generated segment; every other percent/bracket form stays forbidden.
  const canonical=value.replaceAll('%5Bid%5D','[id]');
  if(/[\\%?#\s<>"'&]/.test(canonical)||canonical.split('/').some(x=>x==='.'||x==='..'||/[\[\]]/.test(x)&&x!=='[id]'))reject('unexpected_asset_path');
  // Next appends /_next/static to assetPrefix and installs an internal rewrite.
  const prefix=origin===ORIGINS[1]?'/_next-abbott/_next/static/':'/_next/static/';
  if(stage==='asset_html'&&!canonical.startsWith(prefix))reject('unexpected_asset_path');
  if(canonical.startsWith('/_next')&&!canonical.startsWith(prefix))reject('unexpected_asset_path');
  if(!canonical.startsWith(prefix)&&!/^\/[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|ico|woff2?)$/.test(canonical))reject('unexpected_asset_path');
  if(!/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/.test(canonical))reject('unexpected_asset_path');
  return canonical;
}

const htmlSpace=character=>character!==undefined&&/[\t\n\f\r ]/.test(character);

// Bounded lexical scan: never search for attributes inside another attribute,
// comments or script text. This is deliberately not a general HTML validator.
function* assetTags(html,reject) {
  let cursor=0;
  while((cursor=html.indexOf('<',cursor))!==-1){
    if(html.startsWith('<!--',cursor)){
      const end=html.indexOf('-->',cursor+4);if(end===-1)reject('malformed_html');cursor=end+3;continue;
    }
    const match=/^<([A-Za-z][A-Za-z0-9:-]*)(?=[\t\n\f\r />]|$)/.exec(html.slice(cursor));
    if(!match){cursor++;continue;}
    const name=match[1].toLowerCase(),start=cursor+match[0].length;
    let end=start,quote=null;
    for(;end<html.length;end++){
      const c=html[end];
      if(quote){if(c===quote)quote=null;}
      else if(c==='"'||c==="'")quote=c;
      else if(c==='>')break;
    }
    if(end===html.length)reject('malformed_html');
    const attributes=html.slice(start,end);cursor=end+1;
    if(name==='script'||name==='link')yield {name,attributes};
    if(['script','style','textarea','title'].includes(name)){
      const closing=new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`,'gi');closing.lastIndex=cursor;
      const found=closing.exec(html);if(!found)reject('malformed_html');
      let finish=closing.lastIndex;while(htmlSpace(html[finish]))finish++;
      if(html[finish]!=='>')reject('malformed_html');cursor=finish+1;
    }
  }
}

function assetAttributes(text,reject) {
  const attributes=new Map();let cursor=0;
  while(cursor<text.length){
    const before=cursor;while(htmlSpace(text[cursor]))cursor++;
    if(cursor===text.length||text[cursor]==='/'&&cursor===text.length-1)break;
    if(cursor===before)reject('malformed_html');
    const match=/^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(text.slice(cursor));
    if(!match)reject('malformed_html');
    const name=match[0].toLowerCase();cursor+=match[0].length;
    if(attributes.has(name))reject('malformed_html');
    const afterName=cursor;while(htmlSpace(text[cursor]))cursor++;
    let value=null;
    if(text[cursor]==='='){
      cursor++;while(htmlSpace(text[cursor]))cursor++;
      const quote=text[cursor++];if(quote!=='"'&&quote!=="'")reject('malformed_html');
      const end=text.indexOf(quote,cursor);if(end===-1)reject('malformed_html');
      value=text.slice(cursor,end);cursor=end+1;
      if(/[\0-\x08\x0b\x0e-\x1f\x7f]/.test(value))reject('malformed_html');
    }else{
      // Valueless boolean attributes (e.g. async/defer) are legal, but URL/rel
      // attributes must have a quoted value. Preserve the next separator.
      if(['src','href','rel'].includes(name))reject('malformed_html');cursor=afterName;
    }
    attributes.set(name,value);
  }
  return attributes;
}

export function assetInventory(html,origin) {
  const reject=reason=>{throw markDiagnostic(new Error('ABBOTT_SMOKE_REFUSED'),'asset_html',reason);};
  if(typeof html!=='string')reject('malformed_html');
  if(Buffer.byteLength(html)>16*1024*1024)reject('body_limit');
  const paths=new Set();
  // Only executable/render-critical Next resources belong to this inventory.
  // Icon/metadata links (including Next's favicon content-hash query) and img
  // elements are deliberately not fetched; attestation still covers all public files.
  for(const tag of assetTags(html,reject)){
    const attributes=assetAttributes(tag.attributes,reject);
    if(tag.name==='link'){
      const rel=attributes.get('rel');if(typeof rel!=='string')reject('malformed_html');
      const tokens=rel.toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean);
      if(!tokens.length||tokens.some(token=>! /^[a-z][a-z0-9-]*$/.test(token)))reject('malformed_html');
      // A critical token takes precedence over any accompanying icon/metadata token.
      if(!tokens.some(token=>['stylesheet','preload','modulepreload'].includes(token)))continue;
      if(!attributes.has('href'))reject('malformed_html');
    }
    const name=tag.name==='link'?'href':'src';
    if(attributes.has(name))paths.add(safeAssetPath(attributes.get(name),origin,'asset_html'));
    if(paths.size>256)reject('inventory_limit');
  }
  if(!paths.size)reject('no_assets');
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
    const tokens=normalized.split(' ');
    return {pages,dimensions,text_sha256:hash(normalized),text_bag_sha256:hash([...tokens].sort().join('\0')),text_token_count:tokens.length};
  }catch{fail();}finally{input?.fill(0);for(const result of [info,text]){result?.stdout?.fill(0);result?.stderr?.fill(0);}}
}

function validateManifest(manifest) {
  if(manifest?.releaseId!==RELEASE||manifest?.sourceSha!==SOURCE)throw markDiagnostic(new Error('ABBOTT_SMOKE_REFUSED'),'asset_attestation','pin_mismatch');
  if(manifest.version!==1||!Array.isArray(manifest.assets)||manifest.assets.length<1||manifest.assets.length>256)fail();
  const entries=new Map();
  for(const item of manifest.assets){safeAssetPath(item.path,ORIGINS[1]);if(entries.has(item.path)||!Number.isSafeInteger(item.size)||item.size<0||item.size>16*1024*1024||! /^[a-f0-9]{64}$/.test(item.sha256))fail();entries.set(item.path,item);}
  return entries;
}
function assetType(p,type) {
  const extension=p.split('.').pop();
  const types={js:['application/javascript','text/javascript'],css:['text/css'],svg:['image/svg+xml'],png:['image/png'],jpg:['image/jpeg'],jpeg:['image/jpeg'],webp:['image/webp'],ico:['image/x-icon','image/vnd.microsoft.icon'],woff:['font/woff','application/font-woff'],woff2:['font/woff2']};
  return types[extension]?.includes(type);
}

export function pdfMismatchReason(reference,candidate) {
  const valid=value=>value&&typeof value==='object'&&Number.isSafeInteger(value.pages)&&Array.isArray(value.dimensions)&&typeof value.text_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.text_sha256);
  if(!valid(reference)||!valid(candidate))return 'pdf_shape';
  if(reference.pages!==candidate.pages)return 'page_count';
  if(!isDeepStrictEqual(reference.dimensions,candidate.dimensions))return 'page_dimensions';
  if(reference.text_sha256!==candidate.text_sha256){
    if(reference.text_token_count===candidate.text_token_count&&typeof reference.text_bag_sha256==='string'&&reference.text_bag_sha256===candidate.text_bag_sha256)return 'text_order';
    if(Number.isSafeInteger(reference.text_token_count)&&Number.isSafeInteger(candidate.text_token_count)&&reference.text_token_count!==candidate.text_token_count)return 'text_token_count';
    if(typeof reference.text_bag_sha256==='string'&&typeof candidate.text_bag_sha256==='string')return 'text_content';
    return 'text_digest';
  }
  return null;
}

export async function runReadOnlySmoke({managerAccessToken,embedKey,manifest},signal,seams={}) {
  signal=AbortSignal.any([signal,AbortSignal.timeout(480000)]);
  const fetchImpl=seams.fetchImpl??fetch,parsePdf=seams.parsePdf??summarizePdf;
  let checks=0,stage='setup';const controlPdfBaseline={},summaries=new Map(),inventories=new Map(),assetResults=new Map();
  const reject=reason=>{throw markDiagnostic(new Error('ABBOTT_SMOKE_REFUSED'),stage,reason);};
  try{
    active(signal);
    if(typeof managerAccessToken!=='string'||!managerAccessToken||typeof embedKey!=='string'||!embedKey||/[\r\n\0]/.test(managerAccessToken+embedKey))fail();
    stage='asset_attestation';const approved=validateManifest(manifest);
    async function request(origin,endpoint,credential,kind,denied=false) {
      active(signal);
      const {url,options}=credential?buildAuthorizedRequest(origin,endpoint,credential):{url:new URL(endpoint,origin),options:{}};
      if(url.origin!==origin||!ORIGINS.includes(origin))fail();
      const bounded=AbortSignal.any([signal,AbortSignal.timeout(kind==='pdf'?120000:30000)]);
      const response=await fetchImpl(url,{...options,method:'GET',redirect:'error',cache:'no-store',signal:bounded});
      try{
      if(response.redirected||response.url&&new URL(response.url).origin!==origin)reject('boundary');
      if(denied){if(![401,403].includes(response.status))reject('status');await response.body?.cancel();checks++;return null;}
      const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
      if(response.status!==200){
        if(kind==='pdf'){
          if(origin===ORIGINS[0]&&response.status>=500&&response.status<600){
            await response.body?.cancel();active(signal);checks++;return CONTROL_PDF_UNAVAILABLE;
          }
          const side=origin===ORIGINS[0]?'control':'candidate';
          const category=response.status>=400&&response.status<500?'4xx':response.status>=500&&response.status<600?'5xx':'other_status';
          if(side==='candidate'&&category==='5xx'){
            const failureStage=response.headers.get('X-Abbott-PDF-Failure-Stage');
            if(['authorize','launch','prepare','navigate','ready','render'].includes(failureStage))reject(`candidate_pdf_${failureStage}`);
          }
          reject(`${side}_${category}`);
        }
        reject(kind==='html'?'http_status':'status');
      }
      if((kind==='json'&&type!=='application/json')||(kind==='html'&&type!=='text/html')||(kind==='pdf'&&type!=='application/pdf')||(kind==='excel'&&type!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')||(kind==='asset'&&!assetType(endpoint,type)))reject('content_type');
      if(kind!=='asset'&&(!/private/.test(response.headers.get('cache-control')??'')||!/no-store/.test(response.headers.get('cache-control')??'')))reject('cache_policy');
      const max=kind==='pdf'?32*1024*1024:16*1024*1024;
      if(Number(response.headers.get('content-length'))>max)reject('body_limit');
      const chunks=[];let length=0,bytes;const reader=response.body?.getReader();if(!reader)fail();
      try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>max){item.value.fill(0);reject('body_limit');}chunks.push(Buffer.from(item.value));item.value.fill(0);}bytes=Buffer.concat(chunks);active(signal);checks++;return {bytes,type};}
      catch(error){await reader.cancel().catch(()=>{});bytes?.fill(0);throw error;}finally{for(const chunk of chunks)chunk.fill(0);reader.releaseLock();}
      }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
    }
    async function inspect(origin,endpoint,credential,kind,operation) {
      const result=await request(origin,endpoint,credential,kind);
      if(result===CONTROL_PDF_UNAVAILABLE)return result;
      try{return await operation(result.bytes,result.type);}finally{result.bytes.fill(0);}
    }
    for(const audience of ['manager','embed'])for(const origin of ORIGINS)for(const alias of ['18','abbott']){
      const credential={kind:audience,value:audience==='manager'?managerAccessToken:embedKey};
      const admin='/api/dashboard/'+alias+'/abbott-admin-users';let administratorExclusionCount=null;
      stage=audience==='embed'?'admin_embed_denial':'admin_manager';
      if(audience==='embed')await request(origin,admin,credential,'json',true);
      else administratorExclusionCount=await inspect(origin,admin,credential,'json',bytes=>{const data=JSON.parse(bytes);if(!Array.isArray(data.user_ids)||data.user_ids.some(x=>typeof x!=='string'))fail();return data.user_ids.length;});
      stage=audience==='embed'?'alias_embed_json':'alias_manager_json';
      const summary=await inspect(origin,'/api/dashboard/'+alias,credential,'json',bytes=>{
        // The public loader omits dashboard.id. Fixed aliases/authentication and
        // the Abbott-specific schema/period checked below establish identity.
        const data=JSON.parse(bytes);if(audience==='embed'){stage='privacy_shape';scanEmbedPrivacy(data);stage='alias_embed_json';}
        return summarizeAbbottPayload(data,{audience,administratorExclusionCount});
      });
      const pdfEndpoint='/api/dashboard/'+alias+'/pdf';
      stage='pdf_fetch';let pdf=await inspect(origin,pdfEndpoint,credential,'pdf',bytes=>{stage='pdf_parse';return parsePdf(bytes,signal);});
      if(origin===ORIGINS[0]&&pdf===CONTROL_PDF_UNAVAILABLE){
        stage='pdf_fetch';pdf=await inspect(origin,pdfEndpoint,credential,'pdf',bytes=>{stage='pdf_parse';return parsePdf(bytes,signal);});
      }
      if(origin===ORIGINS[0]){
        const outcome=pdf===CONTROL_PDF_UNAVAILABLE?'unavailable_5xx':'available';
        stage='pdf_compare';if(controlPdfBaseline[audience]&&controlPdfBaseline[audience]!==outcome)reject('mismatch');controlPdfBaseline[audience]=outcome;
      }
      stage='excel_fetch';const workbook=await inspect(origin,'/api/dashboard/'+alias+'/excel',credential,'excel',bytes=>{stage='excel_parse';return summarizeWorkbook(bytes);});
      stage='asset_html';
      const paths=await inspect(origin,'/dashboard/'+alias,credential,'html',bytes=>{
        let html;try{html=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{reject('malformed_html');}
        return assetInventory(html,origin);
      });
      const combined={summary,pdf,workbook};if(summaries.has(audience))for(const [key,code]of [['summary','json_compare'],['pdf','pdf_compare'],['workbook','excel_compare']]){
        const previous=summaries.get(audience)[key];
        if(key==='pdf'&&(previous===CONTROL_PDF_UNAVAILABLE||pdf===CONTROL_PDF_UNAVAILABLE))continue;
        stage=code;
        if(key==='pdf'){
          stage=origin===ORIGINS[0]?'pdf_compare_control_alias':alias==='18'?'pdf_compare_candidate':'pdf_compare_candidate_alias';
          const reason=pdfMismatchReason(previous,combined[key]);if(reason)reject(reason);
        }else if(!isDeepStrictEqual(previous,combined[key]))reject('mismatch');
      }summaries.set(audience,combined);
      stage='asset_html';
      if(inventories.has(origin)&&!isDeepStrictEqual(inventories.get(origin),paths))reject('alias_mismatch');inventories.set(origin,paths);
    }
    for(const origin of ORIGINS){
      const paths=inventories.get(origin);
      stage='asset_attestation';
      if(origin===ORIGINS[1]&&paths.some(p=>!approved.has(p)))fail();
      const all=origin===ORIGINS[1]?[...approved.keys()].sort():paths;
      for(const p of all){stage='asset_fetch';const result=await inspect(origin,p,null,'asset',(bytes,type)=>({size:bytes.length,sha256:hash(bytes),type}));
        stage='asset_attestation';
        if(origin===ORIGINS[1]&&(result.sha256!==approved.get(p).sha256||result.size!==approved.get(p).size))fail();
        const normalized=p.replace(/^\/_next-abbott\/_next\//,'/_next/');
        stage='asset_compare';
        if(assetResults.has(normalized)&&!isDeepStrictEqual(assetResults.get(normalized),result))fail();assetResults.set(normalized,result);
      }
    }
    active(signal);
    const pdfParity=Object.fromEntries(['manager','embed'].map(audience=>[audience,controlPdfBaseline[audience]==='available'?'matched':'not_compared']));
    const verification=Object.values(controlPdfBaseline).every(value=>value==='available')?'strict_parity':Object.values(controlPdfBaseline).every(value=>value==='unavailable_5xx')?'candidate_functional_with_baseline_exception':'mixed_strict_and_functional';
    return {status:'passed',verification,control_pdf_baseline:controlPdfBaseline,pdf_parity:pdfParity,period:{from:'2026-09-01',to:'2026-09-13'},aliases:2,audiences:2,checks,pdfs:Object.fromEntries([...summaries].map(([key,value])=>[key,value.pdf])),workbooks:Object.fromEntries([...summaries].map(([key,value])=>[key,hash(JSON.stringify(value.workbook))])),candidate_assets:approved.size,reference_assets:inventories.get(ORIGINS[0]).length};
  }catch(error){throw carryDiagnostic(new Error('ABBOTT_SMOKE_REFUSED'),error,stage,signal.aborted?'cancelled':'failed');}
}
