// Transported from the clean reviewed checkout, never loaded from a release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { isDeepStrictEqual } from 'node:util';

function selectAbbottNginxTls(nodes,fail){
    const hostBlocks=nodes.filter(n=>n.children.some(x=>x.name==='server_name'&&!x.block&&x.args.some(v=>v.toLowerCase().replace(/\.$/,'')==='dashboards.adreports.ru')));
    const targets=hostBlocks.filter(n=>n.children.some(x=>x.name==='listen'&&!x.block&&x.args.includes('ssl')&&x.args.some(v=>/^(?:443|\[::\]:443|[0-9.]+:443)$/.test(v))));
    if(targets.length!==1)fail();
    // SSL belongs to a listening socket, not just an explicit vhost ssl token.
    // Every other same-host block must be explicitly confined to non-SSL port80.
    for(const n of hostBlocks.filter(n=>n!==targets[0])){const listens=n.children.filter(x=>x.name==='listen');if(!listens.length||listens.some(x=>x.block||x.args.includes('ssl')||! /^(?:80|\[::\]:80|[0-9.]+:80)$/.test(x.args[0])))fail();}
    return targets[0];
}
function analyzeAbbottNginxText(text,nginxReason,onUnsupported,onFirstRejection=null,onInventory=null){
    const lexical=true,rejected=new WeakMap(),fail=()=>{throw Error('ABBOTT_DEPLOY_PREFLIGHT_REFUSED');};
    const refuse=code=>{nginxReason(code);const error=Error('ABBOTT_DEPLOY_PREFLIGHT_REFUSED');rejected.set(error,code);throw error;};
    nginxReason('syntax');
    if(!onInventory&&/abbott/i.test(text)||/[\0\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text))refuse(/abbott/i.test(text)?'existing_abbott_route':'syntax');
    const tokens=[],literalTokens=new WeakSet(),ambiguousGaps=new Set();let word='',quote=null,started=false,wordStart=0;
    // Preserve raw provenance before token normalization; routing cannot trust dropped escapes.
    const flush=end=>{if(started){const token={word};if(lexical){const raw=text.slice(wordStart,end),boundary=i=>i<0||i===text.length||/[ \t\r\n{};]/.test(text[i]);if(boundary(wordStart-1)&&boundary(end)&&!raw.includes('\\')&&[word,'"'+word+'"',"'"+word+"'"].includes(raw))literalTokens.add(token);}tokens.push(token);word='';started=false;}if(tokens.length>32768)fail();};
    for(let i=0;i<text.length;i++){if(!started)wordStart=i;const c=text[i];if(quote){if(c==='\\'){if(++i>=text.length)fail();word+=text[i];}else if(c===quote)quote=null;else word+=c;continue;}
      if(c==='"'||c==="'"){quote=c;started=true;continue;}if(c==='#'){flush(i);while(i<text.length&&text[i]!=='\n')i++;continue;}
      if(c==='\\'){if(++i>=text.length)fail();word+=text[i];started=true;continue;}
      if(c==='$'&&text[i+1]==='{'){const end=text.indexOf('}',i+2);if(end<0||! /^[A-Za-z0-9_]+$/.test(text.slice(i+2,end)))fail();word+=text.slice(i,end+1);i=end;started=true;continue;}
      if(/\s/.test(c)){flush(i);if(lexical&&!/[ \t\r\n]/.test(c))ambiguousGaps.add(tokens.length);continue;}if('{};'.includes(c)){flush(i);tokens.push({syntax:c});}else{word+=c;started=true;}
    }flush(text.length);if(quote)fail();
    const nodes=[],stack=[nodes],literalNodes=new WeakSet();let directive=[],literal=true;
    for(const [tokenIndex,token] of tokens.entries()){if(lexical&&ambiguousGaps.has(tokenIndex))literal=false;if(token.syntax==='{'||token.syntax===';'){if(!directive.length||!directive[0])fail();const node={name:directive[0],args:directive.slice(1),block:token.syntax==='{',children:[]};if(lexical&&literal)literalNodes.add(node);stack.at(-1).push(node);directive=[];literal=true;if(node.block){stack.push(node.children);if(stack.length>32)fail();}}
      else if(token.syntax==='}'){if(directive.length||stack.length===1)fail();stack.pop();}else{directive.push(token.word);if(lexical&&!literalTokens.has(token))literal=false;}
    }if(stack.length!==1||directive.length)fail();
    if(onInventory)return onInventory(nodes,literalNodes);
    // conf.d is already in the HTTP context. A nested server cannot supply TLS authority.
    // Names are diagnostic vocabulary only, never an acceptance allowlist.
    const unsupportedName=(n,selected=false)=>selected&&['location','proxy_pass','return','add_header','root','alias','index','try_files','error_page','proxy_redirect','proxy_cache','ssl_ecdh_curve','ssl_conf_command','client_body_buffer_size','charset','gzip_vary','if'].includes(n.name)?'unsupported_'+n.name:'unsupported_other';
    const unsupported=(n,selected=false)=>n.name==='include'?'include':['set','map','rewrite'].includes(n.name)?'variable_routing':n.name==='server'?'nested_server':unsupportedName(n,selected);
    // Deliberately bounded subset of ngx_http_limit_req_module, never routing.
    // sync and dynamic rate/zone/option values are not supported by this gate.
    const zones=new Set(),zoneNodes=new Set();
    for(const n of nodes){if(n.name!=='limit_req_zone'||n.block||n.args.length!==3)continue;
      const [key,...options]=n.args;if(!/^(?:[A-Za-z0-9_.-]{1,128}|\$[A-Za-z_][A-Za-z0-9_]{0,127})$/.test(key))continue;
      const declarations=options.filter(v=>v.startsWith('zone=')),rates=options.filter(v=>v.startsWith('rate='));
      if(declarations.length!==1||rates.length!==1)continue;
      const z=/^zone=([A-Za-z_][A-Za-z0-9_-]{0,63}):([1-9][0-9]{0,9})([kKmM]?)$/.exec(declarations[0]),r=/^rate=([1-9][0-9]{0,6})r\/[sm]$/.exec(rates[0]);
      if(!z||!r||Number(r[1])>1000000)continue;const size=Number(z[2])*({k:1024,m:1048576}[z[3].toLowerCase()]??1);
      if(size<65536||size>1073741824||zones.has(z[1])||zones.size>=64)continue;zones.add(z[1]);zoneNodes.add(n);
    }
    const invalidTop=n=>!zoneNodes.has(n)&&(n.name!=='server'||!n.block||n.args.length);
    if(nodes.some(invalidTop)){
      const n=nodes.find(invalidTop),containsServer=n=>n.children.some(c=>c.name==='server'||containsServer(c));
      if(onFirstRejection&&n.name!=='server'){const containsServerBlock=node=>node.children.some(c=>c.name==='server'&&c.block||containsServerBlock(c));if(!containsServerBlock(n))onFirstRejection('top',n.name);}
      refuse(containsServer(n)?'nested_server':unsupported(n));
    }
    nginxReason('tls_count');
    const targets=[selectAbbottNginxTls(nodes,fail)];
    // Check the entire selected main subtree. Included files are opaque external
    // boundaries and are never resolved or spliced into Abbott's semantic model.
    const routingLexemes=list=>{for(const n of list){if(['location','proxy_pass','return','add_header'].includes(n.name)&&(!literalNodes.has(n)||n.args.some(a=>/[\x00-\x1f\x7f]/.test(a))))refuse(unsupportedName(n,true));routingLexemes(n.children);}};routingLexemes(targets[0].children);
    const passive=new Set(['listen','server_name','ssl_certificate','ssl_certificate_key','ssl_protocols','ssl_ciphers','ssl_prefer_server_ciphers','ssl_session_cache','ssl_session_timeout','ssl_session_tickets','ssl_dhparam','ssl_stapling','ssl_stapling_verify','ssl_trusted_certificate','resolver','resolver_timeout','access_log','error_log','client_max_body_size','client_body_timeout','send_timeout','keepalive_timeout','proxy_http_version','proxy_set_header','proxy_read_timeout','proxy_connect_timeout','proxy_send_timeout','proxy_buffering','proxy_request_buffering','proxy_cache_bypass','proxy_no_cache','proxy_buffers','proxy_buffer_size','proxy_busy_buffers_size','add_header','expires','etag','gzip','gzip_types']);
    const validLimit=n=>{if(n.block||n.args.length<1||n.args.length>3)return false;const seen=new Set();let name;
      for(const arg of n.args){if(arg==='nodelay'){if(seen.has('delay'))return false;seen.add('delay');continue;}
        const m=/^(zone|burst|delay)=(.+)$/.exec(arg);if(!m||seen.has(m[1]))return false;seen.add(m[1]);
        if(m[1]==='zone'){if(!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(m[2]))return false;name=m[2];}
        else if(!/^[1-9][0-9]{0,6}$/.test(m[2])||Number(m[2])>1000000)return false;
      }return name&&zones.has(name)?name:null;};
    const unrelatedPath=(literal,diagnostic)=>{
      if(literal&&(literal.includes('//')||path.posix.normalize(literal)!==literal))refuse(diagnostic);
      const segments=literal.toLowerCase().split('/').filter(Boolean);
      if(segments.some((part,i)=>part==='_next-abbott'||part==='dashboard'&&(segments[i+1]==='abbott'||Number(segments[i+1])===18)))refuse('existing_abbott_route');
    };
    const visit=(list,context='root',selected=false,location=null)=>{const appliedZones=new Set();for(const n of list){try{nginxReason('unknown');let childLocation=location;const active=selected||n===targets[0],args=n.args.join(' ');if(/abbott/i.test(n.name+' '+args)||/(?:^|:)0*3004(?:$|\D)/.test(args)||n.name==='location'&&/dashboard.*\b18\b/i.test(args))refuse(/abbott/i.test(n.name+' '+args)||n.name==='location'&&/dashboard.*\b18\b/i.test(args)?'existing_abbott_route':'existing_3004');
      if(active&&n.name==='include'){
        if(n.block||n.args.length!==1||!literalNodes.has(n)||!canonicalAbbottIncludePaths(n.args))refuse('include');
        continue;
      }
      if(active&&(n.name==='limit_req_zone'&&(context!=='root'||!zoneNodes.has(n))||n.name==='limit_req'&&!['server','location'].includes(context)))refuse(unsupported(n,active));
      if(n.name==='include'||n.name==='server'&&(context!=='root'||!n.block||n.args.length)||['listen','server_name'].includes(n.name)&&(context!=='server'||n.block)||n.name==='location'&&(context!=='server'||!n.block||!n.args.length))refuse(unsupported(n,active));
      if(n.block&&n.name!=='server'&&n.name!=='location'&&!(n.name==='if'&&!active&&['server','location'].includes(context)&&n.args.length))refuse(unsupported(n,active));
      if(active&&n.name!=='server'){
        if(n.name==='location'){
          const literal=n.args.length===1?n.args[0]:n.args.length===2&&n.args[0]==='='?n.args[1]:null;
          if(!literal||!/^\/[A-Za-z0-9_./-]*$/.test(literal))refuse(args.includes('$')?'variable_routing':n.args.some(v=>['~','~*','^~'].includes(v))?'regex_location':unsupportedName(n,active));
          unrelatedPath(literal,unsupportedName(n,active));
          childLocation={literal,exact:n.args.length===2};
        }else if(n.name==='proxy_pass'){
          // Only the three literal, independently protected loopback runtimes.
          const target=n.args.length===1&&/^http:\/\/127\.0\.0\.1:300[123](\/[A-Za-z0-9_./~-]*)?$/.exec(n.args[0]);
          if(!target||!location)refuse(args.includes('$')?'variable_routing':unsupportedName(n,active));const uri=target[1]??'';
          // Never normalize an ambiguous rewrite into apparent unrelated authority.
          unrelatedPath(uri,unsupportedName(n,active));
          // Prefix replacement appends unmatched request bytes. Only identity
          // replacement is provable here; other static rewrites require exact locations.
          if(uri&&!location.exact&&uri!==location.literal)refuse(unsupportedName(n,active));
        }else if(n.name==='limit_req'){
          const name=validLimit(n);if(!name||appliedZones.has(name))refuse(unsupported(n,active));appliedZones.add(name);
        }else if(n.name==='return'){
          if(n.args.length!==1||! /^[1-5][0-9]{2}$/.test(n.args[0]))refuse(args.includes('$')?'variable_routing':unsupportedName(n,active));
        }else if(n.name==='add_header'){
          if(![2,3].includes(n.args.length)||n.args.length===3&&n.args[2]!=='always'||! /^[A-Za-z0-9-]+$/.test(n.args[0])||['location','refresh'].includes(n.args[0].toLowerCase()))refuse(n.args[0]?.includes('$')?'variable_routing':unsupportedName(n,active));
        }else if(!passive.has(n.name))refuse(unsupported(n,active));
      }
      visit(n.children,n.name,active,childLocation);
      }catch(error){const code=rejected.get(error);if(onFirstRejection&&selected&&!['server','location'].includes(n.name)&&['server','location'].includes(context)&&typeof code==='string'&&(code.startsWith('unsupported_')||['include','variable_routing'].includes(code)))onFirstRejection('selected',n.name,n.args,n.block,literalNodes.has(n));if(!onUnsupported||!(selected||n===targets[0])||n.block&&!['server','location'].includes(context)||['server','location'].includes(n.name)||typeof code!=='string'||!(code.startsWith('unsupported_')||['include','variable_routing'].includes(code)))throw error;onUnsupported(n.name);}
    }};visit(nodes);
  }

export function validateAbbottNginxText(text,note=()=>{}){analyzeAbbottNginxText(text,note,null);}
export function validateAbbottNginxOwnershipText(text,note=()=>{}){
  const refuse=reason=>{note(reason);throw Error('ABBOTT_DEPLOY_PREFLIGHT_REFUSED');};
  note('syntax');
  try{
    analyzeAbbottNginxText(text,()=>{},null,null,(nodes,literalNodes)=>{
      note('tls_count');
      const target=selectAbbottNginxTls(nodes,()=>refuse('tls_count'));
      const exact=new Set(['/dashboard/18','/dashboard/18/','/dashboard/abbott','/dashboard/abbott/','/api/dashboard/18','/api/dashboard/18/pdf','/api/dashboard/18/excel','/api/dashboard/18/abbott-admin-users','/api/dashboard/abbott','/api/dashboard/abbott/pdf','/api/dashboard/abbott/excel','/api/dashboard/abbott/abbott-admin-users']);
      const expected=new Set([...exact].map(route=>'= '+route).concat('^~ /_next-abbott/'));
      const directions=[['proxy_pass','http://127.0.0.1:3004'],['proxy_set_header','Host','$host'],['proxy_set_header','X-Real-IP','$remote_addr'],['proxy_set_header','X-Forwarded-For','$proxy_add_x_forwarded_for'],['proxy_set_header','X-Forwarded-Proto','$scheme']];
      const owned=new Set();
      const abbottPath=value=>{const lower=value.toLowerCase(),parts=lower.split('/').filter(Boolean);return lower.includes('_next-abbott')||parts.some((part,index)=>part==='dashboard'&&(parts[index+1]==='abbott'||Number(parts[index+1])===18));};
      const port3004=value=>/(?:^|:)0*3004(?:$|\D)/.test(value);
      const locationIdentity=node=>node.name==='location'&&node.block&&literalNodes.has(node)&&(node.args.length===2&&node.args[0]==='='&&exact.has(node.args[1])?'= '+node.args[1]:node.args.length===2&&node.args[0]==='^~'&&node.args[1]==='/_next-abbott/'?'^~ /_next-abbott/':null);
      const validateOwned=node=>{
        const identity=locationIdentity(node);if(!identity||owned.has(identity)||node.children.length!==directions.length)refuse('existing_abbott_route');
        for(let index=0;index<directions.length;index++){const child=node.children[index],wanted=directions[index];if(child.block||child.name!==wanted[0]||!literalNodes.has(child)||child.args.length!==wanted.length-1||child.args.some((value,i)=>value!==wanted[i+1]))refuse('existing_abbott_route');}
        owned.add(identity);
      };
      const walk=(list,directTargetChildren=false)=>{for(const node of list){const identity=directTargetChildren&&locationIdentity(node);if(identity){validateOwned(node);continue;}const values=[node.name,...node.args];if(values.some(abbottPath)||values.some(port3004))refuse(values.some(abbottPath)?'existing_abbott_route':'existing_3004');walk(node.children,node===target);}};
      walk(nodes);
      if(owned.size&& (owned.size!==expected.size||[...expected].some(identity=>!owned.has(identity))))refuse('existing_abbott_route');
      note('metadata');
    });
  }catch(error){if(error?.message==='ABBOTT_DEPLOY_PREFLIGHT_REFUSED')throw error;refuse('syntax');}
}
export function canonicalAbbottIncludePaths(paths){return Array.isArray(paths)&&paths.length<=8&&paths.every((v,i)=>typeof v==='string'&&v.length<=256&&/^\/etc\/(?:nginx|letsencrypt)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(v)&&!v.split('/').some(s=>s==='.'||s==='..')&&(i===0||paths[i-1]<v));}
export function inventoryAbbottNginxIncludes(text){try{if(typeof text!=='string'||Buffer.byteLength(text)>1048576)throw Error();return analyzeAbbottNginxText(text,()=>{},null,null,(nodes,literalNodes)=>{
 const fail=()=>{throw Error();},walk=(list,depth=0,parent=null)=>{for(const n of list){if(n.name==='server'&&(n.block||depth===0)&&(depth!==0||!n.block||n.args.length||!literalNodes.has(n)))fail();if(['listen','server_name'].includes(n.name)&&(depth!==1||parent!=='server'||n.block||!literalNodes.has(n)))fail();walk(n.children,depth+1,n.name);}};walk(nodes);
 const servers=nodes.filter(n=>n.name==='server'),target=selectAbbottNginxTls(servers,fail),paths=new Set();
 // Inventory-only authority: the deployment selector is deliberately unchanged.
 const hostServers=servers.filter(n=>n.children.some(x=>x.name==='server_name'&&x.args.some(v=>v.toLowerCase().replace(/\.$/,'')==='dashboards.adreports.ru')));
 for(const server of hostServers){const tls=server===target,port=tls?'443':'80',listeners=server.children.filter(n=>n.name==='listen'),addresses=new Set();if(!listeners.length||listeners.length>8)fail();
  for(const n of listeners){if(n.block||!literalNodes.has(n)||n.args.length<1||n.args.length>5)fail();const [address,...options]=n.args;
   const ip=new RegExp('^((?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}):'+port+'$').exec(address);
   if(address!==port&&address!=='[::]:'+port&&(!ip||ip[1].split('.').some(v=>Number(v)>255)))fail();
   if(addresses.has(address)||new Set(options).size!==options.length||options.some(v=>!(tls?['ssl','default_server','http2','reuseport']:['default_server','reuseport']).includes(v))||tls&&!options.includes('ssl'))fail();addresses.add(address);
  }
 }
 const collect=list=>{for(const n of list){if(n.name==='include'){if(n.block||n.args.length!==1||!literalNodes.has(n)||!canonicalAbbottIncludePaths([n.args[0]]))fail();paths.add(n.args[0]);if(paths.size>8)fail();}collect(n.children);}};collect(target.children);return{paths:[...paths].sort()};
 });}catch{return{reason:'parser_ambiguity'};}}
export function abbottNginxDiagnosticNames(){return ["add_header","alias","auth_basic","auth_basic_user_file","auth_request","autoindex","charset","client_body_buffer_size","client_body_in_file_only","client_body_temp_path","client_header_buffer_size","client_max_body_size","default_type","deny","directio","disable_symlinks","empty_gif","error_page","etag","expires","fastcgi_buffer_size","fastcgi_buffers","fastcgi_cache","fastcgi_index","fastcgi_param","fastcgi_pass","fastcgi_read_timeout","gzip_buffers","gzip_comp_level","gzip_disable","gzip_http_version","gzip_min_length","gzip_proxied","gzip_static","gzip_vary","http2","http2_max_concurrent_streams","if","include","index","internal","large_client_header_buffers","limit_conn","limit_conn_status","limit_except","limit_rate","limit_req","limit_req_status","location","log_not_found","map","max_ranges","more_clear_headers","more_set_headers","open_file_cache","open_file_cache_errors","open_file_cache_min_uses","open_file_cache_valid","other","port_in_redirect","proxy_cache","proxy_cache_background_update","proxy_cache_key","proxy_cache_lock","proxy_cache_revalidate","proxy_cache_use_stale","proxy_cache_valid","proxy_cookie_domain","proxy_cookie_flags","proxy_cookie_path","proxy_headers_hash_bucket_size","proxy_headers_hash_max_size","proxy_hide_header","proxy_ignore_headers","proxy_intercept_errors","proxy_max_temp_file_size","proxy_next_upstream","proxy_pass","proxy_pass_header","proxy_redirect","proxy_ssl_name","proxy_ssl_server_name","proxy_ssl_verify","proxy_temp_path","recursive_error_pages","reset_timedout_connection","return","rewrite","root","satisfy","sendfile","sendfile_max_chunk","server","server_name_in_redirect","server_tokens","set","ssi","ssl_buffer_size","ssl_client_certificate","ssl_conf_command","ssl_early_data","ssl_ecdh_curve","ssl_reject_handshake","ssl_verify_client","sub_filter","sub_filter_once","tcp_nodelay","tcp_nopush","try_files","types","types_hash_max_size","underscores_in_headers","uwsgi_param","uwsgi_pass","valid_referers"];}
export function diagnoseAbbottNginxText(text){const names=new Set(),known=new Set(abbottNginxDiagnosticNames());try{if(typeof text!=='string'||Buffer.byteLength(text)>1048576)throw Error();analyzeAbbottNginxText(text,()=>{},name=>names.add(known.has(name)?name:'other'));return [...names].sort();}catch{return {reason:'parser_ambiguity'};}}
export function abbottNginxFirstRejectionCodes(){return ['none',...['upstream','map','geo','split_clients','log_format','proxy_cache_path','limit_req_zone','limit_conn_zone','other'].map(n=>'top_'+n),...abbottNginxDiagnosticNames().filter(n=>n!=='include').map(n=>'selected_'+n),'selected_include_other'];}
export function classifyAbbottNginxFirstRejection(text){let first;const known=new Set(abbottNginxFirstRejectionCodes());try{if(typeof text!=='string'||Buffer.byteLength(text)>1048576)throw Error();analyzeAbbottNginxText(text,()=>{},null,(context,name)=>{first??=context==='selected'&&name==='include'?'selected_include_other':known.has(context+'_'+name)?context+'_'+name:context+'_other';});return {rejection:'none'};}catch{return first?{rejection:first}:{reason:'parser_ambiguity'};}}

// Fixed checkpoint authority, not a caller-selected inventory. This proof makes
// no subprocess, supervisor/socket connection, network request or filesystem write.
export function createAbbottDeploymentProof({io=fs,hostname=os.hostname,getuid=()=>process.getuid(),digest=b=>createHash('sha256').update(b).digest('hex'),verifyActive,verifyBrowser,notePhase=()=>{},validateNginx=validateAbbottNginxText}={}) {
  const fail=()=>{throw Error('ABBOTT_DEPLOY_PREFLIGHT_REFUSED');};
  let currentPhase='preflight_current';
  const phase=(stage,reason='failed')=>{currentPhase=stage;notePhase(stage,reason);};
  const reason=value=>{if(['preflight_neighbor_combined','preflight_neighbor_zaruku','preflight_neighbor_medroche'].includes(currentPhase))notePhase(currentPhase,value);};
  const nginxReason=value=>{if(currentPhase==='preflight_nginx')notePhase(currentPhase,value);};
  const stat=file=>{try{return io.lstatSync(file);}catch(error){if(/^\/proc\/[1-9][0-9]*$/.test(file)&&error?.code==='ENOENT')reason('pid_absent');throw error;}};
  const root='/var/www/dashboard-abbott',control='/var/www/.dashboard-abbott-control';
  const record={scope:'abbott',id:'cf5f0759e633421cba2fbc4fb822a244',sourceSha:'b607f1111f1143d7cfa35f0c8c0b9d6d3f6d62a8',manifestDigest:'115ccb22599201672d7270948fc96c744e7b7b92ab62e7ace9380be420297504',previousId:'1a2f99c57e594fc38d1f3a663f781cf4'};
  let boot,perimeterSnapshot,invalid=false;
  const neighborPolicies=[['combined',0,0,'/var/www/dashboard',3001],['zaruku',984,991,'/var/www/dashboard-zaruku/apps/zaruku',3002],['medroche',983,983,null,3003]];
  const stable=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
  const stableProc=(a,b)=>['dev','ino','size','mode','uid','gid','nlink'].every(k=>a[k]===b[k]);
  const metadata=s=>Object.fromEntries(['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
  function ancestry(file,uid=0,gid=0,ownedDirectory=null){
    for(let dir=path.dirname(file);dir!=='/';dir=path.dirname(dir)){
      const s=stat(dir),proc=/^\/proc\/[1-9][0-9]*(?:\/|$)/.test(dir);
      const browser=dir==='/var/lib/dashboard-abbott'||dir.startsWith('/var/lib/dashboard-abbott/');
      if(!s.isDirectory()||s.isSymbolicLink()||io.realpathSync(dir)!==dir||s.mode&0o022)fail();
      const owned=ownedDirectory&&(dir===ownedDirectory.path||ownedDirectory.recursive&&dir.startsWith(ownedDirectory.path+'/'))&&s.uid===ownedDirectory.uid&&s.gid===ownedDirectory.gid;
      if(!(s.uid===0&&(s.gid===0||browser&&s.gid===984)||proc&&s.uid===uid&&s.gid===gid||owned)){if(proc)reason('uid_gid');fail();}
    }
  }
  function read(file,max=8192,{uid=0,gid=0,mode,proc=false,ancestorUid=uid,ancestorGid=gid,ancestorOwned=null,utf8Reason='utf8'}={}){
    let fd,bytes;try{
      if(proc)reason('proc_metadata');
      ancestry(file,ancestorUid,ancestorGid,ancestorOwned);const a=stat(file);
      if(!a.isFile()||a.isSymbolicLink()||a.nlink!==1||a.uid!==uid||a.gid!==gid||a.mode&0o022||mode!==undefined&&(a.mode&0o7777)!==mode||!proc&&(a.size>max||io.realpathSync(file)!==file))fail();
      const stableRead=proc?stableProc:stable;
      fd=io.openSync(file,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!stableRead(a,io.fstatSync(fd)))fail();
      bytes=Buffer.alloc(max+1);let n=0;while(n<bytes.length){const count=io.readSync(fd,bytes,n,bytes.length-n,n);if(!Number.isSafeInteger(count)||count<0||count>bytes.length-n)fail();if(!count)break;n+=count;}
      if(n>max||!proc&&n!==a.size||!stableRead(a,io.fstatSync(fd))||!stableRead(a,stat(file)))fail();nginxReason(utf8Reason);return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,n));
    }finally{bytes?.fill(0);if(fd!==undefined)io.closeSync(fd);}
  }
  const json=file=>JSON.parse(read(file,8192,{mode:0o600}));
  function link(file,target,uid=0,gid=0){const a=stat(file);if(!a.isSymbolicLink()||a.uid!==uid||a.gid!==gid||io.realpathSync(file)!==target||!stable(a,stat(file)))fail();}
  function kernel([pid,start,uid,gid,cwd,port],server){
    reason('proc_metadata');
    const proc='/proc/'+pid,meta={uid,gid,proc:true};ancestry(proc+'/stat',uid,gid);
    const boundary=stat(proc);if(boundary.uid!==uid||boundary.gid!==gid){reason('uid_gid');fail();}if(!boundary.isDirectory()||boundary.isSymbolicLink()||io.realpathSync(proc)!==proc)fail();
    let observedStart=start;
    const identity=()=>{
      const text=read(proc+'/stat',8192,meta),close=text.lastIndexOf(')'),v=text.slice(close+2).trim().split(/\s+/);
      if(!text.startsWith(pid+' (')||close<0||!['R','S','D','I'].includes(v[0]))fail();
      reason('start_mismatch');if(observedStart===null){if(!/^[1-9][0-9]{0,19}$/.test(v[19]))fail();observedStart=v[19];}if(v[19]!==observedStart)fail();
      const status=read(proc+'/status',8192,meta);
      reason('uid_gid');
      for(const[field,value]of [['Uid',uid],['Gid',gid]]){const rows=status.split('\n').filter(l=>l.startsWith(field+':'));if(rows.length!==1||rows[0].trim().split(/\s+/).slice(1).join(',')!==[value,value,value,value].join(','))fail();}
      reason('cwd');link(proc+'/cwd',cwd,uid,gid);
    };identity();
    reason('executable');
    const executable=io.realpathSync(proc+'/exe');if(!/^\/(?:[A-Za-z0-9_.+-]+\/)*(?:node|nodejs)$/.test(executable))fail();
    link(proc+'/exe',executable,uid,gid);ancestry(executable);const binary=stat(executable);
    if(!binary.isFile()||binary.isSymbolicLink()||binary.nlink!==1||binary.uid!==0||binary.gid!==0||binary.mode&0o022||!(binary.mode&0o111))fail();
    const command=read(proc+'/cmdline',4096,meta);reason('cmdline');if(!command.endsWith('\0'))fail();const argv=command.replace(/\0+$/,'');
    // Next's fixed process-title shape or the fixed source-established server.
    if(argv!=='next-server (v16.1.6)'&&argv!==executable+'\0'+server)fail();
    reason('proc_metadata');const directory=proc+'/fd',a=stat(directory);if(!a.isDirectory()||a.isSymbolicLink()||a.uid!==uid||a.gid!==gid||io.realpathSync(directory)!==directory)fail();
    const names=io.readdirSync(directory);if(names.length>4096||names.some(n=>!/^\d{1,10}$/.test(n)))fail();const sockets=new Set();
    for(const name of names){const file=directory+'/'+name,s=stat(file);if(!s.isSymbolicLink()||s.uid!==uid||s.gid!==gid)fail();const target=io.readlinkSync(file);if(!stable(s,stat(file)))fail();const m=/^socket:\[([1-9][0-9]*)\]$/.exec(target);if(m)sockets.add(m[1]);}
    const portHex=port.toString(16).toUpperCase().padStart(4,'0');
    const listeners=[];for(const table of ['tcp','tcp6']){
      const lines=read(proc+'/net/'+table,2*1024*1024,{proc:true,ancestorUid:uid,ancestorGid:gid}).trim().split('\n');
      reason('listener');
      const address=new RegExp('^[0-9A-F]{'+(table==='tcp'?8:32)+'}:[0-9A-F]{4}$');
      for(const line of lines.slice(1)){const v=line.trim().split(/\s+/);if(v.length<10||!address.test(v[1])||!address.test(v[2])||! /^[0-9A-F]{2}$/.test(v[3])||! /^\d+$/.test(v[7])||! /^\d+$/.test(v[9]))fail();if(v[3]==='0A'&&v[1].split(':')[1]===portHex){if(v[7]!==String(uid))fail();listeners.push([table,v[1],v[9]]);}}
    }
    reason('listener');if(listeners.length!==1||listeners[0][0]!=='tcp'||listeners[0][1]!=='0100007F:'+portHex||!sockets.has(listeners[0][2]))fail();
    identity();reason('executable');link(proc+'/exe',executable,uid,gid);if(!stable(binary,stat(executable)))fail();reason('proc_metadata');if(!stable(boundary,stat(proc)))fail();
    return{pid,start:observedStart,uid,gid,cwd,executable,command,binary:metadata(binary),directory:metadata(boundary),listener:listeners[0]};
  }
  function listenerTable(){
    const result=[];for(const table of ['tcp','tcp6']){
      const text=read('/proc/1/net/'+table,2*1024*1024,{proc:true}),address=new RegExp('^[0-9A-F]{'+(table==='tcp'?8:32)+'}:[0-9A-F]{4}$');
      reason('listener');
      for(const line of text.trim().split('\n').slice(1)){const v=line.trim().split(/\s+/);if(v.length<10||!address.test(v[1])||!address.test(v[2])||! /^[0-9A-F]{2}$/.test(v[3])||! /^\d+$/.test(v[7])||! /^\d+$/.test(v[9]))fail();
        const port=Number.parseInt(v[1].split(':')[1],16);if(v[3]==='0A'&&[3001,3002,3003].includes(port))result.push({port,table,address:v[1],uid:Number(v[7]),inode:v[9]});
      }
    }
    reason('listener');result.sort((a,b)=>a.port-b.port);if(result.length!==3||new Set(result.map(r=>r.inode)).size!==3||result.some((r,i)=>r.port!==3001+i||r.table!=='tcp'||r.address!=='0100007F:'+r.port.toString(16).toUpperCase().padStart(4,'0')||! /^[1-9][0-9]*$/.test(r.inode)))fail();return result;
  }
  function discover(){
    const listeners=listenerTable(),owners=new Map(listeners.map(r=>[r.inode,new Set()]));
    reason('proc_metadata');const entries=io.readdirSync('/proc');if(entries.length>8192)fail();const pids=entries.filter(n=>/^[1-9][0-9]{0,9}$/.test(n));if(pids.length>4096)fail();let total=0;
    for(const name of pids){const proc='/proc/'+name;try{
      const directory=stat(proc);if(!directory.isDirectory()||directory.isSymbolicLink()||io.realpathSync(proc)!==proc)fail();
      const fd=proc+'/fd',s=stat(fd);if(!s.isDirectory()||s.isSymbolicLink()||io.realpathSync(fd)!==fd)fail();
      const names=io.readdirSync(fd);total+=names.length;if(names.length>4096||total>65536||names.some(n=>!/^\d{1,10}$/.test(n)))fail();
      for(const n of names){const file=fd+'/'+n;try{const before=stat(file);if(!before.isSymbolicLink())fail();const target=io.readlinkSync(file);if(!stable(before,stat(file)))fail();const m=/^socket:\[([1-9][0-9]*)\]$/.exec(target);if(m&&owners.has(m[1]))owners.get(m[1]).add(Number(name));}catch(error){if(error?.code!=='ENOENT')throw error;}}
      if(!stable(directory,stat(proc)))fail();
    }catch(error){if(error?.code!=='ENOENT')throw error;}}
    if(!isDeepStrictEqual(listenerTable(),listeners))fail();
    return listeners.map(r=>{phase('preflight_neighbor_'+neighborPolicies.find(p=>p[4]===r.port)[0],'listener');const ids=[...owners.get(r.inode)];if(ids.length!==1)fail();return{...r,pid:ids[0]};});
  }
  function perimeter(){
    phase('preflight_current');if(getuid()!==0||hostname()!=='ybjqbzojln')fail();
    const observedBoot=read('/proc/sys/kernel/random/boot_id',128,{proc:true}).trim();if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(observedBoot))fail();if(boot&&boot!==observedBoot)fail();boot=observedBoot;
    phase('preflight_nginx','metadata');const nginxPath='/etc/nginx/conf.d/dashboard-next.conf',nginxMeta=metadata(stat(nginxPath)),nginx=read(nginxPath,1048576,{mode:0o644});
    validateNginx(nginx,nginxReason);
    nginxReason('metadata');
    if(!isDeepStrictEqual(nginxMeta,metadata(stat(nginxPath))))fail();const nginxRecord={bytes:nginx,hash:digest(Buffer.from(nginx)),metadata:nginxMeta};
    phase('preflight_neighbor_combined','listener');const discovered=discover(),neighbors=[];
    for(const [name,uid,gid,fixedCwd,port]of neighborPolicies){
      phase('preflight_neighbor_'+name,'listener');const listener=discovered.find(r=>r.port===port);if(!listener||listener.uid!==uid)fail();
      reason('cwd');const cwd=io.realpathSync('/proc/'+listener.pid+'/cwd');
      if(fixedCwd?cwd!==fixedCwd:!/^\/var\/www\/dashboard-medroche-releases\/[a-f0-9]{40}\/standalone\/apps\/site-seo$/.test(cwd))fail();
      const neighborOwner=name==='combined'?{path:cwd,uid:501,gid:0}:name==='medroche'?{path:'/var/www/dashboard-medroche-releases',uid:0,gid:983,recursive:true}:null;
      ancestry(cwd+'/server.js',0,0,neighborOwner);const cwdDirectory=stat(cwd),cwdUid=neighborOwner?.uid??0,cwdGid=neighborOwner?.gid??0;
      if(!cwdDirectory.isDirectory()||cwdDirectory.isSymbolicLink()||cwdDirectory.uid!==cwdUid||cwdDirectory.gid!==cwdGid||cwdDirectory.mode&0o022||io.realpathSync(cwd)!==cwd)fail();
      reason('release_record');let release;
      if(name==='medroche'){const target=cwd.slice(0,-'/apps/site-seo'.length),file='/var/www/dashboard-medroche';ancestry(file);link(file,target);release={target,metadata:metadata(stat(file))};}
      else{const file=name==='combined'?'/var/www/dashboard/.release-source-sha':'/var/www/dashboard-zaruku/.release-source-sha',bytes=read(file,128,neighborOwner?{uid:501,gid:0,ancestorOwned:neighborOwner}:{});if(!/^[a-f0-9]{40}\n?$/.test(bytes))fail();release={bytes,metadata:metadata(stat(file))};}
      const process=kernel([listener.pid,null,uid,gid,cwd,port],cwd+'/server.js');if(process.listener[2]!==listener.inode)fail();
      reason('cwd');if(!stable(cwdDirectory,stat(cwd)))fail();
      neighbors.push({name,release,process,listener,cwdDirectory:metadata(cwdDirectory)});
    }
    const snapshot={boot:observedBoot,nginx:nginxRecord,neighbors};
    if(perimeterSnapshot){
      phase('preflight_nginx','snapshot_drift');if(!isDeepStrictEqual(snapshot.nginx,perimeterSnapshot.nginx))fail();
      for(let i=0;i<neighbors.length;i++){phase('preflight_neighbor_'+neighbors[i].name,'unknown');if(!isDeepStrictEqual(neighbors[i],perimeterSnapshot.neighbors[i]))fail();}
    }else perimeterSnapshot=snapshot;
  }
  function preflight(){
    phase('preflight_current');
    for(const [dir,mode]of [[control,0o700],['/var/www/dashboard-abbott-releases',0o711],['/var/www/dashboard-abbott-backups',0o711]]){
      ancestry(dir);const s=stat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==mode||io.realpathSync(dir)!==dir)fail();
    }
    const passwd=read('/etc/passwd',1048576).split('\n').map(l=>l.split(':')).filter(v=>v[0]==='dashboard-abbott'||v[2]==='982');
    const group=read('/etc/group',1048576).split('\n').map(l=>l.split(':')).filter(v=>v[0]==='dashboard-abbott'||v[2]==='984'||v[3]?.split(',').includes('dashboard-abbott'));
    if(passwd.length!==1||passwd[0].length!==7||passwd[0][0]!=='dashboard-abbott'||passwd[0][2]!=='982'||passwd[0][3]!=='984'||passwd[0][5]!=='/nonexistent'||passwd[0][6]!=='/usr/sbin/nologin'||group.length!==1||group[0].length!==4||group[0][0]!=='dashboard-abbott'||group[0][2]!=='984'||!['','dashboard-abbott'].includes(group[0][3]))fail();
    perimeter();phase('preflight_current');if(!isDeepStrictEqual(json(control+'/current.json'),record)||!isDeepStrictEqual(json(control+'/'+record.id+'/record.json'),record)||read(root+'/.release-source-sha',128)!==record.sourceSha+'\n'||read(root+'/.release-runtime-scope',64)!=='abbott\n')fail();
    if(digest(Buffer.from(read(control+'/'+record.id+'/trusted-runtime-manifest.json',2*1024*1024,{mode:0o600})))!==record.manifestDigest)fail();
    const launcher='/var/www/.dashboard-abbott-launcher.cjs';if(read(launcher,65536)!==read(control+'/'+record.id+'/deploy/abbott/start.cjs',65536))fail();
    const names=io.readdirSync(control);if(names.length>256)fail();const receipts=names.filter(n=>/^ownership-[a-f0-9-]{36}\.json$/.test(n)).map(n=>json(control+'/'+n)).filter(r=>r.record?.id===record.id);
    if(receipts.length!==1)fail();const r=receipts[0],p=r.process,dir=stat(root);
    if(Object.keys(r).sort().join(',')!=='binding,directory,process,record,transaction,version'||r.version!==1||!isDeepStrictEqual(r.record,record)||!isDeepStrictEqual(r.directory,{dev:String(dir.dev),ino:String(dir.ino)})||r.binding?.sourceSha!==record.sourceSha||Object.keys(r.binding).sort().join(',')!=='runId,sourceSha'||! /^[a-f0-9-]{36}$/.test(r.binding.runId)||! /^[a-f0-9-]{36}$/.test(r.transaction))fail();
    if(!p||Object.keys(p).sort().join(',')!=='appName,bootId,cwd,gid,pid,pmId,registration,script,sourceSha,startTime,uid'||p.appName!=='dashboard-abbott'||p.bootId!==boot||p.uid!==982||p.gid!==984||p.sourceSha!==record.sourceSha||p.cwd!==root+'/apps/abbott'||p.script!==launcher||!Number.isSafeInteger(p.pid)||p.pid<=0||!Number.isSafeInteger(p.pmId)||p.pmId<0||!/^\d{1,20}$/.test(p.startTime))fail();
    const reg=p.registration;if(!reg||!['dashboard-abbott',982].includes(reg.uid)||!['dashboard-abbott',984].includes(reg.gid)||!isDeepStrictEqual(reg,{appName:'dashboard-abbott',pmId:p.pmId,exec:'/usr/bin/env',cwd:p.cwd,args:['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node',launcher],uid:reg.uid,gid:reg.gid,releaseId:record.id,sourceSha:record.sourceSha}))fail();
    kernel([p.pid,p.startTime,982,984,p.cwd,3004],launcher);
    verifyActive(record);
    phase('preflight_browser');
    const stamp='/var/lib/dashboard-abbott/browser-cache/stamp.json',before=read(stamp,1048576,{gid:984,mode:0o640});
    if(verifyBrowser().archiveSha256!=='fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04'||read(stamp,1048576,{gid:984,mode:0o640})!==before)fail();
    perimeter();phase('preflight_current');kernel([p.pid,p.startTime,982,984,p.cwd,3004],launcher);
    if(!isDeepStrictEqual(json(control+'/current.json'),record)||!isDeepStrictEqual(json(control+'/'+record.id+'/record.json'),record))fail();
  }
  // A concurrent change cannot be forgiven by a later reversion during rollback.
  const closed=fn=>()=>{try{if(invalid)fail();return fn();}catch{invalid=true;fail();}};
  return{preflight:closed(preflight),perimeter:closed(perimeter)};
}

// Based on af1948c's immutable installer; transport binds this closure to the
// clean, exact release ref. No executable is imported from an artifact.
export function createRuntimeInstaller(authority, environmentKeys, browserPrerequisite = null) {
const { scope, port, appName } = authority;
if (!/^[a-z][a-z0-9-]{0,31}$/.test(scope) || appName !== `dashboard-${scope}` ||
    authority.appDir !== `/var/www/${appName}` || authority.lockDir !== `/var/www/.${appName}-deploy.lock` ||
    authority.releaseBranch !== `release/${scope}` || authority.assetPrefix !== `/_next-${scope}` ||
    !Number.isInteger(port) || port < 3001 || port > 65535 || !Array.isArray(environmentKeys)) throw new Error('Invalid runtime authority');
const BASE = '/var/www';
const DEPLOY_UID = 0;
const DEPLOY_GID = 0;
const APP = `${BASE}/dashboard-${scope}`;
const RELEASES = `${BASE}/dashboard-${scope}-releases`;
const BACKUPS = `${BASE}/dashboard-${scope}-backups`;
const CONTROL = `${BASE}/.dashboard-${scope}-control`;
const LOCK = `${BASE}/.dashboard-${scope}-deploy.lock`;
const CURRENT = `${CONTROL}/current.json`;
const HOST_DIRECTORY_MODES = Object.freeze({
  [RELEASES]: 0o711,
  [BACKUPS]: 0o711,
  [CONTROL]: 0o700,
  [`${BASE}/.dashboard-${scope}-secrets`]: 0o700,
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const ENV_KEYS = Object.freeze([...environmentKeys]);
const SECRET_INPUT_KEYS = ENV_KEYS.filter(key => !['PORT', 'HOSTNAME', 'NODE_ENV', 'INTERNAL_BASE_URL'].includes(key));

function safeRelative(name) {
  if (typeof name !== 'string' || !name || name === '.' || name.length > 512 || path.posix.normalize(name) !== name || name.startsWith('/') || name.startsWith('../') || /[\\\u0000-\u0020:]/.test(name)) fail('Unsafe release path');
  return name;
}

function ancestors(filename) {
  for (let dir = path.dirname(filename);; dir = path.dirname(dir)) {
    const s = fs.lstatSync(dir);
    const alias = ['/tmp', '/var'].includes(dir) && s.isSymbolicLink() && fs.realpathSync(dir) === `/private${dir}`;
    const stickySystemTemp = ['/tmp', '/private/tmp'].includes(dir) && (s.mode & 0o1000) && s.uid === 0;
    if (!s.isDirectory() && !alias || !alias && (s.mode & 0o022) && !stickySystemTemp || ![0, process.getuid()].includes(s.uid)) fail('Unsafe directory ancestry');
    if (dir === path.dirname(dir)) break;
  }
}

function readPinned(filename, digest) {
  ancestors(filename);
  const bytes = stableRead(filename, true);
  if (!DIGEST.test(digest) || hash(bytes) !== digest) fail('External authority digest mismatch');
  return bytes;
}

function stableRead(filename, privateFile = false) {
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 536870912n || privateFile && (Number(before.mode) & 0o077)) fail('Unsafe authority file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const content = fs.readFileSync(fd);
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(filename, { bigint: true })]) {
      if (['dev', 'ino', 'size', 'mode', 'ctimeNs', 'mtimeNs'].some(key => before[key] !== after[key])) fail('Authority file changed');
    }
    return content;
  } finally { fs.closeSync(fd); }
}

function owned(filename, directory = false) {
  const s = fs.lstatSync(filename);
  if ((directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) || s.uid !== DEPLOY_UID || s.mode & 0o022) fail('Unsafe deploy ownership or write separation');
  ancestors(filename);
}

function ensureDirectory(filename, mode = 0o755) {
  if (!fs.existsSync(filename)) { fs.mkdirSync(filename, { mode }); fs.chmodSync(filename, mode); }
  owned(filename, true);
  const stat = fs.lstatSync(filename);
  if (stat.gid !== DEPLOY_GID || (stat.mode & 0o7777) !== mode) fail('Unsafe exact deploy directory mode');
}

function createFile(filename, bytes, mode = 0o600) {
  const missing = [];
  for (let dir = path.dirname(filename); !fs.existsSync(dir); dir = path.dirname(dir)) missing.push(dir);
  for (const dir of missing.reverse()) { fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755); }
  ancestors(filename);
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  fs.chmodSync(filename, mode);
}

function readRecord(id) {
  if (!ID.test(id)) fail('Invalid release identity');
  const filename = `${CONTROL}/${id}/record.json`;
  owned(filename);
  const record = JSON.parse(stableRead(filename, true));
  if (record.id !== id || record.scope !== `${scope}` || !SHA.test(record.sourceSha) || !DIGEST.test(record.manifestDigest) || record.previousId !== null && !ID.test(record.previousId)) fail('Invalid runtime release authority');
  return record;
}

function attestTree(artifact, record) {
  owned(artifact, true);
  const manifestPath = `${CONTROL}/${record.id}/trusted-runtime-manifest.json`;
  owned(manifestPath);
  const manifest = JSON.parse(readPinned(manifestPath, record.manifestDigest));
  if (manifest.scope !== `${scope}` || manifest.sourceSha !== record.sourceSha || !Array.isArray(manifest.files)) fail('Trusted source or scope mismatch');
  const entries = new Map();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    if (entries.has(entry.path) || entry.type !== 'file' || !DIGEST.test(entry.sha256) || !Number.isInteger(entry.mode) || entry.mode & 0o022 || entry.mode < 0 || entry.mode > 0o777 || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > 536870912) fail('Invalid trusted file authority');
    entries.set(entry.path, entry);
  }
  const seen = new Set();
  function visit(dir) {
    owned(dir, true);
    if ((fs.statSync(dir).mode & 0o005) !== 0o005) fail('Artifact directory must be readable by runtime');
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), s = fs.lstatSync(file);
      if (s.isDirectory()) { visit(file); continue; }
      owned(file);
      const relative = path.relative(artifact, file);
      const bytes = stableRead(file);
      if (relative === '.env') {
        if ((s.mode & 0o007) || bytes.length > 65536) fail('Unsafe runtime environment permissions');
      } else {
        if (!(s.mode & 0o004)) fail('Artifact file must be readable by runtime');
        const entry = entries.get(relative);
        if (!entry || bytes.length !== entry.size || hash(bytes) !== entry.sha256 || (s.mode & 0o777) !== entry.mode) fail('Artifact no longer matches external authority');
        seen.add(relative);
      }
    }
  }
  visit(artifact);
  for (const [name, entry] of entries) if (entry.required && !seen.has(name)) fail('Missing trusted artifact file');
  if (stableRead(`${artifact}/.release-source-sha`).toString() !== `${record.sourceSha}\n` || stableRead(`${artifact}/.release-runtime-scope`).toString() !== `${scope}\n`) fail('Invalid exact runtime scope/source metadata');
  return manifestPath;
}

function current() {
  const appExists = fs.existsSync(APP) || fs.lstatSync(APP, { throwIfNoEntry: false });
  if (!fs.existsSync(CURRENT)) {
    if (appExists) fail('Active runtime release has no independent deploy authority');
    return null;
  }
  owned(CURRENT);
  const pointer = JSON.parse(stableRead(CURRENT, true));
  const record = readRecord(pointer.id);
  if (JSON.stringify(record) !== JSON.stringify(pointer)) fail('Active authority mismatch');
  attestTree(APP, record);
  return record;
}

// Read-only use of the same sealed active-tree authority used by deployment.


function renderEnvironment(source) {
  if (!source || typeof source !== 'object' || Object.keys(source).some(key => !SECRET_INPUT_KEYS.includes(key))) fail('Invalid runtime credential input keys');
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f'"\\\\`]/.test(value)) fail('Invalid runtime environment value');
    result[key] = value;
  }
  for (const key of SECRET_INPUT_KEYS.filter(key => !key.startsWith('MYSQL_') && !['PUPPETEER_EXECUTABLE_PATH','NEXT_PUBLIC_BASE_URL'].includes(key))) {
    if (!result[key]) fail('Missing required runtime credential');
  }
  return { ...result, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    INTERNAL_BASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_BASE_URL: result.NEXT_PUBLIC_BASE_URL ?? 'https://dashboards.adreports.ru' };
}

function parseRuntimeSecrets(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) fail('Invalid credential file');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.endsWith('\n')) fail('Invalid credential file');
    const source = {};
    for (const line of text.slice(0, -1).split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\u0000-\u001f\u007f]*)'$/.exec(line);
      if (!match || !SECRET_INPUT_KEYS.includes(match[1]) || Object.hasOwn(source, match[1])) fail('Invalid credential file');
      source[match[1]] = match[2];
    }
    renderEnvironment(source);
    return source;
  } catch { fail('Missing or unsafe dedicated runtime credential file'); }
}

function serializeRuntimeSecrets(source) {
  renderEnvironment(source);
  const bytes = Buffer.from(Object.entries(source).map(([key, value]) => `${key}='${value}'\n`).join(''));
  parseRuntimeSecrets(bytes);
  return bytes;
}

function readRuntimeSecrets() {
  try {
    const filename = `${BASE}/.dashboard-${scope}-secrets/runtime.env`;
    owned(path.dirname(filename), true);
    if (fs.lstatSync(path.dirname(filename)).mode & 0o077) fail('Unsafe credential directory');
    owned(filename);
    if (fs.lstatSync(filename).size > 65536) fail('Oversized credential file');
    const bytes = stableRead(filename, true);
    return parseRuntimeSecrets(bytes);
  } catch { fail('Missing or unsafe dedicated runtime credential file'); }
}

const commandEnv = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir(), PM2_HOME: path.join(os.homedir(), '.pm2') });
function releaseCommandEnvironment(record) {
  if (!record || !ID.test(record.id) || !SHA.test(record.sourceSha) || record.scope !== scope) fail('Invalid PM2 release binding');
  return { RUNTIME_RELEASE_ID: record.id, RUNTIME_RELEASE_SOURCE_SHA: record.sourceSha };
}
function command(bin, args, record) {
  const env = { ...commandEnv(), ...(record ? releaseCommandEnvironment(record) : {}) };
  try { return execFileSync(bin, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch { fail('runtime operating system command failed'); }
}

function assertRuntimeProcess(processes, account, readStatus = filename => fs.readFileSync(filename, 'utf8'), readCwd = filename => fs.realpathSync(filename)) {
  const matches = processes.filter(item => item.name === `dashboard-${scope}`);
  if (matches.length !== 1 || !Number.isInteger(matches[0].pid) || matches[0].pid <= 0) fail('Runtime process identity mismatch');
  const status = readStatus(`/proc/${matches[0].pid}/status`);
  for (const [field, expected] of [['Uid', account.uid], ['Gid', account.gid]]) {
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`, 'm').exec(status);
    if (!match || match.slice(1).some(value => Number(value) !== expected)) fail('Runtime process identity mismatch');
  }
  if (readCwd(`/proc/${matches[0].pid}/cwd`) !== `${APP}/apps/${scope}`) fail('Runtime process is not in the active directory');
}

// Application code is reached only after the fixed OS privilege drop and this
// trusted bootstrap attest the kernel identity. The privileged parent retains
// private manifest access; none of its credentials or authority paths are passed.
function normalizeBootEnvironment(env) {
  // The pinned amd64 execution runtime inserts this exact libuv opt-out even
  // after env -i. No other inherited or runtime-created setting is tolerated.
  if (Object.hasOwn(env, 'UV_USE_IO_URING')) {
    if (env.UV_USE_IO_URING !== '0') throw new Error('runtime boot environment mismatch');
    delete env.UV_USE_IO_URING;
  }
  if (Object.keys(env).sort().join(',') !== 'HOSTNAME,NODE_ENV,PORT' || env.NODE_ENV !== 'production' || env.HOSTNAME !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(env.PORT) || Number(env.PORT) > 65535) throw new Error('runtime boot environment mismatch');
}

const BOOT_IDENTITY_BOOTSTRAP = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [uidText, gidText, server] = process.argv.slice(1);
const uid = Number(uidText), gid = Number(gidText);
const status = fs.readFileSync('/proc/self/status', 'utf8');
const groups = /^Groups:[\t ]*([^\r\n]*)$/m.exec(status)?.[1].trim();
for (const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) {
  if (!new RegExp('^' + name + ':[\\t ]*0+$', 'm').test(status)) throw new Error('runtime boot capabilities were retained');
}
if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0 ||
    process.getuid() !== uid || process.geteuid() !== uid || process.getgid() !== gid || process.getegid() !== gid ||
    groups !== '' || !/^NoNewPrivs:[\t ]*1$/m.test(status) ||
    process.getgroups().some(group => group !== gid) || fs.realpathSync(process.cwd()) !== path.dirname(server)) {
  throw new Error('runtime boot privilege identity mismatch');
}
fs.writeSync(3, JSON.stringify({uid,gid,euid:process.geteuid(),egid:process.getegid(),supplementaryGroups:[],cwd:fs.realpathSync(process.cwd())}) + '\n');
fs.closeSync(3);
(${normalizeBootEnvironment.toString()})(process.env);
require(server);
`;

function attestBootProcess(pid, account, cwd) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  for (const [key, expected] of [['Uid', account.uid], ['Gid', account.gid]]) {
    const values = new RegExp(`^${key}:[\\t ]*(\\d+)[\\t ]+(\\d+)[\\t ]+(\\d+)[\\t ]+(\\d+)$`, 'm').exec(status);
    if (!values || values.slice(1).some(value => Number(value) !== expected)) fail('runtime boot kernel identity mismatch');
  }
  if (!/^Groups:[\t ]*$/m.test(status) || !/^NoNewPrivs:[\t ]*1$/m.test(status) || fs.realpathSync(`/proc/${pid}/cwd`) !== cwd) fail('runtime boot kernel groups/cwd mismatch');
  for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) if (!new RegExp(`^${name}:[\\t ]*0+$`, 'm').test(status)) fail('runtime boot kernel capabilities mismatch');
}

async function bootRuntimeAsService(artifact) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || process.geteuid() !== 0) fail('runtime service boot requires a privileged Linux verifier');
  const account = realPlatform.account();
  if (!Number.isInteger(account.uid) || account.uid <= 0 || !Number.isInteger(account.gid) || account.gid <= 0) fail('Invalid fixed service-account identity');
  // No environment or positional argument can replace the reviewed mechanism.
  const mechanism = '/usr/bin/setpriv';
  const environmentBoundary = '/usr/bin/env';
  owned(mechanism); owned(environmentBoundary); owned(process.execPath);
  const cwd = `${artifact}/apps/${scope}`, server = `${cwd}/server.js`;
  owned(artifact, true); owned(cwd, true); owned(server);
  const port = await new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close(error => error ? reject(error) : resolve(port));
    });
  });
  const child = spawn(mechanism, [
    `--reuid=${account.uid}`, `--regid=${account.gid}`, '--clear-groups', '--no-new-privs',
    '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--',
    environmentBoundary, '-i', 'NODE_ENV=production', 'HOSTNAME=127.0.0.1', `PORT=${port}`,
    process.execPath, '--input-type=commonjs', '-e', BOOT_IDENTITY_BOOTSTRAP, String(account.uid), String(account.gid), server,
  ], { cwd, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
  let childError = false, message = '', identity;
  child.once('error', () => { childError = true; });
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stdio[3].on('data', chunk => {
    message += chunk.toString('utf8');
    if (message.length > 4096) { childError = true; return; }
    if (!message.endsWith('\n')) return;
    try {
      const value = JSON.parse(message);
      if (value.uid !== account.uid || value.euid !== account.uid || value.gid !== account.gid || value.egid !== account.gid ||
          !Array.isArray(value.supplementaryGroups) || value.supplementaryGroups.length || value.cwd !== cwd) fail('Boot identity mismatch');
      identity = value;
    } catch { childError = true; }
  });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && child.exitCode === null && !childError) {
      if (identity) {
        attestBootProcess(child.pid, account, cwd);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
          const body = await response.text();
          if (response.status === 503 && body.length < 1024 && isDeepStrictEqual(JSON.parse(body), { ok: false, scope, database: "disconnected" })) {
            attestBootProcess(child.pid, account, cwd);
            return identity;
          }
        } catch { /* A bounded startup retry; never display child output. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fail('runtime unprivileged boot identity/health check failed');
  } finally {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 1000);
    await closed;
    clearTimeout(force);
  }
}

async function verifyStagedArtifact(artifact, manifest, boot) {
  const code = `${path.dirname(manifest)}/scripts/runtime-artifact-policy.mjs`;
  const args = [code, `${scope}`, artifact, '--trusted-manifest', manifest];
  command(process.execPath, args);
  if (boot) {
    await bootRuntimeAsService(artifact);
    command(process.execPath, args);
  }
}

let abbottDeploymentProtection;
const realPlatform = {
  deploymentPreflight(notePhase) {
    if(scope!=='abbott'||!browserPrerequisite)fail('Abbott deployment preflight unavailable');
    abbottDeploymentProtection=createAbbottDeploymentProof({
      notePhase,
      validateNginx:validateAbbottNginxOwnershipText,
      verifyActive:record=>{if(!isDeepStrictEqual(current(),record))fail('Abbott active checkpoint drift');},
      verifyBrowser:()=>browserPrerequisite.verifyBrowserInstallation({contract:browserPrerequisite.contract,gid:984,checkExecutable:executable=>{
        // Existing immutable root:Abbott modes grant UID982 access without
        // launching any process before the complete preflight has succeeded.
        const s=fs.lstatSync(executable);return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===0&&s.gid===984&&(s.mode&0o7777)===0o750&&fs.realpathSync(executable)===executable;
      }}),
    });
    abbottDeploymentProtection.preflight();
  },
  assertDeploymentPerimeter() {
    if(!abbottDeploymentProtection)fail('Abbott deployment preflight unavailable');
    abbottDeploymentProtection.perimeter();
  },
  browser(account) {
    if(scope!=='abbott'||!browserPrerequisite)fail('Abbott browser prerequisite missing');
    return browserPrerequisite.verifyBrowserInstallation({contract:browserPrerequisite.contract,gid:account.gid,checkExecutable:executable=>{
      try {
        const script="const fs=require('node:fs');process.setgroups([]);process.setgid("+account.gid+");process.setuid("+account.uid+");fs.accessSync("+JSON.stringify(executable)+",fs.constants.R_OK|fs.constants.X_OK);";
        execFileSync('/usr/bin/node',['-e',script],{cwd:'/',env:{},stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:1024});return true;
      }catch{return false;}
    }}).executable;
  },
  account() {
    const uid = Number(command('/usr/bin/id', ['-u', `dashboard-${scope}`]).trim());
    const groups = command('/usr/bin/id', ['-G', `dashboard-${scope}`]).trim().split(/\s+/).map(Number);
    const group = command('/usr/bin/getent', ['group', `dashboard-${scope}`]).trim().split(':');
    const gid = Number(group[2]);
    if (groups.some(value => value === 0) || group[0] !== `dashboard-${scope}` || groups.length !== 1 || groups[0] !== gid) fail('Runtime service account must have only its dedicated group');
    return { uid, gid };
  },
  chown: (filename, uid, gid) => fs.chownSync(filename, uid, gid),
  verify: verifyStagedArtifact,
  secrets: readRuntimeSecrets,
  async start(control) {
    const launcher = `${BASE}/.dashboard-${scope}-launcher.cjs`;
    const source = `${control}/deploy/${scope}/start.cjs`;
    if (fs.existsSync(launcher)) {
      owned(launcher);
      if (!stableRead(launcher).equals(stableRead(source))) fail('Launcher change requires separately reviewed process transition');
    } else createFile(launcher, stableRead(source), 0o644);
    const record = readRecord(path.basename(control));
    if (control !== `${CONTROL}/${record.id}`) fail('Invalid PM2 release control');
    // PM2 retains this protected release binding in its registration. The
    // launcher clears inherited metadata before loading the application env.
    command('pm2', ['startOrReload', `${control}/deploy/${scope}/ecosystem.config.cjs`, '--only', appName, '--update-env'], record);
  },
  async startFresh(control) {
    if(scope!=='abbott'||realPlatform.registration()!==null)fail('Fresh Abbott registration requires absence');
    const record=readRecord(path.basename(control));
    if(control!==`${CONTROL}/${record.id}`)fail('Invalid PM2 release control');
    const launcher=`${BASE}/.dashboard-${scope}-launcher.cjs`,source=`${control}/deploy/${scope}/start.cjs`;
    if(fs.existsSync(launcher)){owned(launcher);if(!stableRead(launcher).equals(stableRead(source)))fail('Launcher transition requires review');}
    else createFile(launcher,stableRead(source),0o644);
    if(realPlatform.registration()!==null)fail('Fresh Abbott registration requires absence');
    command('pm2',['start',`${control}/deploy/${scope}/ecosystem.config.cjs`,'--only',appName],record);
  },
  async delete(pmId) {
    if(scope!=='abbott'||!Number.isSafeInteger(pmId)||pmId<0)fail('Owned Abbott registration required');
    command('pm2',['delete',String(pmId)]);
  },
  exited(proof) {
    if(!proof||!Number.isSafeInteger(proof.pid)||proof.pid<=0)fail('Owned process proof required');
    if(fs.lstatSync(`/proc/${proof.pid}`,{throwIfNoEntry:false}))fail('Owned process exit not verified');
  },
  registration(pmId) {
    const matches = JSON.parse(command('pm2', ['jlist'])).filter(row => row.pm_id === pmId || row.name === appName);
    if (!matches.length) return null;
    const registration = captureRuntimeRegistration(matches, realPlatform.account());
    return { registration, pid: matches[0].pid, status: matches[0].pm2_env.status };
  },
  snapshot() {
    const matches = JSON.parse(command('pm2',['jlist'])).filter(row=>row.name===`dashboard-${scope}`);
    if (!matches.length || matches.length===1 && matches[0].pid===0 && matches[0].pm2_env?.status==='stopped') return null;
    const proof=captureRuntimeIdentity(matches,realPlatform.account(),filename=>fs.readFileSync(filename,'utf8'),filename=>fs.realpathSync(filename));
    const second=JSON.parse(command('pm2',['jlist'])).filter(row=>row.name===`dashboard-${scope}`);
    if(second.length!==1||second[0].pid!==proof.pid||second[0].pm_id!==proof.pmId)fail('Runtime identity changed');
    return proof;
  },
  async stop(pmId) {
    if(!Number.isSafeInteger(pmId)||pmId<0)fail('Owned PM2 identity required');
    command('pm2', ['stop', String(pmId)]);
  },
  async assertNoListener() {
    if (command('ss', ['-ltnpH', `( sport = :${port} )`]).trim()) fail('Candidate listener remains after shutdown');
  },
  async health(proof) {
    let healthy = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!isDeepStrictEqual(realPlatform.snapshot(), proof)) fail('Runtime identity changed during readiness');
      try {
        assertRuntimeListener(proof, command('ss', ['-ltnpH', `( sport = :${port} )`]));
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        if (response.status === 200 && isDeepStrictEqual(body, { ok: true, scope, database: "connected" })) { healthy = true; break; }
      } catch { /* Retry startup only; no response bodies or env diagnostics. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!healthy) fail('runtime health attestation failed');
    if (!isDeepStrictEqual(realPlatform.snapshot(), proof)) fail('Runtime identity changed after readiness');
    assertRuntimeListener(proof, command('ss', ['-ltnpH', `( sport = :${port} )`]));
  },
};

function validateRuntimeRegistration(value, account) {
  const launcherArgs = ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', `${BASE}/.dashboard-${scope}-launcher.cjs`];
  if (!value || Object.keys(value).sort().join(',') !== 'appName,args,cwd,exec,gid,pmId,releaseId,sourceSha,uid' ||
      value.appName !== appName || !Number.isSafeInteger(value.pmId) || value.pmId < 0 || value.exec !== '/usr/bin/env' || value.cwd !== `${APP}/apps/${scope}` ||
      ![appName, account.uid].includes(value.uid) || ![appName, account.gid].includes(value.gid) || !ID.test(value.releaseId) || !SHA.test(value.sourceSha) ||
      !Array.isArray(value.args) || value.args.length !== launcherArgs.length || value.args.some((arg, index) => arg !== launcherArgs[index])) fail('Runtime registration identity mismatch');
  return value;
}

function captureRuntimeRegistration(processes, account) {
  if (processes.length !== 1 || processes[0].name !== appName) fail('Runtime registration identity mismatch');
  const row = processes[0], env = row.pm2_env;
  return validateRuntimeRegistration({ appName: row.name, pmId: row.pm_id, exec: env?.pm_exec_path, cwd: env?.pm_cwd,
    args: Array.isArray(env?.args) ? Array.from(env.args) : null, uid: env?.uid, gid: env?.gid,
    releaseId: env?.RUNTIME_RELEASE_ID, sourceSha: env?.RUNTIME_RELEASE_SOURCE_SHA }, account);
}

function captureRuntimeIdentity(processes,account,readText,readCwd) {
  const registration = captureRuntimeRegistration(processes, account);
  assertRuntimeProcess(processes,account,readText,readCwd);
  const process=processes[0];
  const script = registration.args[3];
  // Next changes process.title and therefore Linux argv memory. PM2 retains
  // the exact launch command independently of that mutable process title.
  const stat=()=>{const text=readText(`/proc/${process.pid}/stat`),close=text.lastIndexOf(')');const fields=text.slice(close+2).trim().split(/\s+/);if(close<0||!/^\d+$/.test(fields[19]??''))fail('Runtime start identity mismatch');return fields[19];};
  const startTime=stat(),bootId=readText('/proc/sys/kernel/random/boot_id').trim();
  if(!/^[a-f0-9-]{36}$/.test(bootId))fail('Runtime boot identity mismatch');
  const sourceSha = readText(`${APP}/.release-source-sha`).trim();
  if (!SHA.test(sourceSha) || sourceSha !== registration.sourceSha) fail('Runtime source identity mismatch');
  assertRuntimeProcess(processes,account,readText,readCwd);
  if(stat()!==startTime)fail('Runtime PID reused');
  return {appName,pid:process.pid,pmId:process.pm_id,startTime,bootId,uid:account.uid,gid:account.gid,cwd:readCwd(`/proc/${process.pid}/cwd`),script,sourceSha,registration};
}

function assertRuntimeListener(proof, listeners) {
  const rows = listeners.trim().split('\n');
  if (!proof || rows.length !== 1 || rows[0].trim().split(/\s+/)[3] !== `127.0.0.1:${port}` ||
      !rows[0].includes(`pid=${proof.pid},`) || [...rows[0].matchAll(/pid=(\d+)/g)].some(match => Number(match[1]) !== proof.pid)) fail('Runtime listener ownership mismatch');
}

function bindingValid(binding) {
  if(!binding||Object.keys(binding).sort().join(',')!=='runId,sourceSha'||!SHA.test(binding.sourceSha)||!UUID.test(binding.runId))fail('Invalid deployment ownership binding');
}
function processProof(platform,account) {
  const value=platform.snapshot();
  if(value===null)return null;
  if(!value||Object.keys(value).sort().join(',')!=='appName,bootId,cwd,gid,pid,pmId,registration,script,sourceSha,startTime,uid'||value.appName!==appName||!Number.isSafeInteger(value.pid)||value.pid<=0||!Number.isSafeInteger(value.pmId)||value.pmId<0||!/^\d+$/.test(value.startTime)||!/^[a-f0-9-]{36}$/.test(value.bootId)||value.uid!==account.uid||value.gid!==account.gid||value.cwd!==`${APP}/apps/${scope}`||value.script!==`${BASE}/.dashboard-${scope}-launcher.cjs`||!SHA.test(value.sourceSha))fail('Invalid deployment process ownership');
  validateRuntimeRegistration(value.registration, account);
  if (value.registration.pmId !== value.pmId || value.registration.sourceSha !== value.sourceSha) fail('Process/registration binding mismatch');
  return value;
}
const directoryIdentity=()=>{owned(APP,true);const stat=fs.lstatSync(APP);return {dev:String(stat.dev),ino:String(stat.ino)};};
function durableFile(filename,value) {
  createFile(filename,JSON.stringify(value)+'\n');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
async function stopProof(proof,platform,account,guard) {
  if(!proof)fail('No owned deployment process');
  return stopRegistration(proof.registration, proof, platform, account, guard);
}
async function stopRegistration(registration, proof, platform, account, guard, beforeStop) {
  guard();
  validateRuntimeRegistration(registration, account);
  const active = platform.registration(registration.pmId);
  if(beforeStop&&(!active||active.status!=='online'||active.pid!==proof?.pid))fail('Predecessor disappeared before stop');
  if (active !== null) {
    if (!isDeepStrictEqual(active.registration, registration)) fail('PM2 registration ownership changed; no stop');
    if (Number.isSafeInteger(active.pid) && active.pid > 0) {
      const live = processProof(platform, account);
      if (!live || live.pid !== active.pid || !isDeepStrictEqual(live.registration, registration) ||
          proof && !isDeepStrictEqual(live, proof)) fail('Deployment ownership changed; no stop');
    } else if (active.pid !== 0 || !['errored', 'waiting restart', 'launching', 'stopping', 'stopped'].includes(active.status)) fail('Unproven PM2 inactive registration; no stop');
    if (active.pid !== 0 || active.status !== 'stopped') { beforeStop?.(); await platform.stop(registration.pmId); }
    const stopped = platform.registration(registration.pmId);
    if (stopped !== null && (!isDeepStrictEqual(stopped.registration, registration) || stopped.pid !== 0 || stopped.status !== 'stopped')) fail('Owned PM2 registration did not stop');
  }
  await platform.assertNoListener();
}
async function stopOwned(binding,platform,account,guard) {
  bindingValid(binding);
  const filename=`${CONTROL}/ownership-${binding.runId}.json`;
  if(!fs.lstatSync(filename,{throwIfNoEntry:false}))return {passed:true,stopped:false};
  owned(filename);const stat=fs.lstatSync(filename);
  if(stat.gid!==DEPLOY_GID||(stat.mode&0o7777)!==0o600||stat.size>8192)fail('Unsafe deployment receipt');
  const receipt=JSON.parse(stableRead(filename,true));
  if(Object.keys(receipt).sort().join(',')!=='binding,directory,process,record,transaction,version'||receipt.version!==1||!UUID.test(receipt.transaction)||!isDeepStrictEqual(receipt.binding,binding)||receipt.record?.sourceSha!==binding.sourceSha||!isDeepStrictEqual(current(),receipt.record)||!isDeepStrictEqual(directoryIdentity(),receipt.directory))fail('Deployment receipt no longer owns active release');
  attestTree(APP,receipt.record);
  await stopProof(receipt.process,platform,account,guard);
  return {passed:true,stopped:true};
}

function publishPointer(record) {
  const temporary = `${CONTROL}/current-${randomUUID()}.json`;
  createFile(temporary, JSON.stringify(record));
  fs.renameSync(temporary, CURRENT);
}

function materialize(payload, id, old, platform, account, browserExecutable) {
  if (!payload || payload.scope !== `${scope}` || !SHA.test(payload.sourceSha) || !DIGEST.test(payload.manifestDigest) || hash(payload.manifest) !== payload.manifestDigest) fail('Invalid trusted payload source/scope/digest');
  const manifest = JSON.parse(payload.manifest);
  if (manifest.scope !== `${scope}` || manifest.sourceSha !== payload.sourceSha) fail('Payload source/scope binding failed');
  const control = `${CONTROL}/${id}`, stage = `${RELEASES}/${id}`;
  fs.mkdirSync(control, { mode: 0o700 }); fs.mkdirSync(stage, { mode: 0o755 }); fs.chmodSync(stage, 0o755);
  createFile(`${control}/trusted-runtime-manifest.json`, payload.manifest);
  createFile(`${control}/trusted-runtime-manifest.json.sha256`, payload.manifestDigest + '\n');
  for (const file of payload.control) {
    safeRelative(file.path);
    if (file.path === 'trusted-runtime-manifest.json' || file.path === 'record.json') fail('Control authority substitution');
    createFile(`${control}/${file.path}`, Buffer.from(file.data, 'base64'));
  }
  for (const file of payload.files) {
    safeRelative(file.path);
    if (file.path === '.env' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || file.mode & 0o022) fail('Unsafe packaged environment or mode');
    createFile(`${stage}/${file.path}`, Buffer.from(file.data, 'base64'), file.mode);
  }
  const env = renderEnvironment(platform.secrets(control));
  if(scope==='abbott')env.PUPPETEER_EXECUTABLE_PATH=browserExecutable;
  createFile(`${stage}/.env`, Object.entries(env).map(([key, value]) => `${key}='${value}'\n`).join(''), 0o640);
  platform.chown(`${stage}/.env`, DEPLOY_UID, account.gid);
  const record = { id, previousId: old?.id ?? null, scope: `${scope}`, sourceSha: payload.sourceSha, manifestDigest: payload.manifestDigest };
  createFile(`${control}/record.json`, JSON.stringify(record));
  return { record, stage };
}

// Abbott changes registration rather than asking PM2 to merge retained env.
// Every destructive command is addressed by a freshly re-proven registration.
async function activateAbbott({request,record,stage,envDigest,old,beforeProcess,owner,platform,account,guard,preserveLock,terminal}) {
  const phase=(value,reason='failed')=>{if(terminal){terminal.phase=value;terminal.reason=reason;}};
  phase('activation_precheck');
  const perimeter=()=>{const previous=terminal?.phase,reason=terminal?.reason;platform.assertDeploymentPerimeter();phase(previous,reason);};
  const oldBackup=old?`${BACKUPS}/${old.id}`:null;
  const journalPath=`${CONTROL}/activation-${owner}.json`;
  const dir=p=>{owned(p,true);const s=fs.lstatSync(p);return{dev:String(s.dev),ino:String(s.ino)};};
  const absent=p=>{if(fs.lstatSync(p,{throwIfNoEntry:false}))fail('Activation path collision');};
  const sameDir=(p,d)=>{if(!isDeepStrictEqual(dir(p),d))fail('Activation directory identity changed');};
  const candidateDirectory=dir(stage),oldDirectory=old?dir(APP):null;
  const originalPointer=old?stableRead(CURRENT,true):null,oldEnv=old?hash(stableRead(`${APP}/.env`)):null;
  let mutated=false,oldMoved=false,candidateMoved=false,startAttempted=false,ownedRegistration=null,ownedProcess=null,pointerPublished=false;
  const lockProof=()=>{owned(LOCK,true);const s=fs.lstatSync(LOCK);if(s.gid!==0||(s.mode&0o7777)!==0o700||stableRead(`${LOCK}/owner`,true).toString()!==owner||fs.readdirSync(LOCK).join()!=='owner')fail('Activation lock drift');};
  const pointerProof=()=>{
    if(pointerPublished){if(!stableRead(CURRENT,true).equals(Buffer.from(JSON.stringify(record))))fail('Activation pointer drift');}
    else if(originalPointer){if(!stableRead(CURRENT,true).equals(originalPointer))fail('Activation pointer drift');}
    else absent(CURRENT);
  };
  const tree=(p,r,d,digest)=>{
    sameDir(p,d);if(!isDeepStrictEqual(readRecord(r.id),r))fail('Activation record drift');attestTree(p,r);
    const s=fs.lstatSync(`${p}/.env`);if(!s.isFile()||s.nlink!==1||s.uid!==0||s.gid!==account.gid||(s.mode&0o7777)!==0o640||hash(stableRead(`${p}/.env`))!==digest)fail('Activation environment drift');
  };
  const journal=state=>{
    lockProof();const next=journalPath+'.next';absent(next);
    if(fs.existsSync(journalPath)){owned(journalPath);const s=fs.lstatSync(journalPath);if(s.gid!==0||(s.mode&0o7777)!==0o600)fail('Activation journal drift');const prior=JSON.parse(stableRead(journalPath,true));if(prior.owner!==owner)fail('Activation journal drift');}
    durableFile(next,{version:1,owner,state,predecessor:old, candidate:record,stage,oldDirectory,candidateDirectory});fs.renameSync(next,journalPath);
  };
  const checkpoint=async()=>{await new Promise(resolve=>setTimeout(resolve,0));guard();lockProof();pointerProof();};
  const noRegistration=async()=>{if(platform.registration()!==null)fail('Abbott registration remains');await platform.assertNoListener();};
  const remove=async(registration,proof,checkPerimeter=false)=>{
    // Pointer drift forbids layout compensation, but cannot keep an otherwise
    // exactly owned candidate serving. Process identity remains mandatory.
    lockProof();
    await stopRegistration(registration,proof,platform,account,lockProof,checkPerimeter?()=>{
      perimeter();provePredecessor();
    }:undefined);
    if(proof)platform.exited(proof);
    const stopped=platform.registration(registration.pmId);
    if(stopped!==null){
      if(!isDeepStrictEqual(stopped.registration,registration)||stopped.pid!==0||stopped.status!=='stopped')fail('Abbott deletion ownership changed');
      lockProof();
      if(!isDeepStrictEqual(platform.registration(registration.pmId),stopped))fail('Abbott deletion ownership changed');
      await platform.delete(registration.pmId);
    }
    await noRegistration();if(proof)platform.exited(proof);
  };
  const capture=(requireOnline=false)=>{
    const candidate=platform.registration();if(candidate===null){if(requireOnline)fail('Candidate registration disappeared');return;}
    validateRuntimeRegistration(candidate.registration,account);
    if(candidate.registration.releaseId!==record.id||candidate.registration.sourceSha!==record.sourceSha||ownedRegistration&&!isDeepStrictEqual(candidate.registration,ownedRegistration))fail('New deployment registration was not established');
    ownedRegistration=candidate.registration;
    if(Number.isSafeInteger(candidate.pid)&&candidate.pid>0){
      const proof=processProof(platform,account);
      if(!proof||proof.pid!==candidate.pid||!isDeepStrictEqual(proof.registration,ownedRegistration)||beforeProcess&&proof.pid===beforeProcess.pid||ownedProcess&&!isDeepStrictEqual(proof,ownedProcess))fail('New deployment process was not established');
      ownedProcess=proof;
      if(requireOnline&&candidate.status!=='online')fail('New deployment process is not online');
    }else if(requireOnline||candidate.pid!==0||!['errored','waiting restart','launching','stopping','stopped'].includes(candidate.status))fail('New deployment inactive identity mismatch');
  };
  const before=async()=>{
    lockProof();pointerProof();tree(stage,record,candidateDirectory,envDigest);
    if(old){
      tree(APP,old,oldDirectory,oldEnv);absent(oldBackup);
      if(!beforeProcess||platform.registration(beforeProcess.pmId)?.status!=='online'||beforeProcess.sourceSha!==old.sourceSha||beforeProcess.registration.releaseId!==old.id||!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Predecessor process identity mismatch');
      await platform.health(beforeProcess);
      if(!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Predecessor process identity changed');
    }else{absent(APP);await noRegistration();}
  };
  const provePredecessor=()=>{
    lockProof();pointerProof();
    if(old){
      tree(APP,old,oldDirectory,oldEnv);absent(oldBackup);
      const present=platform.registration(beforeProcess?.pmId);
      if(!beforeProcess||!present||present.status!=='online'||present.pid!==beforeProcess.pid||!isDeepStrictEqual(present.registration,beforeProcess.registration)||!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Predecessor disappeared before activation');
    }else{absent(APP);if(platform.registration()!==null)fail('Unexpected registration before activation');}
  };
  try{
    await before();await checkpoint();await before();
    // No activation write or process/layout operation precedes this marker.
    // A missing registration is refusal, never an implicit successful stop.
    guard();provePredecessor();perimeter();provePredecessor();
    mutated=true;if(terminal)terminal.status='UNACKNOWLEDGED';
    journal('prepared');await checkpoint();
    phase('activation_stop');
    if(old)await remove(beforeProcess.registration,beforeProcess,true);
    else await noRegistration();
    journal('predecessor_removed');await checkpoint();
    await noRegistration();
    if(old){tree(APP,old,oldDirectory,oldEnv);absent(oldBackup);if(platform.registration()!==null)fail('Abbott registration reappeared');fs.renameSync(APP,oldBackup);oldMoved=true;}
    tree(stage,record,candidateDirectory,envDigest);absent(APP);if(platform.registration()!==null)fail('Abbott registration reappeared');fs.renameSync(stage,APP);candidateMoved=true;
    journal('candidate_active');await checkpoint();tree(APP,record,candidateDirectory,envDigest);await noRegistration();
    phase('activation_start');startAttempted=true;let startFailed=false;try{await platform.startFresh(`${CONTROL}/${record.id}`);}catch{startFailed=true;}
    capture(true);if(startFailed||!ownedProcess)fail('New deployment process was not established');
    journal('candidate_started');phase('candidate_health');await checkpoint();await platform.health(ownedProcess);await checkpoint();
    capture(true);tree(APP,record,candidateDirectory,envDigest);
    if(!isDeepStrictEqual(processProof(platform,account),ownedProcess))fail('Candidate readiness identity changed');
    if(old)tree(oldBackup,old,oldDirectory,oldEnv);
    await checkpoint();await platform.health(ownedProcess);capture(true);pointerProof();
    perimeter();phase('pointer');publishPointer(record);pointerPublished=true;
    if(request.binding)durableFile(`${CONTROL}/ownership-${request.binding.runId}.json`,{version:1,binding:request.binding,transaction:owner,record,directory:directoryIdentity(),process:ownedProcess});
    await checkpoint();capture(true);tree(APP,record,candidateDirectory,envDigest);journal('committed');return record;
  }catch{
    if(!mutated)fail('Abbott activation refused before process mutation');
    phase('compensation');
    try{
      // Cancellation cannot disable identity checks or the bounded compensation.
      lockProof();
      if(startAttempted){if(!ownedRegistration)capture();if(ownedRegistration)await remove(ownedRegistration,ownedProcess);else await noRegistration();}
      else if(old)await remove(beforeProcess.registration,beforeProcess);else await noRegistration();
      pointerProof();
      if(candidateMoved){tree(APP,record,candidateDirectory,envDigest);absent(stage);fs.renameSync(APP,stage);candidateMoved=false;}
      if(oldMoved){tree(oldBackup,old,oldDirectory,oldEnv);absent(APP);fs.renameSync(oldBackup,APP);oldMoved=false;}
      if(old){
        tree(APP,old,oldDirectory,oldEnv);
        if(pointerPublished){const next=`${CONTROL}/current-${randomUUID()}.json`;createFile(next,originalPointer);fs.renameSync(next,CURRENT);pointerPublished=false;}
        pointerProof();await noRegistration();
        let failed=false;try{await platform.startFresh(`${CONTROL}/${old.id}`);}catch{failed=true;}
        const restored=platform.registration();
        if(!restored||restored.registration.releaseId!==old.id||restored.registration.sourceSha!==old.sourceSha)fail('Predecessor restart ownership requires review');
        const live=Number.isSafeInteger(restored.pid)&&restored.pid>0?processProof(platform,account):null;
        try{
          if(failed||!live||restored.status!=='online'||live.registration.releaseId!==old.id||live.sourceSha!==old.sourceSha)fail('Predecessor restart failed');
          await platform.health(live);tree(APP,old,oldDirectory,oldEnv);pointerProof();perimeter();
          if(!isDeepStrictEqual(processProof(platform,account),live)||!isDeepStrictEqual(current(),old))fail('Predecessor restart identity changed');
          perimeter();
        }catch{await remove(restored.registration,live);throw Error();}
      }else{absent(APP);if(pointerPublished){owned(CURRENT);fs.unlinkSync(CURRENT);pointerPublished=false;}await noRegistration();}
      if(!old)perimeter();journal('restored');if(terminal)terminal.status='RESTORED';fail(old?'runtime activation failed; attested predecessor restored':'runtime activation failed; service stopped');
    }catch(error){
      if(error.message==='runtime activation failed; attested predecessor restored'||error.message==='runtime activation failed; service stopped')throw error;
      preserveLock();try{journal('review_required');if(terminal)terminal.status='REVIEW_REQUIRED';}catch{}
      fail('runtime activation and predecessor restoration failed; ownership requires review');
    }
  }finally{originalPointer?.fill(0);}
}

async function transact(request, platform = realPlatform, stagedGuard, terminal) {
  // The worker is supplied by the exact clean release source, never by remote disk.
  const guard = stagedGuard ?? (() => {});
  const phase=(value,reason='failed')=>{if(terminal){terminal.phase=value;terminal.reason=reason;}};
  guard();
  if(scope==='abbott'){
    phase('preflight_current');platform.deploymentPreflight(phase);
    guard();
    phase('lock');
    if(fs.lstatSync(LOCK,{throwIfNoEntry:false}))fail('runtime deployment lock is already held or unsafe');
    if(request.action==='inspect'){phase('preflight_current');return current();}
  }
  phase('preflight_current');
  if (process.getuid() !== DEPLOY_UID) fail('Privileged deploy account required');
  const account = platform.account();
  if(scope==='abbott'&&platform===realPlatform&&(account.uid!==982||account.gid!==984))fail('Abbott account checkpoint drift');
  if (!Number.isInteger(account.uid) || account.uid <= 0 || account.uid === DEPLOY_UID || !Number.isInteger(account.gid) || account.gid <= 0) fail('Dedicated runtime account and write separation required');
  phase('preflight_browser');const browserExecutable=scope==='abbott'&&['deploy','rollback'].includes(request.action)?platform.browser(account):undefined;
  phase('lock');
  owned(BASE, true);
  const owner = randomUUID();
  let preserveLock=false;
  try { fs.mkdirSync(LOCK, { mode: 0o700 }); } catch { fail('runtime deployment lock is already held or unsafe'); }
  createFile(`${LOCK}/owner`, owner);
  try {
    phase('prepare');
    for (const dir of [RELEASES, BACKUPS, CONTROL]) ensureDirectory(dir, HOST_DIRECTORY_MODES[dir]);
    if(request.action==='stop-owned')return await stopOwned(request.binding,platform,account,guard);
    const old = current();
    if (request.action === 'inspect') return old;
    if ((old?.sourceSha ?? null) !== request.expectedActiveSha) fail('Active runtime SHA changed; recheck source ancestry');
    if (request.action !== 'deploy' && request.action !== 'rollback') fail('Invalid fixed release action');
    if(platform===realPlatform&&request.action==='deploy')bindingValid(request.binding);
    if(request.binding){bindingValid(request.binding);if(request.payload?.sourceSha!==request.binding.sourceSha||fs.lstatSync(`${CONTROL}/ownership-${request.binding.runId}.json`,{throwIfNoEntry:false}))fail('Deployment binding source or run reuse mismatch');}
    const beforeProcess=processProof(platform,account);
    if(!old&&beforeProcess)fail('Unowned process exists before deployment');
    let record, stage;
    if (request.action === 'deploy') ({ record, stage } = materialize(request.payload, randomUUID().replaceAll('-', ''), old, platform, account,browserExecutable));
    else {
      if (!old?.previousId) fail('No attested runtime predecessor');
      record = readRecord(old.previousId); stage = `${BACKUPS}/${record.id}`;
    }
    const manifest = attestTree(stage, record);
    const envDigest = hash(stableRead(`${stage}/.env`));
    // The artifact policy rejects every env file. Runtime credentials are a
    // separate host overlay: park it under protected control while checking and
    // booting the candidate without DB credentials, then restore the exact bytes.
    // This applies equally to fresh candidates and sealed rollback predecessors.
    const parkedEnvironment = `${CONTROL}/${record.id}/verification-${randomUUID()}.env`;
    fs.renameSync(`${stage}/.env`, parkedEnvironment);
    try {
      await platform.verify(stage, manifest, false);
      await platform.verify(stage, manifest, true);
    } finally {
      owned(parkedEnvironment);
      if (fs.lstatSync(`${stage}/.env`, { throwIfNoEntry: false }) || hash(stableRead(parkedEnvironment)) !== envDigest) fail('Runtime environment overlay changed during verification');
      fs.renameSync(parkedEnvironment, `${stage}/.env`);
    }
    guard();
    // Pin is retained in memory from transport (deploy) or protected record (rollback).
    // Replacing both manifest and its sidecar cannot change this activation authority.
    attestTree(stage, record);
    if (hash(stableRead(`${stage}/.env`)) !== envDigest) fail('Runtime environment changed during verification');
    if (old) attestTree(APP, old);
    const oldBackup = old ? `${BACKUPS}/${old.id}` : null;
    if (oldBackup && fs.lstatSync(oldBackup, { throwIfNoEntry: false })) fail('Predecessor backup collision');
    if(scope==='abbott')return await activateAbbott({request,record,stage,envDigest,old,beforeProcess,owner,platform,account,guard,terminal,preserveLock:()=>{preserveLock=true;}});
    let oldMoved = false, candidateMoved = false, startAttempted = false, ownedRegistration = null, ownedProcess = null;
    try {
      if (old) { fs.renameSync(APP, oldBackup); oldMoved = true; }
      fs.renameSync(stage, APP); candidateMoved = true;
      guard();
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during activation');
      startAttempted = true;
      let startFailed = false;
      try { await platform.start(`${CONTROL}/${record.id}`); } catch { startFailed = true; }
      // A command failure or early process exit can still leave a restartable
      // registration. Bind that identity before asking for a live PID/socket.
      const candidate = platform.registration();
      if (candidate !== null) {
        validateRuntimeRegistration(candidate.registration, account);
        if (candidate.registration.sourceSha !== record.sourceSha || candidate.registration.releaseId !== record.id) fail('New deployment registration was not established');
        ownedRegistration = candidate.registration;
        if (Number.isSafeInteger(candidate.pid) && candidate.pid > 0) {
          const candidateProcess = processProof(platform, account);
          if (!candidateProcess || candidateProcess.pid !== candidate.pid || !isDeepStrictEqual(candidateProcess.registration, ownedRegistration) || isDeepStrictEqual(candidateProcess, beforeProcess)) fail('New deployment process was not established');
          ownedProcess = candidateProcess;
        }
      }
      if (startFailed || !ownedProcess) fail('New deployment process was not established');
      await platform.health(ownedProcess);
      attestTree(APP, record);
      if (hash(stableRead(`${APP}/.env`)) !== envDigest) fail('Runtime environment changed during health verification');
      publishPointer(record);
      if(request.binding) {
        if(!isDeepStrictEqual(processProof(platform,account),ownedProcess))fail('Deployment ownership changed after health');
        durableFile(`${CONTROL}/ownership-${request.binding.runId}.json`,{version:1,binding:request.binding,transaction:owner,record,directory:directoryIdentity(),process:ownedProcess});
      }
      return record;
    } catch {
      let rollbackCandidateNeedsRecovery = false;
      try {
        if (candidateMoved && startAttempted) {
          if (ownedRegistration) await stopRegistration(ownedRegistration, ownedProcess, platform, account, guard);
          else {
            if (platform.registration(beforeProcess?.pmId) !== null) fail('Ambiguous startup ownership; no stop');
            await platform.assertNoListener();
          }
        }
        if(candidateMoved&&!startAttempted&&beforeProcess===null&&processProof(platform,account)!==null)fail('Ambiguous startup ownership; no stop');
        if (candidateMoved) {
          // A manual rollback borrows its predecessor from BACKUPS. Return that
          // exact artifact to its authoritative slot so current.previousId stays
          // usable after transient startup/health failures and a retry is safe.
          let destination = `${RELEASES}/${record.id}-failed-${randomUUID()}`;
          if (request.action === 'rollback') {
            try {
              attestTree(APP, record);
              if (hash(stableRead(`${APP}/.env`)) !== envDigest || fs.lstatSync(stage, { throwIfNoEntry: false })) fail('Rollback backup slot is unavailable');
              destination = stage;
            } catch { rollbackCandidateNeedsRecovery = true; }
          }
          owned(APP, true);
          if (fs.lstatSync(destination, { throwIfNoEntry: false })) fail('Recovery destination collision');
          fs.renameSync(APP, destination);
        }
        if (oldMoved) {
          attestTree(oldBackup, old);
          if (fs.lstatSync(APP, { throwIfNoEntry: false })) fail('Active recovery path is occupied');
          fs.renameSync(oldBackup, APP);
          if(!startAttempted&&beforeProcess&&!isDeepStrictEqual(processProof(platform,account),beforeProcess))fail('Ambiguous predecessor identity');
          if(startAttempted||!beforeProcess)await platform.start(`${CONTROL}/${old.id}`);
          const restoredProcess = processProof(platform, account);
          if (!restoredProcess || restoredProcess.sourceSha !== old.sourceSha || restoredProcess.registration.releaseId !== old.id) fail('Restored predecessor process identity mismatch');
          await platform.health(restoredProcess); attestTree(APP, old); publishPointer(old);
        }
      } catch { fail('runtime activation and predecessor restoration failed; ownership requires review'); }
      if (rollbackCandidateNeedsRecovery) fail('Current runtime release restored; rollback backup collision or integrity failure requires recovery');
      fail(old ? 'runtime activation failed; attested predecessor restored' : 'runtime activation failed; service stopped');
    }
  } finally {
    try{
    owned(LOCK, true);
    if (stableRead(`${LOCK}/owner`, true).toString() !== owner || fs.readdirSync(LOCK).join() !== 'owner') fail('runtime lock ownership changed; preserved for recovery');
    if(!preserveLock){fs.unlinkSync(`${LOCK}/owner`); fs.rmdirSync(LOCK);}
    }catch(error){phase('lock');if(terminal)terminal.status='UNACKNOWLEDGED';throw error;}
  }
}

async function transactAcknowledged(request,signal,platform=realPlatform){
  if(scope!=='abbott'||!['inspect','deploy','rollback'].includes(request?.action))return{status:'REFUSED',record:null,diagnostic:{stage:'unknown',reason:'failed'}};
  // Only the transaction's own state transitions can certify compensation.
  // An exception message from a command or injected platform is never authority.
  const terminal={status:'REFUSED',phase:'unknown',reason:'failed'},guard=()=>{if(signal?.aborted)fail('Abbott activation cancelled');};
  try{return{status:'COMMITTED',record:await transact(request,platform,guard,terminal),diagnostic:{stage:'complete',reason:'none'}};}
  catch{
    const stage=['preflight_current','preflight_browser','preflight_nginx','preflight_neighbor_combined','preflight_neighbor_zaruku','preflight_neighbor_medroche','lock','prepare','activation_precheck','activation_stop','activation_start','candidate_health','pointer','compensation','unknown'].includes(terminal.phase)?terminal.phase:'unknown';
    const neighbor=['preflight_neighbor_combined','preflight_neighbor_zaruku','preflight_neighbor_medroche'].includes(stage);
    const specific=neighbor?['pid_absent','start_mismatch','uid_gid','cwd','release_record','executable','cmdline','listener','proc_metadata','unknown']:stage==='preflight_nginx'?['metadata','utf8','syntax','tls_count','include','nested_server','variable_routing','regex_location','unsupported_directive','existing_abbott_route','existing_3004','snapshot_drift','unknown','unsupported_location','unsupported_proxy_pass','unsupported_return','unsupported_add_header','unsupported_root','unsupported_alias','unsupported_index','unsupported_try_files','unsupported_error_page','unsupported_proxy_redirect','unsupported_proxy_cache','unsupported_ssl_ecdh_curve','unsupported_ssl_conf_command','unsupported_client_body_buffer_size','unsupported_charset','unsupported_gzip_vary','unsupported_if','unsupported_other']:null;
    const reason=specific?(specific.includes(terminal.reason)?terminal.reason:'unknown'):'failed';
    const diagnostic=terminal.status==='RESTORED'?{stage:'compensation',reason:'restored'}:terminal.status==='REVIEW_REQUIRED'?{stage:'compensation',reason:'review_required'}:{stage,reason};
    return{status:terminal.status,record:null,diagnostic};
  }
}

async function remoteMain(expectedDigest) {
  let cancelled=false;
  const signals=scope==='abbott'?['SIGINT','SIGTERM','SIGHUP']:[];
  const stop=()=>{cancelled=true;};
  const guard=()=>{if(cancelled)fail('Abbott activation cancelled');};
  for(const signal of signals)process.on(signal,stop);
  try {
    if (!DIGEST.test(expectedDigest)) fail('Invalid transport authority');
    const bytes = fs.readFileSync(0);
    if (bytes.length > 536870912 || hash(bytes) !== expectedDigest) fail('Transport authority mismatch');
    const request = JSON.parse(bytes);
    // Abbott inspection uses its fixed read-only preflight; other scopes retain
    // their existing locked inspection path.
    const record = await transact(request, realPlatform, guard);
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch (error) {
    process.stderr.write(scope==='abbott'?'ABBOTT_ACTIVATION_REFUSED\n':`Refusing runtime operation: ${error.message}\n`);
    process.exitCode = 1;
  }finally{for(const signal of signals)process.removeListener(signal,stop);}
}


return { safeRelative, readPinned, renderEnvironment, parseRuntimeSecrets, serializeRuntimeSecrets,
  assertRuntimeProcess, captureRuntimeIdentity, captureRuntimeRegistration, releaseCommandEnvironment, assertRuntimeListener, normalizeBootEnvironment, inspectActiveRuntime: current,
  // Fixed interrupted-activation recovery uses the same attesters/PM2 adapter.
  // This does not add a normal deploy action or relax current() consistency.
  interruptedRecoveryTools: () => ({ readRecord, attestTree, platform: realPlatform }),
  transact, transactAcknowledged, remoteMain, ENV_KEYS, HOST_DIRECTORY_MODES };
}
