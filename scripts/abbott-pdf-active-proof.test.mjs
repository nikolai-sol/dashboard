import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{inspectAbbottPdfStage,createFixedPdfProof}from'./abbott-pdf-active-proof.mjs';
const GOOD='ABBOTT_PDF_STAGE stage=launch class=Error\n',UNKNOWN='ABBOTT_PDF_STAGE stage=unknown class=unknown\n';
test('active proof and health bracket classifier; same PID required through final proof',async()=>{
 const calls=[];const p={snapshot(){calls.push('snapshot');return{pid:123,startTime:'456'};},async health(){calls.push('health');}};
 const result=await inspectAbbottPdfStage({proof:p,classify({proveActive}){calls.push('classify');proveActive();proveActive();return GOOD;}});
 assert.equal(result,GOOD);assert.deepEqual(calls,['snapshot','health','classify','snapshot','snapshot','health','snapshot']);
});
function fixture(){
 const root='/var/www/dashboard-abbott',control='/var/www/.dashboard-abbott-control',id='8c79caf495f147ad91b2174b9bc5f65c',sha='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',hash='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2',boot='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e';
 const record={scope:'abbott',id,sourceSha:sha,manifestDigest:hash,previousId:'6cd2f12e245a47dcbd5f6ce928c4ed83'},args=['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node','/var/www/.dashboard-abbott-launcher.cjs'];
 const registration={appName:'dashboard-abbott',pmId:6,exec:'/usr/bin/env',cwd:root+'/apps/abbott',args,uid:'dashboard-abbott',gid:'dashboard-abbott',releaseId:id,sourceSha:sha};
 const process={appName:'dashboard-abbott',pmId:6,pid:12345,startTime:'555',bootId:boot,uid:982,gid:984,cwd:root+'/apps/abbott',script:args[3],sourceSha:sha,registration};
 const receipt={version:1,binding:{sourceSha:sha,runId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},transaction:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',directory:{dev:'1',ino:'2'},record,process};
 const files=new Map(Object.entries({[control+'/current.json']:JSON.stringify(record),[control+'/'+id+'/record.json']:JSON.stringify(record),[root+'/.release-source-sha']:sha+'\n',[root+'/.release-runtime-scope']:'abbott\n',[control+'/'+id+'/trusted-runtime-manifest.json']:'{}',[args[3]]:'fixed-launcher',[control+'/'+id+'/deploy/abbott/start.cjs']:'fixed-launcher','/root/.pm2/pm2.pid':'1316\n','/proc/sys/kernel/random/boot_id':boot+'\n','/proc/12345/status':'Uid:\t982\t982\t982\t982\nGid:\t984\t984\t984\t984\n','/proc/12345/stat':'12345 (node) '+['S',...Array(18).fill('0'),'555'].join(' '),[control+'/ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json']:JSON.stringify(receipt)}));
 files.delete('/root/.pm2/pm2.pid');files.set('/proc/12345/cmdline','next-server (v16.1.6)\0\0');files.set('/proc/12345/environ','PATH=/usr/local/bin:/usr/bin:/bin\0');
 const metadata=new Map(),fds=new Map(),calls=[],buffers=[],reads=[];let next=10;const stat=p=>{const file=files.has(p),link=['/proc/12345/cwd','/proc/12345/exe'].includes(p),proc=p.startsWith('/proc/12345');return{dev:1,ino:2,size:file?Buffer.byteLength(files.get(p)):0,mode:link?0o120777:file?0o100600:0o40700,uid:proc?982:0,gid:proc?984:0,nlink:1,mtimeMs:1,ctimeMs:1,isDirectory:()=>!file&&!link,isFile:()=>file,isSymbolicLink:()=>link,...metadata.get(p)};};
 const io={constants:{O_RDONLY:0,O_NOFOLLOW:256},lstatSync:stat,realpathSync:p=>p==='/proc/12345/cwd'?root+'/apps/abbott':p==='/proc/12345/exe'?'/usr/bin/node':p,readdirSync:()=>['ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'],openSync(p,flags){assert.equal(flags,256);assert.ok(!p.includes('.pm2'));reads.push(p);fds.set(++next,p);return next;},fstatSync:fd=>stat(fds.get(fd)),readSync(fd,b,o,l,pos){buffers.push(b);const bytes=Buffer.from(files.get(fds.get(fd)));return bytes.copy(b,o,pos,pos+l);},closeSync:fd=>fds.delete(fd)};
 const run=(bin,args)=>{calls.push([bin,args]);assert.equal(bin,'/usr/bin/ss');assert.deepEqual(args,['-ltnpH','( sport = :3004 )']);return Buffer.from('LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=12345,fd=1))\n');};
 const options={io,run,hostname:()=> 'ybjqbzojln',getuid:()=>0,digest:()=>hash,fetchImpl:async()=>new Response(JSON.stringify({ok:true,scope:'abbott',database:'connected'}),{headers:{'content-type':'application/json'}})};
 return{options,files,metadata,receipt,control,root,id,fds,calls,buffers,reads};
}
test('receipt and direct kernel proof succeeds with PM2 daemon/socket absent; buffers erased',async()=>{
 const f=fixture(),p=createFixedPdfProof(f.options);assert.equal(p.snapshot().pid,12345);await p.health();assert.equal(f.fds.size,0);assert.deepEqual(f.calls.map(c=>c[0]),['/usr/bin/ss']);assert.ok(f.reads.includes('/proc/12345/environ'));assert.ok(f.buffers.every(b=>b.every(x=>x===0)));
});
test('concrete proof rejects kernel/process metadata, record/receipt and health drift with fixed errors',async()=>{
 for(const mode of ['pid','uid','port','environ','status','record','mode','symlink','manifest','health']){
  const f=fixture();if(mode==='pid')f.files.set('/proc/12345/stat',f.files.get('/proc/12345/stat').replace('555','999'));if(mode==='uid')f.files.set('/proc/12345/status',f.files.get('/proc/12345/status').replaceAll('982','0'));if(mode==='port')f.options.run=()=>Buffer.from('[]');if(mode==='environ')f.files.set('/proc/12345/environ','BAD=synthetic-secret\0');if(mode==='status')f.files.set('/proc/12345/stat',f.files.get('/proc/12345/stat').replace(' S ',' Z '));if(mode==='record')f.files.set(f.control+'/current.json','{}');if(mode==='mode')f.metadata.set(f.control+'/current.json',{mode:0o100644});if(mode==='symlink')f.metadata.set(f.control+'/current.json',{isSymbolicLink:()=>true});if(mode==='manifest')f.options.digest=()=> 'wrong';if(mode==='health')f.options.fetchImpl=async()=>new Response('synthetic-secret',{status:500});
  const p=createFixedPdfProof(f.options);if(mode==='health')await assert.rejects(p.health(),{message:'ABBOTT_PDF_PROOF_UNKNOWN'});else assert.throws(()=>p.snapshot());assert.equal(f.fds.size,0);
 }
});
test('proc magic links are allowed only at exact cwd/exe with exact targets; all other symlinks refuse',()=>{
 for(const name of ['cwd','exe','stat','status','cmdline','environ']){const f=fixture();if(['cwd','exe'].includes(name)){const real=f.options.io.realpathSync;f.options.io.realpathSync=p=>p==='/proc/12345/'+name?'/synthetic-secret':real(p);}else f.metadata.set('/proc/12345/'+name,{isSymbolicLink:()=>true});assert.throws(()=>createFixedPdfProof(f.options).snapshot());assert.equal(f.fds.size,0);}
});
test('proc ancestors must be genuine directories before any kernel file opens',()=>{
 const f=fixture();f.metadata.set('/proc',{isSymbolicLink:()=>true,isDirectory:()=>false});assert.throws(()=>createFixedPdfProof(f.options).snapshot());assert.equal(f.reads.length,0);
});
test('PID reuse between first/last stat, malformed environ/cmdline and oversized kernel files refuse',()=>{
 for(const value of ['PATH=/usr/local/bin:/usr/bin:/bin','PATH=/usr/local/bin:/usr/bin:/bin\0PATH=bad\0','PATH=bad\0','PATH=/usr/local/bin:/usr/bin:/bin\0SECRET=synthetic-secret\0']){const f=fixture();f.files.set('/proc/12345/environ',value);assert.throws(()=>createFixedPdfProof(f.options).snapshot());assert.ok(f.buffers.every(b=>b.every(x=>x===0)));}
 for(const field of ['cmdline','environ']){const f=fixture();f.files.set('/proc/12345/'+field,'x'.repeat(65537));assert.throws(()=>createFixedPdfProof(f.options).snapshot());}
 const f=fixture(),read=f.options.io.readSync;f.options.io.readSync=(fd,...args)=>{const n=read(fd,...args);if(f.reads.at(-1)==='/proc/12345/environ')f.files.set('/proc/12345/stat',f.files.get('/proc/12345/stat').replace('555','556'));return n;};assert.throws(()=>createFixedPdfProof(f.options).snapshot());
});
test('diagnostic proof has no PM2 CLI/library/socket or mutable runtime worker dependency',()=>{
 const source=fs.readFileSync(new URL('./abbott-pdf-active-proof.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/runtime-release-remote|createRuntimeInstaller|jlist|\.pm2|PM2_HOME|run\(['"]pm2|\.connect\(|createConnection|writeFile|appendFile|chmod|rename|unlink/);
});
test('before/during/after PID drift, health failure, log unknown and secret exceptions all fail closed',async()=>{
 for(const mode of ['before','during','after','health','log','throw']){let calls=0,classifications=0;const p={snapshot(){calls++;if(mode==='before')throw Error('synthetic-secret');return{pid:mode==='during'&&calls===2||mode==='after'&&calls===4?999:123,startTime:'456'};},async health(){if(mode==='health')throw Error('synthetic-secret');}};
  const line=await inspectAbbottPdfStage({proof:p,classify({proveActive}){classifications++;if(mode==='throw')throw Error('synthetic-secret');proveActive();proveActive();return mode==='log'?UNKNOWN:GOOD;}});
  assert.equal(line,UNKNOWN);if(['before','health'].includes(mode))assert.equal(classifications,0);
 }
});
test('receipt active-directory identity and launcher content must be bound, not merely root-owned',()=>{
 for(const mode of ['directory','launcher']){const f=fixture();if(mode==='directory'){f.receipt.directory={dev:777,ino:888};f.files.set(f.control+'/ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json',JSON.stringify(f.receipt));}else f.files.set('/var/www/.dashboard-abbott-launcher.cjs','synthetic-secret-launcher');assert.throws(()=>createFixedPdfProof(f.options).snapshot());}
});
test('sealed receipt retains either reviewed account spelling or numeric identity, never a different UID/GID',()=>{
 for(const[uid,gid,ok]of [[982,984,true],['dashboard-abbott','dashboard-abbott',true],[0,984,false],[982,0,false]]){const f=fixture();Object.assign(f.receipt.process.registration,{uid,gid});f.files.set(f.control+'/ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json',JSON.stringify(f.receipt));if(ok)assert.equal(createFixedPdfProof(f.options).snapshot().uid,982);else assert.throws(()=>createFixedPdfProof(f.options).snapshot());}
});
