import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
const api=()=>import('./runtime-release-remote.mjs');
const ID='8c79caf495f147ad91b2174b9bc5f65c',SHA='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',HASH='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2';
const NGINX='/etc/nginx/conf.d/dashboard-next.conf',ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control';
const BOOT='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e',NGINX_HASH='1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c';
function fixture(){
 const med='/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone';
 const record={scope:'abbott',id:ID,sourceSha:SHA,manifestDigest:HASH,previousId:'6cd2f12e245a47dcbd5f6ce928c4ed83'};
 const processes=[[3722244,'122353749',0,0,'/var/www/dashboard',3001],[791065,'131477500',984,991,'/var/www/dashboard-zaruku/apps/zaruku',3002],[1870897,'139126198',983,983,med+'/apps/site-seo',3003],[12345,'555',982,984,ROOT+'/apps/abbott',3004]];
 const registration={appName:'dashboard-abbott',pmId:6,exec:'/usr/bin/env',cwd:ROOT+'/apps/abbott',args:['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node','/var/www/.dashboard-abbott-launcher.cjs'],uid:'dashboard-abbott',gid:'dashboard-abbott',releaseId:ID,sourceSha:SHA};
 const receipt={version:1,binding:{sourceSha:SHA,runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},transaction:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',record,directory:{dev:'1',ino:'2'},process:{appName:'dashboard-abbott',pmId:6,pid:12345,startTime:'555',bootId:BOOT,uid:982,gid:984,cwd:ROOT+'/apps/abbott',script:'/var/www/.dashboard-abbott-launcher.cjs',sourceSha:SHA,registration}};
 const receiptPath=CONTROL+'/ownership-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json';
 const files=new Map(Object.entries({[NGINX]:'nginx-fixture',[CONTROL+'/current.json']:JSON.stringify(record),[CONTROL+'/'+ID+'/record.json']:JSON.stringify(record),[receiptPath]:JSON.stringify(receipt),[ROOT+'/.release-source-sha']:SHA+'\n',[ROOT+'/.release-runtime-scope']:'abbott\n',[CONTROL+'/'+ID+'/trusted-runtime-manifest.json']:'manifest-fixture','/proc/sys/kernel/random/boot_id':BOOT+'\n','/var/www/dashboard/.release-source-sha':'8f389a28df1c4b741ec33b7538f0354b74f5a40e\n','/var/www/dashboard-zaruku/.release-source-sha':'af1948c8b9a0f70d8696afb9c8abc254408a5daa\n','/usr/bin/node':'node-fixture','/var/lib/dashboard-abbott/browser-cache/stamp.json':'browser-fixture','/var/www/.dashboard-abbott-launcher.cjs':'launcher-fixture',[CONTROL+'/'+ID+'/deploy/abbott/start.cjs']:'launcher-fixture'}));
 files.set('/etc/passwd','dashboard-abbott:x:982:984::/nonexistent:/usr/sbin/nologin\n');files.set('/etc/group','dashboard-abbott:x:984:\n');
 const links=new Map([['/var/www/dashboard-medroche',med]]),owners=new Map();
 for(const[pid,start,uid,gid,cwd,port]of processes){
  owners.set(pid,[uid,gid]);const p='/proc/'+pid;
  files.set(p+'/stat',pid+' (node) '+['S',...Array(18).fill('0'),start].join(' '));
  files.set(p+'/status',`Uid:\t${[uid,uid,uid,uid].join('\t')}\nGid:\t${[gid,gid,gid,gid].join('\t')}\n`);
  files.set(p+'/cmdline','next-server (v16.1.6)\0\0');links.set(p+'/cwd',cwd);links.set(p+'/exe','/usr/bin/node');links.set(p+'/fd/10',`socket:[${port}]`);
  files.set(p+'/net/tcp',`  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:${port.toString(16).toUpperCase().padStart(4,'0')} 00000000:0000 0A 00000000:00000000 00:00000000 00000000 ${uid} 0 ${port} 1 0000000000000000 100 0 0 10 0\n`);files.set(p+'/net/tcp6','  sl  local_address remote_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n');
 }
 const metadata=new Map(),fds=new Map(),buffers=[],opened=[],calls=[];let serial=1;
 function stat(p){const file=files.has(p),link=links.has(p),pid=Number(/^\/proc\/(\d+)/.exec(p)?.[1]),[uid,gid]=owners.get(pid)??[0,0],net=p.includes('/net');return{dev:1,ino:2,size:file?Buffer.byteLength(files.get(p)):0,uid:net?0:uid,gid:net?0:gid,mode:link?0o120777:file?0o100600:0o40755,nlink:1,mtimeMs:1,ctimeMs:1,isFile:()=>file,isDirectory:()=>!file&&!link,isSymbolicLink:()=>link,...metadata.get(p)};}
 const io={constants:fs.constants,lstatSync:stat,fstatSync:fd=>stat(fds.get(fd)),realpathSync:p=>links.get(p)??p,readlinkSync:p=>links.get(p),readdirSync:p=>p===CONTROL?[receiptPath.split('/').at(-1)]:p.endsWith('/fd')?['10']:[],openSync(p,flags){assert.equal(flags,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);opened.push(p);fds.set(++serial,p);return serial;},readSync(fd,b,o,l,pos){buffers.push(b);return Buffer.from(files.get(fds.get(fd))).copy(b,o,pos,pos+l);},closeSync:fd=>fds.delete(fd)};
 for(const file of[NGINX,'/var/www/dashboard/.release-source-sha','/var/www/dashboard-zaruku/.release-source-sha'])metadata.set(file,{mode:0o100644});
 metadata.set('/usr/bin/node',{mode:0o100755});metadata.set('/var/lib/dashboard-abbott/browser-cache/stamp.json',{mode:0o100640,gid:984});
 metadata.set(CONTROL,{mode:0o40700});metadata.set('/var/www/dashboard-abbott-releases',{mode:0o40711});metadata.set('/var/www/dashboard-abbott-backups',{mode:0o40711});
 const options={io,hostname:()=> 'ybjqbzojln',getuid:()=>0,digest:b=>b.toString()==='nginx-fixture'?NGINX_HASH:HASH,verifyActive(r){calls.push('active');assert.deepEqual(r,record);},verifyBrowser(){calls.push('browser');return{archiveSha256:'fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04'};}};
 return{options,files,links,metadata,calls,processes,receipt,receiptPath,fds,buffers,opened};
}
test('fixed preflight uses only filesystem/kernel reads and checks exact existing Abbott plus protected neighbors',async()=>{
 const m=await api();assert.equal(typeof m.createAbbottDeploymentProof,'function');const f=fixture(),p=m.createAbbottDeploymentProof(f.options);try{p.preflight();p.perimeter();}catch{assert.fail(JSON.stringify(f.opened.slice(-5)));}assert.deepEqual(f.calls,['active','browser']);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(x=>x===0)));
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
  const f=fixture(),p='/proc/791065';
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
  assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'},mode);assert.equal(f.fds.size,0);assert.ok(f.buffers.every(b=>b.every(x=>x===0)));
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
 for(const pid of [3722244,791065,1870897]){const f=fixture();f.files.set('/proc/'+pid+'/stat',f.files.get('/proc/'+pid+'/stat').replace(/\d+$/,'999'));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
 for(const field of ['scope','id','sourceSha','manifestDigest','previousId']){const f=fixture(),r=JSON.parse(f.files.get(CONTROL+'/current.json'));r[field]='private-secret';f.files.set(CONTROL+'/current.json',JSON.stringify(r));assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});}
 const f=fixture();f.options.verifyActive=()=>{throw Object.assign(Error('private-secret'),{stderr:'private-secret',stdout:'private-secret'});};assert.throws(()=>m.createAbbottDeploymentProof(f.options).preflight(),{message:'ABBOTT_DEPLOY_PREFLIGHT_REFUSED'});
});

test('proof is filesystem-only and real Abbott path wires it before any account/lock operation',()=>{
 const source=fs.readFileSync(new URL('./runtime-release-remote.mjs',import.meta.url),'utf8');
 const proof=source.slice(source.indexOf('export function createAbbottDeploymentProof'),source.indexOf('// Based on'));
 assert.doesNotMatch(proof,/\b(?:execFileSync|spawn|fetch|createServer)\s*\(|\.(?:connect|writeFileSync|mkdirSync|renameSync|unlinkSync|chmodSync)\s*\(|\.pm2/);
 const transaction=source.slice(source.indexOf('async function transact(request'),source.indexOf('async function transactAcknowledged'));
 assert.ok(transaction.indexOf("if(scope==='abbott')")<transaction.indexOf('platform.deploymentPreflight()'));
 for(const operation of ['platform.account()','fs.mkdirSync(LOCK','platform.browser(account)'])assert.ok(transaction.indexOf('platform.deploymentPreflight()')<transaction.indexOf(operation));
 const wired=source.slice(source.indexOf('let abbottDeploymentProtection'),source.indexOf('  browser(account)'));
 assert.match(wired,/createAbbottDeploymentProof/);assert.match(wired,/verifyActive:record=>.*current\(\)/);assert.match(wired,/verifyBrowser:.*verifyBrowserInstallation/);assert.doesNotMatch(wired,/execFileSync|spawn|fetch/);
});
