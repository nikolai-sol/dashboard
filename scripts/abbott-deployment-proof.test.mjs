import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{createHash}from'node:crypto';
const api=()=>import('./runtime-release-remote.mjs');
const ID='cf5f0759e633421cba2fbc4fb822a244',SHA='b607f1111f1143d7cfa35f0c8c0b9d6d3f6d62a8',HASH='115ccb22599201672d7270948fc96c744e7b7b92ab62e7ace9380be420297504';
const NGINX='/etc/nginx/conf.d/dashboard-next.conf',ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control';
const BOOT='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e';
const NGINX_TEXT='server { listen 80; server_name dashboards.adreports.ru alias.example; return 301 https://$host$request_uri; }\nserver { listen 443 ssl; server_name alias.example dashboards.adreports.ru; location / { proxy_pass http://127.0.0.1:3001; } }\n';
const FOREIGN_INCLUDE='/etc/nginx/snippets/foreign-project.conf';
test('deployment proof snapshots only the main Nginx file and never opens foreign includes',async()=>{const m=await api(),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace('location / {','include '+FOREIGN_INCLUDE+'; location / {'));const proof=m.createAbbottDeploymentProof(f.options);assert.doesNotThrow(()=>proof.preflight());proof.perimeter();assert.ok(!f.opened.includes(FOREIGN_INCLUDE));const original=f.files.get(NGINX);f.files.set(NGINX,original.replace('foreign-project','other-project'));assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});f.files.set(NGINX,original);assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.equal(f.fds.size,0);});
test('shadow deployment ignores foreign route semantics while pinning the shared Nginx file',async()=>{
 const m=await api(),f=fixture();
 const foreign=`
root /var/www/foreign;
index index.html;
location /foreign-static/ { alias /var/www/foreign-static/; try_files $uri =404; }
location = /public/coopervision-misight-attribution-preview { return 301 /public/coopervision-misight-attribution-preview/; }
location = /previews/coopervision { auth_request /foreign-auth; error_page 401 = @coopervision_login_redirect; proxy_pass http://127.0.0.1:8093$request_uri; }
location @coopervision_login_redirect { return 302 /previews/coopervision/login?next=$uri; }
`;
 f.files.set(NGINX,NGINX_TEXT.replace('location / { proxy_pass http://127.0.0.1:3001; }',foreign+'location / { proxy_pass http://127.0.0.1:3001; }'));
 f.options.validateNginx=m.validateAbbottNginxOwnershipText;
 const proof=m.createAbbottDeploymentProof(f.options);
 assert.doesNotThrow(()=>proof.preflight());
 const original=f.files.get(NGINX);f.files.set(NGINX,original+'# concurrent foreign change\n');
 assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
 assert.equal(f.fds.size,0);
});
test('Abbott ownership validator accepts only the complete direct cutover fragment',async()=>{
 const m=await api(),fragment=fs.readFileSync(new URL('../deploy/abbott/nginx-routes.conf',import.meta.url),'utf8');
 const cutover=NGINX_TEXT.replace('location / { proxy_pass http://127.0.0.1:3001; }',fragment+'\nlocation / { proxy_pass http://127.0.0.1:3001; }');
 assert.doesNotThrow(()=>m.validateAbbottNginxOwnershipText(cutover));
 assert.throws(()=>m.validateAbbottNginxOwnershipText(cutover.replace(fragment.split('location = /dashboard/18/ {')[0],'')),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
 const nested=NGINX_TEXT.replace('location / { proxy_pass http://127.0.0.1:3001; }','if ($request_method = GET) { '+fragment+' } location / { proxy_pass http://127.0.0.1:3001; }');
 assert.throws(()=>m.validateAbbottNginxOwnershipText(nested),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
 assert.throws(()=>m.validateAbbottNginxOwnershipText(cutover.replace('127.0.0.1:3004','127.0.0.1:3005')),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
function fixture(){
 const med='/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone';
 const record={scope:'abbott',id:ID,sourceSha:SHA,manifestDigest:HASH,previousId:'1a2f99c57e594fc38d1f3a663f781cf4'};
 const processes=[[3722244,'122353749',0,0,'/var/www/dashboard',3001],[791065,'131477500',984,991,'/var/www/dashboard-zaruku/apps/zaruku',3002],[1870897,'139126198',983,983,med+'/apps/site-seo',3003],[12345,'555',982,984,ROOT+'/apps/abbott',3004]];
 const registration={appName:'dashboard-abbott',pmId:6,exec:'/usr/bin/env',cwd:ROOT+'/apps/abbott',args:['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node','/var/www/.dashboard-abbott-launcher.cjs'],uid:'dashboard-abbott',gid:'dashboard-abbott',releaseId:ID,sourceSha:SHA};
 const receipt={version:1,binding:{sourceSha:SHA,runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},transaction:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',record,directory:{dev:'1',ino:'2'},process:{appName:'dashboard-abbott',pmId:6,pid:12345,startTime:'555',bootId:BOOT,uid:982,gid:984,cwd:ROOT+'/apps/abbott',script:'/var/www/.dashboard-abbott-launcher.cjs',sourceSha:SHA,registration}};
 const receiptPath=CONTROL+'/ownership-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json';
 const files=new Map(Object.entries({[NGINX]:'nginx-fixture',[CONTROL+'/current.json']:JSON.stringify(record),[CONTROL+'/'+ID+'/record.json']:JSON.stringify(record),[receiptPath]:JSON.stringify(receipt),[ROOT+'/.release-source-sha']:SHA+'\n',[ROOT+'/.release-runtime-scope']:'abbott\n',[CONTROL+'/'+ID+'/trusted-runtime-manifest.json']:'manifest-fixture','/proc/sys/kernel/random/boot_id':BOOT+'\n','/var/www/dashboard/.release-source-sha':'8f389a28df1c4b741ec33b7538f0354b74f5a40e\n','/var/www/dashboard-zaruku/.release-source-sha':'af1948c8b9a0f70d8696afb9c8abc254408a5daa\n','/usr/bin/node':'node-fixture','/var/lib/dashboard-abbott/browser-cache/stamp.json':'browser-fixture','/var/www/.dashboard-abbott-launcher.cjs':'launcher-fixture',[CONTROL+'/'+ID+'/deploy/abbott/start.cjs']:'launcher-fixture'}));
 files.set('/var/lib/dashboard-abbott/browser-cache-chrome/stamp.json','browser-fixture');
 files.set('/etc/passwd','dashboard-abbott:x:982:984::/nonexistent:/usr/sbin/nologin\n');files.set('/etc/group','dashboard-abbott:x:984:\n');
 const links=new Map([['/var/www/dashboard-medroche',med]]),owners=new Map();
 for(const[pid,start,uid,gid,cwd,port]of processes){
  owners.set(pid,[uid,gid]);const p='/proc/'+pid;
  files.set(p+'/stat',pid+' (node) '+['S',...Array(18).fill('0'),start].join(' '));
  files.set(p+'/status',`Uid:\t${[uid,uid,uid,uid].join('\t')}\nGid:\t${[gid,gid,gid,gid].join('\t')}\n`);
  files.set(p+'/cmdline','next-server (v16.1.6)\0\0');links.set(p+'/cwd',cwd);links.set(p+'/exe','/usr/bin/node');links.set(p+'/fd/10',`socket:[${port}]`);
  files.set(p+'/net/tcp',`  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:${port.toString(16).toUpperCase().padStart(4,'0')} 00000000:0000 0A 00000000:00000000 00:00000000 00000000 ${uid} 0 ${port} 1 0000000000000000 100 0 0 10 0\n`);files.set(p+'/net/tcp6','  sl  local_address remote_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n');
 }
 files.set(NGINX,NGINX_TEXT);
 files.set('/proc/1/net/tcp','header\n'+processes.map(([pid])=>files.get('/proc/'+pid+'/net/tcp').split('\n')[1]).join('\n')+'\n');files.set('/proc/1/net/tcp6','header\n');
 const metadata=new Map(),fds=new Map(),buffers=[],opened=[],calls=[];let serial=1;
 function stat(p){const file=files.has(p),link=links.has(p),pid=Number(/^\/proc\/(\d+)/.exec(p)?.[1]),[uid,gid]=owners.get(pid)??[0,0],net=p.includes('/net');return{dev:1,ino:2,size:file?Buffer.byteLength(files.get(p)):0,uid:net?0:uid,gid:net?0:gid,mode:link?0o120777:file?0o100600:0o40755,nlink:1,mtimeMs:1,ctimeMs:1,isFile:()=>file,isDirectory:()=>!file&&!link,isSymbolicLink:()=>link,...metadata.get(p)};}
 const io={constants:fs.constants,lstatSync:stat,fstatSync:fd=>stat(fds.get(fd)),realpathSync:p=>links.get(p)??p,readlinkSync:p=>links.get(p),readdirSync:p=>p===CONTROL?[receiptPath.split('/').at(-1)]:p==='/proc'?['1','self','net',...processes.map(r=>String(r[0]))]:p==='/proc/1/fd'?[]:p.endsWith('/fd')?['10']:[],openSync(p,flags){assert.equal(flags,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);opened.push(p);fds.set(++serial,p);return serial;},readSync(fd,b,o,l,pos){buffers.push(b);return Buffer.from(files.get(fds.get(fd))).copy(b,o,pos,pos+l);},closeSync:fd=>fds.delete(fd)};
 for(const file of[NGINX,'/var/www/dashboard/.release-source-sha','/var/www/dashboard-zaruku/.release-source-sha'])metadata.set(file,{mode:0o100644});
 metadata.set('/var/www/dashboard',{uid:501,gid:0,mode:0o40755});metadata.set('/var/www/dashboard/.release-source-sha',{uid:501,gid:0,mode:0o100644});
 metadata.set('/usr/bin/node',{mode:0o100755});metadata.set('/var/lib/dashboard-abbott/browser-cache/stamp.json',{mode:0o100640,gid:984});metadata.set('/var/lib/dashboard-abbott/browser-cache-chrome/stamp.json',{mode:0o100640,gid:984});
 metadata.set(CONTROL,{mode:0o40700});metadata.set('/var/www/dashboard-abbott-releases',{mode:0o40711});metadata.set('/var/www/dashboard-abbott-backups',{mode:0o40711});
 for(const directory of ['/var/www/dashboard-medroche-releases',med.slice(0,-'/standalone'.length),med,med+'/apps',med+'/apps/site-seo'])metadata.set(directory,{uid:0,gid:983,mode:0o40750});
 const options={io,hostname:()=> 'ybjqbzojln',getuid:()=>0,digest:b=>b.toString()==='manifest-fixture'?HASH:createHash('sha256').update(b).digest('hex'),verifyActive(r){calls.push('active');assert.deepEqual(r,record);},verifyBrowser(){calls.push('browser');return{archiveSha256:'fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04'};}};
 return{options,files,links,metadata,calls,processes,owners,receipt,receiptPath,fds,buffers,opened};
}
test('deployment proof rejects malformed include directives before any foreign path read',async()=>{const m=await api();for(const body of ['include /etc/nginx/*.conf;','include $foreign;','include relative.conf;','include /etc/nginx/../foreign.conf;']){const f=fixture(),notes=[];f.options.notePhase=(stage,reason)=>notes.push({stage,reason});f.files.set(NGINX,NGINX_TEXT.replace('location / {',body+' location / {'));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(notes.at(-1),{stage:'preflight_nginx',reason:'include'});assert.ok(!f.opened.some(p=>p.startsWith('/etc/nginx/snippets/')));assert.equal(f.fds.size,0);}});
test('legitimate neighbor source update before snapshot is accepted, then pinned for the transaction',async()=>{
 const m=await api(),f=fixture();f.files.set('/var/www/dashboard/.release-source-sha','a'.repeat(40)+'\n');
 const proof=m.createAbbottDeploymentProof(f.options);assert.doesNotThrow(()=>proof.preflight());
 f.files.set('/var/www/dashboard/.release-source-sha','b'.repeat(40)+'\n');assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
test('bounded rate zone preflight preserves exact snapshot and refuses later rate drift',async()=>{const m=await api(),f=fixture();const zone='limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s;\n';f.files.set(NGINX,zone+NGINX_TEXT.replace('location / {','location / { limit_req zone=perip burst=20 nodelay;'));const proof=m.createAbbottDeploymentProof(f.options);proof.preflight();proof.perimeter();f.files.set(NGINX,f.files.get(NGINX).replace('rate=10r/s','rate=11r/s'));assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));});
test('invalid rate zone and limiter refuse fixed preflight without process or mutation actions',async()=>{const m=await api();for(const text of ['limit_req_zone key zone=perip:1k rate=1r/s;\n'+NGINX_TEXT,NGINX_TEXT.replace('location / {','location / { limit_req zone=missing;'),'limit_req_zone key zone=perip:10m rate=1r/s;\n'+NGINX_TEXT.replace('location / {','location / { limit_req zone=perip delay=1 nodelay;')]){const f=fixture(),seen=[];f.files.set(NGINX,text);f.options.notePhase=(stage,reason)=>seen.push({stage,reason});assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.equal(seen.at(-1).stage,'preflight_nginx');assert.deepEqual(f.calls,[]);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));}});
test('fixed proof brands every host boundary without reading exception content',async()=>{
 const m=await api();
 for(const [stage,file]of [['preflight_current',CONTROL+'/current.json'],['preflight_browser','/var/lib/dashboard-abbott/browser-cache-chrome/stamp.json'],['preflight_nginx',NGINX],['preflight_neighbor_combined','/proc/3722244/stat'],['preflight_neighbor_zaruku','/proc/791065/stat'],['preflight_neighbor_medroche','/proc/1870897/stat']]){
  const f=fixture(),seen=[],read=f.options.io.openSync;f.options.notePhase=s=>seen.push(s);f.options.io.openSync=(p,...args)=>{if(p===file)throw Error('private-token https://private/?key=secret');return read(p,...args);};
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.equal(seen.at(-1),stage);assert.doesNotMatch(JSON.stringify(seen),/private|secret|https/);
 }
});
test('fixed preflight uses only filesystem/kernel reads and checks exact existing Abbott plus protected neighbors',async()=>{
 const m=await api();assert.equal(typeof m.createAbbottDeploymentProof,'function');const f=fixture(),p=m.createAbbottDeploymentProof(f.options);try{p.preflight();p.perimeter();}catch{assert.fail(JSON.stringify(f.opened.slice(-5)));}assert.deepEqual(f.calls,['active','browser']);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(x=>x===0)));
});

for(const index of [0,1,2])for(const reason of ['pid_absent','start_mismatch','uid_gid','cwd','release_record','executable','cmdline','listener','proc_metadata'])test(`neighbor${index} closed subreason ${reason}`,async()=>{
 const m=await api(),f=fixture(),[pid,start]=f.processes[index],p='/proc/'+pid,seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 if(reason==='pid_absent'){const stat=f.options.io.lstatSync;f.options.io.lstatSync=(file,...a)=>{if(file===p)throw Object.assign(Error('private-token'),{code:'ENOENT'});return stat(file,...a);};}
 if(reason==='start_mismatch'){const read=f.options.io.readSync;f.options.io.readSync=(...a)=>{const n=read(...a);if(f.opened.at(-1)===p+'/cmdline')f.files.set(p+'/stat',f.files.get(p+'/stat').replace(start,'999999'));return n;};}
 if(reason==='uid_gid')f.files.set(p+'/status','Uid:\t9\t9\t9\t9\nGid:\t9\t9\t9\t9\n');
 if(reason==='cwd')f.links.set(p+'/cwd','/private-token');
 if(reason==='release_record'){if(index===2)f.links.set('/var/www/dashboard-medroche','/private-token');else f.files.set(index===0?'/var/www/dashboard/.release-source-sha':'/var/www/dashboard-zaruku/.release-source-sha','private-token');}
 if(reason==='executable')f.links.set(p+'/exe','/private-token');
 if(reason==='cmdline')f.files.set(p+'/cmdline','private-token\0');
 if(reason==='listener')f.links.set(p+'/fd/10','socket:[999999]');
 if(reason==='proc_metadata')f.metadata.set(p+'/stat',{nlink:2});
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:['preflight_neighbor_combined','preflight_neighbor_zaruku','preflight_neighbor_medroche'][index],reason:reason==='pid_absent'?'listener':reason});assert.doesNotMatch(JSON.stringify(seen),/private-token|999999/);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));
});
test('neighbor PID absence is not guessed from permissions or missing proc child files',async()=>{
 const m=await api();for(const mode of ['permission','child_missing','pid_owner']){const f=fixture(),seen=[],stat=f.options.io.lstatSync;f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
  f.options.io.lstatSync=(file,...args)=>{if(mode==='permission'&&file==='/proc/3722244'||mode==='child_missing'&&file==='/proc/3722244/stat')throw Object.assign(Error('private-token'),{code:mode==='permission'?'EACCES':'ENOENT'});return stat(file,...args);};
  if(mode==='pid_owner')f.metadata.set('/proc/3722244',{uid:99});
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:'preflight_neighbor_combined',reason:mode==='pid_owner'?'uid_gid':'proc_metadata'});assert.doesNotMatch(JSON.stringify(seen),/private-token/);
 }
});

test('Linux four-digit ports3001-3004 detect IPv6 listeners and reject malformed widths or case',async()=>{
 const m=await api();
 for(const index of [0,1,2,3])for(const mode of ['ipv6','short','long','lower','malformed_extra']){
  const f=fixture(),[pid,,,,,port]=f.processes[index],p='/proc/'+pid,hex=port.toString(16).toUpperCase().padStart(4,'0');
  const row=f.files.get(p+'/net/tcp').split('\n')[1];
  if(mode==='ipv6')f.files.set(p+'/net/tcp6',f.files.get(p+'/net/tcp6')+row.replace('0100007F:','00000000000000000000000001000000:').replace('00000000:0000','00000000000000000000000000000000:0000')+'\n');
  else {const wrong=mode==='long'?'0'+hex:mode==='lower'?hex.toLowerCase():hex.slice(1);f.files.set(p+'/net/tcp',mode==='malformed_extra'?f.files.get(p+'/net/tcp')+row.replace(hex,wrong)+'\n':f.files.get(p+'/net/tcp').replace(hex,wrong));}
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},`${port}/${mode}`);
 }
});
test('fixed proof refuses source, receipt, nginx, kernel, listener, binary and browser drift without child calls',async()=>{
 const m=await api();assert.equal(typeof m.createAbbottDeploymentProof,'function');
 for(const mode of ['source','receipt','nginx_hash','symlink','hardlink','owner','mode','directory_mode','oversize','pid_reuse','uid','gid','cwd','exe','cmdline','listener_foreign','listener_wildcard','listener_duplicate','listener_uid','browser','account']){
  const f=fixture(),p='/proc/791065',proof=m.createAbbottDeploymentProof(f.options);if(mode==='pid_reuse')proof.preflight();
  if(mode==='source')f.files.set('/var/www/dashboard/.release-source-sha','wrong');
  if(mode==='receipt'){f.receipt.process.sourceSha='f'.repeat(40);f.files.set(f.receiptPath,JSON.stringify(f.receipt));}
  if(mode==='nginx_hash')f.files.set(NGINX,'secret');
  if(mode==='symlink')f.links.set(NGINX,'/private-secret');
  if(mode==='hardlink')f.metadata.set(NGINX,{nlink:2});
  if(mode==='owner')f.metadata.set(NGINX,{uid:1000});
  if(mode==='mode')f.metadata.set(NGINX,{mode:0o100666});
  if(mode==='directory_mode')f.metadata.set(CONTROL,{mode:0o40755});
  if(mode==='oversize')f.files.set(NGINX,'x'.repeat(1048577));
  if(mode==='pid_reuse')f.files.set(p+'/stat',f.files.get(p+'/stat').replace('131477500','131477501'));
  for(const field of ['uid','gid'])if(mode===field)f.files.set(p+'/status',f.files.get(p+'/status').replace(field==='uid'?'984':'991','0'));
  if(mode==='cwd')f.links.set(p+'/cwd','/private-secret');
  if(mode==='exe')f.metadata.set('/usr/bin/node',{uid:984});
  if(mode==='cmdline')f.files.set(p+'/cmdline','private-secret\0');
  if(mode==='listener_foreign')f.links.set(p+'/fd/10','socket:[999]');
  if(mode==='listener_wildcard')f.files.set(p+'/net/tcp',f.files.get(p+'/net/tcp').replace('0100007F','00000000'));
  if(mode==='listener_duplicate')f.files.set(p+'/net/tcp',f.files.get(p+'/net/tcp')+f.files.get(p+'/net/tcp').split('\n')[1]+'\n');
  if(mode==='listener_uid')f.files.set(p+'/net/tcp',f.files.get(p+'/net/tcp').replace(' 984 0 ',' 0 0 '));
  if(mode==='account')f.files.set('/etc/passwd','dashboard-abbott:x:0:984::/nonexistent:/usr/sbin/nologin\n');
  if(mode==='browser')f.options.verifyBrowser=()=>{throw Error('private-secret');};
  assert.throws(()=>mode==='pid_reuse'?proof.perimeter():m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},mode);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(x=>x===0)));
 }
});
test('stable nofollow reads reject replacement during read and same PID start drift during perimeter',async()=>{
 const m=await api();assert.equal(typeof m.createAbbottDeploymentProof,'function');
 for(const mode of ['inode','start']){const f=fixture(),read=f.options.io.readSync;let changed=false;f.options.io.readSync=(...a)=>{const n=read(...a);if(!changed&&f.opened.at(-1)===(mode==='inode'?NGINX:'/proc/791065/cmdline')){changed=true;if(mode==='inode')f.metadata.set(NGINX,{ino:999});else f.files.set('/proc/791065/stat',f.files.get('/proc/791065/stat').replace('131477500','999'));}return n;};assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight());assert.equal(changed,true);assert.equal(f.fds.size,0);}
});

test('semantic Node contract rejects writable binaries and arbitrary argv; fixed server form is accepted',async()=>{
 const m=await api();
 for(const [mode,ok]of [['writable',false],['relative',false],['argv',false],['server',true]]){const f=fixture();
  if(mode==='writable')f.metadata.set('/usr/bin/node',{mode:0o100777});
  if(mode==='relative')f.links.set('/proc/791065/exe','node');
  if(mode==='argv')f.files.set('/proc/791065/cmdline','/usr/bin/node\0/private-secret.js\0');
  if(mode==='server')f.files.set('/proc/791065/cmdline','/usr/bin/node\0/var/www/dashboard-zaruku/apps/zaruku/server.js\0');
  const p=m.createAbbottDeploymentProof(f.options);if(ok)p.preflight();else assert.throws(()=>p.preflight());
 }
});

test('each neighbor and each current checkpoint identity is mandatory, never inferred from another process',async()=>{
 const m=await api();
 for(const pid of [3722244,791065,1870897]){const f=fixture(),proof=m.createAbbottDeploymentProof(f.options);proof.preflight();f.files.set('/proc/'+pid+'/stat',f.files.get('/proc/'+pid+'/stat').replace(/\d+$/,'999'));assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
 for(const field of ['scope','id','sourceSha','manifestDigest','previousId']){const f=fixture(),r=JSON.parse(f.files.get(CONTROL+'/current.json'));r[field]='private-secret';f.files.set(CONTROL+'/current.json',JSON.stringify(r));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
 const f=fixture();f.options.verifyActive=()=>{throw Object.assign(Error('private-secret'),{stderr:'private-secret',stdout:'private-secret'});};assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});

test('proof is filesystem-only and real Abbott path wires it before any account/lock operation',()=>{
 const source=fs.readFileSync(new URL('./runtime-release-remote.mjs',import.meta.url),'utf8');
 const proof=source.slice(source.indexOf('export function createAbbottDeploymentProof'),source.indexOf('// Based on'));
 assert.doesNotMatch(proof,/\b(?:execFileSync|spawn|fetch|createServer)\s*\(|\.(?:connect|writeFileSync|mkdirSync|renameSync|unlinkSync|chmodSync)\s*\(|\.pm2/);
 const transaction=source.slice(source.indexOf('async function transact(request'),source.indexOf('async function transactAcknowledged'));
 assert.ok(transaction.indexOf("if(scope==='abbott')")<transaction.indexOf('platform.deploymentPreflight(phase)'));
 for(const operation of ['platform.account()','fs.mkdirSync(LOCK','platform.browser(account)'])assert.ok(transaction.indexOf('platform.deploymentPreflight(phase)')<transaction.indexOf(operation));
 const wired=source.slice(source.indexOf('let abbottDeploymentProtection'),source.indexOf('  browser(account)'));
 assert.match(wired,/createAbbottDeploymentProof/);assert.match(wired,/validateNginx:\s*validateAbbottNginxOwnershipText/);assert.match(wired,/verifyActive:record=>.*current\(\)/);assert.match(wired,/verifyBrowser:.*verifyBrowserInstallation/);assert.doesNotMatch(wired,/execFileSync|spawn|fetch/);
});

function replacePid(f,index,pid,start){
 const row=f.processes[index],old=row[0],from='/proc/'+old,to='/proc/'+pid;
 for(const map of [f.files,f.links,f.metadata])for(const [key,value]of [...map])if(key===from||key.startsWith(from+'/')){map.delete(key);map.set(to+key.slice(from.length),value);}
 f.owners.set(pid,f.owners.get(old));f.owners.delete(old);row[0]=pid;row[1]=start;
 f.files.set(to+'/stat',f.files.get(to+'/stat').replace(/^\d+/,String(pid)).replace(/\d+$/,start));
}
test('new valid neighbor PIDs, starts and release pointers are captured, never historical authority',async()=>{
 const m=await api();for(const index of [0,1,2]){
  const f=fixture();replacePid(f,index,50000+index,'900000');
  if(index<2)f.files.set(index===0?'/var/www/dashboard/.release-source-sha':'/var/www/dashboard-zaruku/.release-source-sha','c'.repeat(40)+'\n');
  else {const release='/var/www/dashboard-medroche-releases/'+'d'.repeat(40),target=release+'/standalone';f.links.set('/var/www/dashboard-medroche',target);f.links.set('/proc/50002/cwd',target+'/apps/site-seo');for(const directory of [release,target,target+'/apps',target+'/apps/site-seo'])f.metadata.set(directory,{uid:0,gid:983,mode:0o40750});}
  const proof=m.createAbbottDeploymentProof(f.options);proof.preflight();replacePid(f,index,60000+index,'900001');assert.throws(()=>proof.perimeter());
 }
});
test('every captured neighbor field and release metadata stays exact throughout the transaction',async()=>{
 const m=await api();for(const mode of ['source','release_inode','release_mode','binary_inode','command','cwd_inode','start','boot','listener_inode','med_pointer']){
  const f=fixture(),proof=m.createAbbottDeploymentProof(f.options);proof.preflight();
  if(mode==='source')f.files.set('/var/www/dashboard-zaruku/.release-source-sha','e'.repeat(40)+'\n');
  if(mode==='release_inode')f.metadata.set('/var/www/dashboard/.release-source-sha',{mode:0o100644,ino:20});
  if(mode==='release_mode')f.metadata.set('/var/www/dashboard/.release-source-sha',{mode:0o100600});
  if(mode==='binary_inode')f.metadata.set('/usr/bin/node',{mode:0o100755,ino:20});
  if(mode==='command')f.files.set('/proc/791065/cmdline','/usr/bin/node\0/var/www/dashboard-zaruku/apps/zaruku/server.js\0');
  if(mode==='cwd_inode')f.metadata.set('/var/www/dashboard-zaruku/apps/zaruku',{ino:20});
  if(mode==='start')f.files.set('/proc/791065/stat',f.files.get('/proc/791065/stat').replace(/\d+$/,'900001'));
  if(mode==='boot')f.files.set('/proc/sys/kernel/random/boot_id','2c736efb-eaa2-42d9-b247-bd1a2ef36a4e\n');
  if(mode==='listener_inode'){for(const p of ['/proc/1/net/tcp','/proc/791065/net/tcp'])f.files.set(p,f.files.get(p).replace(' 3002 1 ',' 93002 1 '));f.links.set('/proc/791065/fd/10','socket:[93002]');}
  if(mode==='med_pointer')f.metadata.set('/var/www/dashboard-medroche',{ino:20});
  assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},mode);
 }
});
test('neighbor cwd and release ancestry are root-owned nonwritable real directories',async()=>{
 const m=await api();for(const file of ['/var/www/dashboard-zaruku/apps/zaruku','/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone/apps'])for(const mode of ['owner','write','symlink']){
  const f=fixture();if(mode==='symlink')f.links.set(file,'/elsewhere');else f.metadata.set(file,mode==='owner'?{uid:983}:{mode:0o40777});assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},file+'/'+mode);
 }
});
test('combined neighbor preserves its established uid-501 release ownership',async()=>{
 const m=await api(),f=fixture();
 f.metadata.set('/var/www/dashboard',{uid:501,gid:0,mode:0o40755});
 f.metadata.set('/var/www/dashboard/.release-source-sha',{uid:501,gid:0,mode:0o100644});
 assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());
 for(const [file,metadata]of [['/var/www/dashboard',{uid:502}],['/var/www/dashboard',{mode:0o40777}],['/var/www/dashboard/.release-source-sha',{uid:0}]]){
  const invalid=fixture();invalid.metadata.set('/var/www/dashboard',{uid:501,gid:0,mode:0o40755});invalid.metadata.set('/var/www/dashboard/.release-source-sha',{uid:501,gid:0,mode:0o100644});invalid.metadata.set(file,{...invalid.metadata.get(file),...metadata});
  assert.throws(()=>m.createAbbottDeploymentProof(invalid.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
 }
});
test('MedRoche neighbor permits only its established root-group release tree',async()=>{
 const m=await api(),root='/var/www/dashboard-medroche-releases',release=root+'/13d68b0b2c820ba5d223f254bc4eba6d0cf24418',directories=[root,release,release+'/standalone',release+'/standalone/apps',release+'/standalone/apps/site-seo'];
 const applyOwner=f=>{for(const directory of directories)f.metadata.set(directory,{uid:0,gid:983,mode:0o40750});};
 const f=fixture();applyOwner(f);assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());
 for(const [directory,metadata]of [[directories.at(-1),{gid:984}],[root,{mode:0o40770}]]){const invalid=fixture();applyOwner(invalid);invalid.metadata.set(directory,{...invalid.metadata.get(directory),...metadata});assert.throws(()=>m.createAbbottDeploymentProof(invalid.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
});
test('bounded discovery refuses ambiguous socket ownership, scan overflow and proc races',async()=>{
 const m=await api();for(const mode of ['duplicate_owner','entries','pids','fds','total_fds','proc_link','fd_link','fd_race','listener_race']){
  const f=fixture(),list=f.options.io.readdirSync,stat=f.options.io.lstatSync;
  if(mode==='duplicate_owner'){f.processes.push([999,'100',0,0,'/',999]);f.links.set('/proc/999/fd/10','socket:[3001]');}
  if(mode==='entries')f.options.io.readdirSync=p=>p==='/proc'?Array(8193).fill('unrelated'):list(p);
  if(mode==='pids')f.options.io.readdirSync=p=>p==='/proc'?Array.from({length:4097},(_,i)=>String(i+1)):list(p);
  if(mode==='fds')f.options.io.readdirSync=p=>p==='/proc/1/fd'?Array.from({length:4097},(_,i)=>String(i)):list(p);
  if(mode==='total_fds'){f.options.io.readdirSync=p=>p==='/proc'?Array.from({length:17},(_,i)=>String(90000+i)):p.endsWith('/fd')?Array.from({length:4096},(_,i)=>String(i)):list(p);f.options.io.lstatSync=p=>/\/fd\/\d+$/.test(p)?{...stat(p),isDirectory:()=>false,isSymbolicLink:()=>true}:stat(p);f.options.io.readlinkSync=()=>'/unrelated';}
  if(mode==='proc_link')f.links.set('/proc/791065','/proc/999');
  if(mode==='fd_link')f.links.set('/proc/791065/fd','/private');
  if(mode==='fd_race'){const link=f.options.io.readlinkSync;f.options.io.readlinkSync=p=>{const target=link(p);if(p==='/proc/791065/fd/10')f.metadata.set(p,{ino:999});return target;};}
  if(mode==='listener_race')f.options.io.readdirSync=p=>{const names=list(p);if(p==='/proc')f.files.set('/proc/1/net/tcp',f.files.get('/proc/1/net/tcp').replace(' 3001 1 ',' 999 1 '));return names;};
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},mode);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));
 }
});
test('protected listener reads tolerate procfs network timestamp churn',async()=>{
 const m=await api(),f=fixture(),lstat=f.options.io.lstatSync,fstat=f.options.io.fstatSync,read=f.options.io.readSync;let churn=false;
 const withNetworkTime=(value,file)=>/\/net\/tcp6?$/.test(file??'')?{...value,mtimeMs:churn?2:1,ctimeMs:churn?2:1}:value;
 f.options.io.lstatSync=file=>withNetworkTime(lstat(file),file);
 f.options.io.fstatSync=fd=>withNetworkTime(fstat(fd),f.fds.get(fd));
 f.options.io.readSync=(fd,...args)=>{const count=read(fd,...args);if(/\/net\/tcp6?$/.test(f.fds.get(fd)??''))churn=true;return count;};
 const proof=m.createAbbottDeploymentProof(f.options);
 assert.doesNotThrow(()=>proof.preflight());
 assert.doesNotThrow(()=>proof.perimeter());
 assert.equal(f.fds.size,0);
});
test('unrelated bounded processes and socket changes do not become perimeter authority',async()=>{
 const m=await api(),f=fixture(),proof=m.createAbbottDeploymentProof(f.options);proof.preflight();
 f.processes.push([999,'100',0,0,'/',999]);f.links.set('/proc/999/fd/10','socket:[99999]');proof.perimeter();
 f.links.set('/proc/999/fd/10','/unrelated');proof.perimeter();
});
test('Nginx accepts a valid current composite HTTP/TLS config and pins exact bytes plus metadata',async()=>{
 const m=await api();for(const mode of ['bytes','inode','mtime']){const f=fixture();f.files.set(NGINX,'# new preexisting deployment\n'+NGINX_TEXT.replace('alias.example','another.example'));const proof=m.createAbbottDeploymentProof(f.options);proof.preflight();
  if(mode==='bytes')f.files.set(NGINX,f.files.get(NGINX)+'# subsequent change\n');else f.metadata.set(NGINX,{mode:0o100644,[mode==='inode'?'ino':'mtimeMs']:20});assert.throws(()=>proof.perimeter());
 }
});
test('Nginx structural sanity refuses absent/multiple TLS, Abbott routes/markers and malformed syntax',async()=>{
 const m=await api();for(const text of [NGINX_TEXT.replace('443 ssl','80'),NGINX_TEXT+NGINX_TEXT,NGINX_TEXT+'# ABBOTT BEGIN\n',NGINX_TEXT.replace('3001','3004'),NGINX_TEXT.replace('location /','location /dashboard/18'),NGINX_TEXT.replace('location /','location /_next-abbott'),NGINX_TEXT+'{',NGINX_TEXT+'\0',NGINX_TEXT.replace('dashboards.adreports.ru','other.example').replace('dashboards.adreports.ru','other.example')]){const f=fixture();f.files.set(NGINX,text);assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight());}
});
test('normal deployment perimeter contains no historical neighbor PID, release, boot or Nginx digest',()=>{
 const source=fs.readFileSync(new URL('./runtime-release-remote.mjs',import.meta.url),'utf8').split('// Based on')[0];
 for(const value of ['3722244','791065','1870897','122353749','131477500','139126198','13d68b0b2c820ba5d223f254bc4eba6d0cf24418','8f389a28df1c4b741ec33b7538f0354b74f5a40e','af1948c8b9a0f70d8696afb9c8abc254408a5daa','1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c',BOOT])assert.ok(!source.includes(value));
 assert.match(source,/let boot,perimeterSnapshot/);assert.doesNotMatch(source,/snapshot.*(?:write|env|stdin)/i);
});
test('a detected perimeter change latches refusal even if the other deployment later reverts it',async()=>{
 const m=await api(),f=fixture(),proof=m.createAbbottDeploymentProof(f.options);proof.preflight();const original=f.files.get(NGINX);
 f.files.set(NGINX,original+'# concurrent change\n');assert.throws(()=>proof.perimeter());f.files.set(NGINX,original);assert.throws(()=>proof.perimeter());
});
test('global kernel inventory refuses wildcard/IPv6/duplicate or malformed protected listeners',async()=>{
 const m=await api();for(const mode of ['wildcard','ipv6','duplicate','missing','inode_collision','short','long','lower']){
  const f=fixture(),file='/proc/1/net/tcp',original=f.files.get(file),row=original.split('\n')[1];
  if(mode==='wildcard')f.files.set(file,original.replace('0100007F:0BB9','00000000:0BB9'));
  if(mode==='ipv6')f.files.set('/proc/1/net/tcp6','header\n'+row.replace('0100007F:','00000000000000000000000001000000:').replace('00000000:0000','00000000000000000000000000000000:0000')+'\n');
  if(mode==='duplicate')f.files.set(file,original+row+'\n');
  if(mode==='missing')f.files.set(file,original.replace(row+'\n',''));
  if(mode==='inode_collision')f.files.set(file,original.replace(' 3002 1 ',' 3001 1 '));
  if(['short','long','lower'].includes(mode))f.files.set(file,original.replace('0BB9',{short:'BB9',long:'00BB9',lower:'0bb9'}[mode]));
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},mode);
 }
});
test('Nginx syntax distinguishes quoted braces and variable data from directive/block tokens',async()=>{
 const m=await api();for(const value of ['add_header X-Debug "}";','return 301 https://${host}$request_uri;']){const f=fixture();f.files.set(NGINX,NGINX_TEXT.replace('return 301 https://$host$request_uri;',value));assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight(),value);}
});
for(const value of ['location ~* ^/DASHBOARD/18 { proxy_pass http://127.0.0.1:3001; }','include /etc/nginx/locations-enabled/*.conf;','listen 443 ssl {}','server_name dashboards.adreports.ru {}','location /;'])test('Nginx refuses opaque route/block: '+value,async()=>{const m=await api(),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace('location / { proxy_pass http://127.0.0.1:3001; }',value));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});});
test('Linux zero-size proc files and shared namespace TCP tables preserve selected owner proof',async()=>{
 const m=await api(),f=fixture(),table=f.files.get('/proc/1/net/tcp');
 for(const [file]of f.files)if(file.startsWith('/proc/'))f.metadata.set(file,{size:0});
 for(const [pid]of f.processes)f.files.set('/proc/'+pid+'/net/tcp',table);
 const proof=m.createAbbottDeploymentProof(f.options);proof.preflight();proof.perimeter();assert.equal(f.fds.size,0);
});
test('snapshot rejects invalid UTF-8 instead of normalizing distinct config bytes',async()=>{
 const m=await api(),f=fixture();f.files.set(NGINX,Buffer.concat([Buffer.from(NGINX_TEXT+'# '),Buffer.from([0xff]),Buffer.from('\n')]));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});

const TLS_BODY='location / { proxy_pass http://127.0.0.1:3001; }';
const TLS_SERVER='server { listen 443 ssl; server_name dashboards.adreports.ru; '+TLS_BODY+' }';
const invalidNginxContext={
 nested_location:'server { listen 80; server_name other.example; location / { '+TLS_SERVER+' } }',
 nested_if:'server { listen 80; server_name other.example; if ($host) { '+TLS_SERVER+' } }',
 nested_upstream:'upstream hidden { '+TLS_SERVER+' }',
 nested_http:'http { '+TLS_SERVER+' }',
 nested_other_server:NGINX_TEXT.replace(TLS_BODY,TLS_BODY+' server { listen 80; server_name other.example; }'),
 root_server_directive:NGINX_TEXT+'server;',
 root_location:NGINX_TEXT+'location /other { return 404; }',
 misplaced_listen:NGINX_TEXT.replace(TLS_BODY,'location / { listen 8080; proxy_pass http://127.0.0.1:3001; }'),
 misplaced_name:NGINX_TEXT.replace(TLS_BODY,'location / { server_name other.example; proxy_pass http://127.0.0.1:3001; }'),
 nested_locations:NGINX_TEXT.replace(TLS_BODY,'location /other { location /inner { return 404; } }'),
};
for(const[label,config]of Object.entries(invalidNginxContext))test('Nginx context refuses '+label,async()=>{
 const m=await api(),f=fixture(),seen=[];f.files.set(NGINX,config);f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(f.calls,[]);assert.equal(seen.at(-1).stage,'preflight_nginx');assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));
});
const opaqueRouting={
 proxy_variable:'location / { proxy_pass http://127.0.0.1:$port; }',
 proxy_braced_variable:'location / { proxy_pass "http://127.0.0.1:${port}"; }',
 proxy_named_variable:'location / { proxy_pass $destination; }',
 set_port:'set $port 3004; location / { proxy_pass http://127.0.0.1:$port; }',
 split_target:'set $prefix "http://127.0.0.1:30"; set $suffix 04; location / { proxy_pass "$prefix$suffix"; }',
 map_target:'map $host $target { default "http://127.0.0.1:$port"; } '+TLS_BODY,
 rewrite:'rewrite ^/(.*)$ /$1 last; '+TLS_BODY,
 if_routing:'if ($host) { return 302 $destination; } '+TLS_BODY,
 regex_character_class:'location ~ ^/[dD]ashboard/1[8]$ { proxy_pass http://127.0.0.1:3001; }',
 regex_case_insensitive:'location ~* "^/dash[b]?oard/1(?:8)$" { proxy_pass http://127.0.0.1:3001; }',
 regex_escape:String.raw`location ~ "^/\x64ashboar\x64/\x31\x38$" { proxy_pass http://127.0.0.1:3001; }`,
 regex_quoted:'location "~*" "^/.*$" { proxy_pass http://127.0.0.1:3001; }',
 prefix_modifier:'location ^~ / { proxy_pass http://127.0.0.1:3001; }',
 pattern_without_modifier:'location /[dD]ashboard/1[8] { proxy_pass http://127.0.0.1:3001; }',
 variable_location:'location /$path { proxy_pass http://127.0.0.1:3001; }',
 try_files:'location / { try_files $uri /$target; }',
 error_page:'error_page 404 = $destination; '+TLS_BODY,
 return_variable:'location / { return 302 $destination; }',
 return_encoded_alias:'location / { return 302 /dashboard/%31%38; }',
 named_upstream:'location / { proxy_pass http://unattested_upstream; }',
 module_routing:'location / { js_content hidden_route; }',
 fastcgi_variable:'location / { fastcgi_pass $destination; }',
 grpc_variable:'location / { grpc_pass grpc://127.0.0.1:$port; }',
 opaque_block:'opaque_module { destination $port; } '+TLS_BODY,
};
for(const[label,body]of Object.entries(opaqueRouting))test('Nginx selected routing refuses '+label,async()=>{
 const m=await api(),f=fixture(),seen=[];f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,body));f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(f.calls,[]);assert.equal(seen.at(-1).stage,'preflight_nginx');assert.equal(f.fds.size,0);
});
test('Nginx literal aliases, escaped words and padded target port cannot hide Abbott',async()=>{
 const m=await api();for(const body of ['location = /dashboard/18 { return 404; }','location = /DASHBOARD/18 { return 404; }','location = /dashboard/Abbott { return 404; }','location /_NEXT-ABBOTT { return 404; }',String.raw`location = "/dashboa\rd/18" { return 404; }`,'location / { proxy_pass http://127.0.0.1:03004; }']){const f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,body));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
});
test('Nginx direct literal locations and header data preserve accepted composite fixture',async()=>{
 const m=await api();for(const config of [NGINX_TEXT,NGINX_TEXT.replace(TLS_BODY,'# server { listen 443 ssl; server_name hidden.example; }\nlocation = /health { return 404; }\nlocation / { proxy_set_header Host $host; add_header X-Example "set $not_routing }"; proxy_pass "http://127.0.0.1:3001"; }')]){const f=fixture();f.files.set(NGINX,config);assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());}
});
for(const[label,listen,host]of [['shared_tls','443','dashboards.adreports.ru'],['shared_tls_ipv6','[::]:443','dashboards.adreports.ru'],['padded_port','00443','dashboards.adreports.ru'],['case_alias','443','DASHBOARDS.ADREPORTS.RU'],['implicit_listener','','dashboards.adreports.ru'],['other_port','8080','dashboards.adreports.ru']])test('Nginx all target-host blocks are bounded: '+label,async()=>{
 const m=await api(),f=fixture();f.files.set(NGINX,`server { ${listen?'listen '+listen+';':''} server_name ${host}; location / { proxy_pass http://127.0.0.1:$arg_port; } }\n`+NGINX_TEXT);assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
for(const[label,header]of [['location','Location'],['refresh','Refresh'],['dynamic','$header']])test('Nginx response-routing headers are not passive: '+label,async()=>{
 const m=await api(),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,`location / { add_header ${header} $target; return 302; }`));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
const unsafeProxyPaths={
 dashboard18:'/dashboard/18',api18:'/api/dashboard/18',nested18:'/reports/api/dashboard/18',
 trailing18:'/dashboard/18/',api_suffix:'/api/dashboard/18/pdf',mixed_case:'/API/DaShBoArD/18',
 abbott:'/dashboard/abbott',api_abbott:'/api/dashboard/ABBOTT/',asset:'/_next-abbott/static/chunk.js',
 query:'/dashboard/18?from=2026-09-01',unrelated_query:'/health?target=18',fragment:'/health#dashboard',
 encoded_id:'/dashboard/%31%38',encoded_slash:'/dashboard%2f18',double_encoded:'/dashboard/%2531%2538',
 encoded_name:'/%64ashboard/18',encoded_asset:'/%5fnext%2dabbott/static/chunk.js',
 dot:'/dashboard/./18',parent_dot:'/health/../dashboard/18',unrelated_dot:'/health/../health',
 duplicate_slash:'/dashboard//18',unrelated_duplicate:'/health//check',leading_duplicate:'//health',
 padded_id:'/dashboard/018',decimal_id:'/dashboard/18.0',trailing_dot_id:'/dashboard/18.',
 exponent_id:'/api/dashboard/1.8e1',hex_id:'/dashboard/0x12',binary_id:'/dashboard/0b10010',octal_id:'/dashboard/0o22',
 escaped:String.raw`/dashboa\rd/18`,
};
for(const location of ['/','= /status'])for(const[label,uri]of Object.entries(unsafeProxyPaths))test('Nginx proxy URI refuses alias or normalization ambiguity: '+(location==='/'?'prefix/':'exact/')+label,async()=>{
 const m=await api(),f=fixture(),seen=[];f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,`location ${location} { proxy_pass "http://127.0.0.1:3001${uri}"; }`));f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(f.calls,[]);assert.equal(seen.at(-1).stage,'preflight_nginx');assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));
});
test('Nginx canonical unrelated exact-location URI and identity-prefix baseline remain accepted',async()=>{
 const m=await api();for(const [location,uri]of [['/',''],['/','/'],['/health/','/health/'],['= /status','/health'],['= /status','/health/'],['= /style','/static/site.css']]){const f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,`location ${location} { proxy_pass "http://127.0.0.1:3001${uri}"; }`));assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());}
});
for(const[label,uri]of [['partial_id','/dashboard/1'],['partial_api','/api/dashboard/'],['partial_name','/dashboar'],['unproven_suffix','/health']])test('Nginx prefix replacement cannot concatenate an alias: '+label,async()=>{
 const m=await api(),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,`location / { proxy_pass http://127.0.0.1:3001${uri}; }`));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
test('Nginx proxy URI requires a proven location context',async()=>{
 const m=await api(),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'proxy_pass http://127.0.0.1:3001;'));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});
const locationIdentifiers={canonical:'18',leading_zero:'018',hex:'0x12',positive:'+18',decimal:'18.0',trailing_dot:'18.',scientific:'1.8e1',scientific_plus:'1.8e+1',binary:'0b10010',octal:'0o22',space:' 18 ',tab:'\t18\t',unicode_space:'\u00a018\u00a0',alias:'abbott',alias_case:'ABBOTT',alias_space:' abbott '};
const nginxDiagnostics=[
 ['metadata',f=>f.metadata.set(NGINX,{mode:0o100600})],
 ['metadata',f=>f.links.set(NGINX,'/private-token')],
 ['metadata',f=>{const open=f.options.io.openSync;f.options.io.openSync=(p,...args)=>{if(p===NGINX)throw Object.assign(Error('private-token'),{reason:'syntax',stdout:'private-token'});return open(p,...args);};}],
 ['utf8',f=>f.files.set(NGINX,Buffer.concat([Buffer.from(NGINX_TEXT),Buffer.from([255])]))],
 ['syntax',f=>f.files.set(NGINX,NGINX_TEXT+'"private-token')],
 ['tls_count',f=>f.files.set(NGINX,NGINX_TEXT.replace('443 ssl','80'))],
 ['include',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'include /private-token;'))],
 ['nested_server',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'location / { server { listen 80; } }'))],
 ['nested_server',f=>f.files.set(NGINX,'upstream hidden { '+NGINX_TEXT+' }')],
 ['variable_routing',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'location / { proxy_pass http://$private_token; }'))],
 ['variable_routing',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'set $target private-token;'))],
 ['regex_location',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'location ~* ^/private-token { return 404; }'))],
 ['unsupported_other',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'private_token value;'))],
 ['existing_abbott_route',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'location = /dashboard/018 { return 404; }'))],
 ['existing_abbott_route',f=>f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,'location = /status { proxy_pass http://127.0.0.1:3001/api/dashboard/0x12; }'))],
 ['existing_abbott_route',f=>f.files.set(NGINX,NGINX_TEXT+'# ABBOTT private-token\n')],
 ['existing_3004',f=>f.files.set(NGINX,NGINX_TEXT.replace(':3001',':3004'))],
];
for(const [index,[reason,alter]]of nginxDiagnostics.entries())test('Nginx private closed boundary '+index+'/'+reason,async()=>{
 const m=await api(),f=fixture(),seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});alter(f);
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:'preflight_nginx',reason});assert.deepEqual(f.calls,[]);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));assert.doesNotMatch(JSON.stringify(seen),/private-token|private_token|http|value/);
});
test('Nginx exact transaction recheck has private snapshot_drift diagnostic',async()=>{
 const m=await api(),f=fixture(),seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});const proof=m.createAbbottDeploymentProof(f.options);proof.preflight();f.files.set(NGINX,NGINX_TEXT+'# private-token\n');
 assert.throws(()=>proof.perimeter(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:'preflight_nginx',reason:'snapshot_drift'});assert.doesNotMatch(JSON.stringify(seen),/private-token/);assert.equal(f.fds.size,0);
});
const unsupportedNginxNames=['location','proxy_pass','return','add_header','root','alias','index','try_files','error_page','proxy_redirect','proxy_cache','ssl_ecdh_curve','ssl_conf_command','client_body_buffer_size','charset','gzip_vary','if'];
for(const name of unsupportedNginxNames)test('selected TLS unsupported known name only: '+name,async()=>{
 const m=await api(),f=fixture(),seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 const body=name==='location'?'location /private%20token { return 404; }':name==='proxy_pass'?'location / { proxy_pass https://private.invalid/secret; }':name==='return'?'return 301 https://private.invalid/secret;':name==='add_header'?'add_header Location https://private.invalid/secret;':name==='if'?'if (private_token) { return 404; }':name+' "private-token https://private.invalid/secret";';
 f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,body));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:'preflight_nginx',reason:'unsupported_'+name});assert.deepEqual(f.calls,[]);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(x=>x===0)));assert.doesNotMatch(JSON.stringify(seen),/private|secret|https/);
});
test('unsupported name diagnostics never infer known names from values or outside selected TLS',async()=>{
 const m=await api();for(const content of ['root private-token;\n'+NGINX_TEXT,NGINX_TEXT.replace(TLS_BODY,'private_token "root proxy_redirect https://private.invalid/secret";'),NGINX_TEXT.replace(TLS_BODY,'ROOT private-token;')]){const f=fixture(),seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});f.files.set(NGINX,content);assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(seen.at(-1),{stage:'preflight_nginx',reason:'unsupported_other'});assert.doesNotMatch(JSON.stringify(seen),/private|secret|https/);assert.equal(f.fds.size,0);}
 const f=fixture();f.files.set(NGINX,NGINX_TEXT+'# root proxy_redirect private-token\n');assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());
});
for(const mode of ['prefix','exact'])for(const[label,id]of Object.entries(locationIdentifiers))test('Nginx location normalizes numeric alias: '+mode+'/'+label,async()=>{
 const m=await api(),f=fixture(),seen=[];f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,`location ${mode==='exact'?'= ':''}"/api/dashboard/${id}" { proxy_pass http://127.0.0.1:3001; }`));f.options.notePhase=(stage,reason)=>seen.push({stage,reason});
 assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(f.calls,[]);assert.equal(seen.at(-1).stage,'preflight_nginx');assert.equal(f.fds.size,0);
});
test('location and proxy gates agree with actual getDashboardAccessContext identifier normalization',async()=>{
 const {register}=await import('tsx/cjs/api'),loader=register({namespace:'abbott-location-normalization'}),prior=Object.getOwnPropertyDescriptor(globalThis,'__dashboardMysqlPool');let calls=0;
 // Only identifier lookup is under test; a nonprotected synthetic row avoids
 // entering the unrelated environment-backed shared-password branch.
 const pool={async execute(sql,params){assert.match(sql.trim(),/^SELECT\b/);assert.equal(params.length,2);calls++;return [params[0]===18||params[1]==='abbott'?[{id:18,client_id:'synthetic',client_name:'Synthetic',dashboard_name:'Synthetic',dashboard_type:'synthetic',is_active:1,access_users_count:0}]:[],[]];},query(){assert.fail('No query');},getConnection(){assert.fail('No DB connection');}};
 Object.defineProperty(globalThis,'__dashboardMysqlPool',{value:pool,writable:true,configurable:true});
 try{const {getDashboardAccessContext}=loader.require('../src/lib/dashboard-access.ts',import.meta.url),m=await api();assert.equal(typeof getDashboardAccessContext,'function');
  for(const id of [...Object.values(locationIdentifiers),'19']){
   const context=await getDashboardAccessContext(id);assert.equal(context?.id??null,id==='19'?null:18);
   for(const encoded of [false,true])for(const kind of ['location','proxy']){
    const literal='/dashboard/'+(encoded?encodeURIComponent(id):id),f=fixture();f.files.set(NGINX,NGINX_TEXT.replace(TLS_BODY,kind==='location'?`location = "${literal}" { proxy_pass http://127.0.0.1:3001; }`:`location = /status { proxy_pass "http://127.0.0.1:3001${literal}"; }`));
    if(context?.id===18)assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});else assert.doesNotThrow(()=>m.createAbbottDeploymentProof(f.options).preflight());
   }
  }assert.equal(calls,Object.keys(locationIdentifiers).length+1);
 }finally{if(prior)Object.defineProperty(globalThis,'__dashboardMysqlPool',prior);else delete globalThis.__dashboardMysqlPool;await loader.unregister();}
});
test('main lexical alias refusal precedes foreign include handling and every mutation boundary',async()=>{const m=await api();for(const literal of ['/dashboard/\\t18','/api/dashboard/\\r18','/dashboard/\\n18']){const f=fixture(),seen=[];f.options.notePhase=(stage,reason)=>seen.push({stage,reason});f.files.set(NGINX,NGINX_TEXT.replace('location / { proxy_pass http://127.0.0.1:3001; }','location "'+literal+'" { include '+FOREIGN_INCLUDE+'; }'));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});assert.deepEqual(f.calls,[]);assert.ok(!f.opened.includes(FOREIGN_INCLUDE));assert.deepEqual(seen.at(-1),{stage:'preflight_nginx',reason:'unsupported_location'});assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(v=>v===0)));}});
