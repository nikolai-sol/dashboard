import test from'node:test';import assert from'node:assert/strict';
import{inspectAbbottPdfStage,createFixedPdfProof}from'./abbott-pdf-active-proof.mjs';
const GOOD='ABBOTT_PDF_STAGE stage=launch class=Error\n',UNKNOWN='ABBOTT_PDF_STAGE stage=unknown class=unknown\n';
test('active proof and health bracket classifier; same PID required through final proof',async()=>{
 const calls=[];const p={snapshot(){calls.push('snapshot');return{pid:123,startTime:'456'};},async health(){calls.push('health');}};
 const result=await inspectAbbottPdfStage({proof:p,classify({proveActive}){calls.push('classify');proveActive();proveActive();return GOOD;}});
 assert.equal(result,GOOD);assert.deepEqual(calls,['snapshot','health','classify','snapshot','snapshot','health','snapshot']);
});
function fixture(){
 const root='/var/www/dashboard-abbott',control='/var/www/.dashboard-abbott-control',id='8c79caf495f147ad91b2174b9bc5f65c',sha='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',hash='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2',boot='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e',log='/var/log/dashboard-abbott-error.log';
 const record={scope:'abbott',id,sourceSha:sha,manifestDigest:hash,previousId:'6cd2f12e245a47dcbd5f6ce928c4ed83'},args=['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node','/var/www/.dashboard-abbott-launcher.cjs'];
 const registration={appName:'dashboard-abbott',pmId:6,exec:'/usr/bin/env',cwd:root+'/apps/abbott',args,uid:'dashboard-abbott',gid:'dashboard-abbott',releaseId:id,sourceSha:sha};
 const process={appName:'dashboard-abbott',pmId:6,pid:12345,startTime:'555',bootId:boot,uid:982,gid:984,cwd:root+'/apps/abbott',script:args[3],sourceSha:sha,registration};
 const row={name:'dashboard-abbott',pm_id:6,pid:12345,pm2_env:{status:'online',pm_err_log_path:log,merge_logs:true,log_date_format:'YYYY-MM-DD HH:mm:ss',pm_exec_path:registration.exec,pm_cwd:registration.cwd,args,uid:'dashboard-abbott',gid:'dashboard-abbott',RUNTIME_RELEASE_ID:id,RUNTIME_RELEASE_SOURCE_SHA:sha}};
 const receipt={version:1,binding:{sourceSha:sha,runId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},transaction:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',directory:{dev:'1',ino:'2'},record,process};
 const files=new Map(Object.entries({[control+'/current.json']:JSON.stringify(record),[control+'/'+id+'/record.json']:JSON.stringify(record),[root+'/.release-source-sha']:sha+'\n',[root+'/.release-runtime-scope']:'abbott\n',[control+'/'+id+'/trusted-runtime-manifest.json']:'{}',[args[3]]:'fixed-launcher',[control+'/'+id+'/deploy/abbott/start.cjs']:'fixed-launcher','/root/.pm2/pm2.pid':'1316\n','/proc/sys/kernel/random/boot_id':boot+'\n','/proc/12345/status':'Uid:\t982\t982\t982\t982\nGid:\t984\t984\t984\t984\n','/proc/12345/stat':'12345 (node) '+['S',...Array(18).fill('0'),'555'].join(' '),[control+'/ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json']:JSON.stringify(receipt)}));
 const metadata=new Map(),fds=new Map(),calls=[];let next=10;const stat=p=>{const file=files.has(p);return{dev:1,ino:2,size:file?Buffer.byteLength(files.get(p)):0,mode:file?0o100600:0o40700,uid:0,gid:0,nlink:1,mtimeMs:1,ctimeMs:1,isDirectory:()=>!file,isFile:()=>file,isSymbolicLink:()=>false,...metadata.get(p)};};
 const io={constants:{O_RDONLY:0,O_NOFOLLOW:256},lstatSync:stat,realpathSync:p=>p==='/proc/12345/cwd'?root+'/apps/abbott':p,readdirSync:()=>['ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'],openSync(p){fds.set(++next,p);return next;},fstatSync:fd=>stat(fds.get(fd)),readSync(fd,b,o,l,pos){const bytes=Buffer.from(files.get(fds.get(fd)));return bytes.copy(b,o,pos,pos+l);},closeSync:fd=>fds.delete(fd)};
 const run=(bin,args)=>{calls.push([bin,args]);return Buffer.from(bin==='pm2'?JSON.stringify([row]):'LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=12345,fd=1))\n');};
 const options={io,run,hostname:()=> 'ybjqbzojln',getuid:()=>0,digest:()=>hash,fetchImpl:async()=>new Response(JSON.stringify({ok:true,scope:'abbott',database:'connected'}),{headers:{'content-type':'application/json'}})};
 return{options,files,metadata,row,receipt,control,root,id,fds,calls};
}
test('concrete proof reconciles protected record/receipt, kernel and exact PM2/listener without log reads',async()=>{
 const f=fixture(),p=createFixedPdfProof(f.options);assert.equal(p.snapshot().pid,12345);await p.health();assert.equal(f.fds.size,0);assert.deepEqual(f.calls.map(c=>c[0]),['pm2','ss']);
});
test('concrete proof rejects PM2/process/log metadata, record/receipt and health drift with fixed errors',async()=>{
 for(const mode of ['pid','uid','port','log','status','record','mode','symlink','manifest','health']){
  const f=fixture();if(mode==='pid')f.row.pid=999;if(mode==='uid')f.row.pm2_env.uid='root';if(mode==='port')f.options.run=()=>Buffer.from('[]');if(mode==='log')f.row.pm2_env.pm_err_log_path='/wrong';if(mode==='status')f.row.pm2_env.status='stopped';if(mode==='record')f.files.set(f.control+'/current.json','{}');if(mode==='mode')f.metadata.set(f.control+'/current.json',{mode:0o100644});if(mode==='symlink')f.metadata.set(f.control+'/current.json',{isSymbolicLink:()=>true});if(mode==='manifest')f.options.digest=()=> 'wrong';if(mode==='health')f.options.fetchImpl=async()=>new Response('synthetic-secret',{status:500});
  const p=createFixedPdfProof(f.options);if(mode==='health')await assert.rejects(p.health(),{message:'ABBOTT_PDF_PROOF_UNKNOWN'});else assert.throws(()=>p.snapshot());assert.equal(f.fds.size,0);
 }
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
