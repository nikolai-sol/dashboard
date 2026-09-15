import fs from'node:fs';import os from'node:os';import path from'node:path';import{execFileSync}from'node:child_process';import{isDeepStrictEqual as same}from'node:util';import{createHash}from'node:crypto';
import{createRuntimeInstaller}from'./runtime-release-remote.mjs';
import{readAbbottPdfLogStage,UNKNOWN_PDF_STAGE}from'./abbott-pdf-log-stage.mjs';
const ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control',ID='8c79caf495f147ad91b2174b9bc5f65c',SHA='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',HASH='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2',LOG='/var/log/dashboard-abbott-error.log';
const BOOT='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e';
const fail=()=>{throw Error('ABBOTT_PDF_PROOF_UNKNOWN');};
const stable=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const command=(binary,args)=>{try{return execFileSync(binary,args,{cwd:'/',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2'},stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:1048576});}catch{fail();}};

export function createFixedPdfProof({io=fs,run=command,fetchImpl=fetch,hostname=os.hostname,getuid=()=>process.getuid(),signal,digest=value=>createHash('sha256').update(value).digest('hex')}={}){
 const validator=createRuntimeInstaller({scope:'abbott',port:3004,appName:'dashboard-abbott',appDir:ROOT,lockDir:'/var/www/.dashboard-abbott-deploy.lock',releaseBranch:'release/abbott',assetPrefix:'/_next-abbott'},[]);
 const active=()=>{if(signal?.aborted)fail();};
 function read(file,max=8192,privateFile=false,proc=false){
  let fd,bytes;try{
   if(!proc){for(let dir=path.dirname(file);dir!=='/';dir=path.dirname(dir)){const s=io.lstatSync(dir);if(!s.isDirectory()||s.uid!==0||s.gid!==0||s.mode&0o022||io.realpathSync(dir)!==dir)fail();}}
   const before=io.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||!proc&&(before.uid!==0||before.gid!==0||before.mode&0o022||privateFile&&(before.mode&0o7777)!==0o600||before.size>max||io.realpathSync(file)!==file))fail();
   fd=io.openSync(file,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!stable(before,io.fstatSync(fd)))fail();bytes=Buffer.alloc(max+1);let n=0;
   while(n<bytes.length){const count=io.readSync(fd,bytes,n,bytes.length-n,n);if(!count)break;n+=count;}if(n>max||!proc&&n!==before.size||!stable(before,io.fstatSync(fd))||!stable(before,io.lstatSync(file)))fail();return bytes.subarray(0,n).toString();
  }finally{bytes?.fill(0);if(fd!==undefined)io.closeSync(fd);}
 }
 const protectedJson=file=>JSON.parse(read(file,8192,true));
 const record={scope:'abbott',id:ID,sourceSha:SHA,manifestDigest:HASH,previousId:'6cd2f12e245a47dcbd5f6ce928c4ed83'};
 function snapshot(){
  active();if(hostname()!=='ybjqbzojln'||getuid()!==0||read('/proc/sys/kernel/random/boot_id',128,false,true).trim()!==BOOT||read('/root/.pm2/pm2.pid',64).trim()!=='1316')fail();
  if(!same(protectedJson(CONTROL+'/current.json'),record)||!same(protectedJson(CONTROL+'/'+ID+'/record.json'),record)||read(ROOT+'/.release-source-sha',128)!==SHA+'\n'||read(ROOT+'/.release-runtime-scope',64)!=='abbott\n')fail();
  const launcher=read('/var/www/.dashboard-abbott-launcher.cjs',65536),sealed=read(CONTROL+'/'+ID+'/deploy/abbott/start.cjs',65536);if(launcher!==sealed)fail();
  const manifest=read(CONTROL+'/'+ID+'/trusted-runtime-manifest.json',2*1024*1024,true);if(digest(manifest)!==HASH)fail();
  const names=io.readdirSync(CONTROL);if(names.length>256)fail();const receipts=names.filter(n=>/^ownership-[a-f0-9-]{36}\.json$/.test(n)).map(n=>protectedJson(CONTROL+'/'+n)).filter(r=>r.record?.id===ID);
  if(receipts.length!==1)fail();const receipt=receipts[0],directory=io.lstatSync(ROOT);if(Object.keys(receipt).sort().join(',')!=='binding,directory,process,record,transaction,version'||receipt.version!==1||!same(receipt.record,record)||receipt.binding?.sourceSha!==SHA||Object.keys(receipt.binding).sort().join(',')!=='runId,sourceSha'||!/^[a-f0-9-]{36}$/.test(receipt.binding.runId)||!/^[a-f0-9-]{36}$/.test(receipt.transaction)||!same(receipt.directory,{dev:String(directory.dev),ino:String(directory.ino)}))fail();
  const bytes=run('pm2',['jlist']);let rows;try{if(!Buffer.isBuffer(bytes)||bytes.length>1048576)fail();rows=JSON.parse(bytes).filter(r=>r.name==='dashboard-abbott');}finally{bytes?.fill(0);}
  if(rows.length!==1||rows[0].pm2_env?.status!=='online'||rows[0].pm2_env?.pm_err_log_path!==LOG||rows[0].pm2_env?.log_date_format!=='YYYY-MM-DD HH:mm:ss'||rows[0].pm2_env?.merge_logs!==true)fail();
  const p=validator.captureRuntimeIdentity(rows,{uid:982,gid:984},file=>read(file,8192,false,file.startsWith('/proc/')),file=>io.realpathSync(file));
  if(p.bootId!==BOOT||p.sourceSha!==SHA||p.registration.releaseId!==ID||!same(p,receipt.process))fail();
  const listeners=run('ss',['-ltnpH','( sport = :3004 )']);try{if(!Buffer.isBuffer(listeners)||listeners.length>8192)fail();validator.assertRuntimeListener(p,listeners.toString());}finally{listeners?.fill(0);}
  active();return{bootId:p.bootId,pmId:p.pmId,pid:p.pid,startTime:p.startTime,uid:p.uid,gid:p.gid,releaseId:ID,sourceSha:SHA,errorLog:LOG};
 }
 async function health(){
  active();const response=await fetchImpl('http://127.0.0.1:3004/api/health',{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1000)]):AbortSignal.timeout(1000)});
  const chunks=[];let bytes;try{if(response.status!==200||!response.headers.get('content-type')?.startsWith('application/json')||!response.body)fail();const reader=response.body.getReader();let size=0;try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>4096){item.value.fill(0);fail();}chunks.push(Buffer.from(item.value));item.value.fill(0);}}finally{await reader.cancel();}bytes=Buffer.concat(chunks);if(!same(JSON.parse(bytes),{ok:true,scope:'abbott',database:'connected'}))fail();active();}finally{bytes?.fill(0);for(const chunk of chunks)chunk.fill(0);try{await response.body?.cancel();}catch{}}
 }
 return{snapshot,health};
}

export async function inspectAbbottPdfStage({proof=createFixedPdfProof(),classify=readAbbottPdfLogStage}={}){
 try{const initial=proof.snapshot();await proof.health();const proveActive=()=>{const value=proof.snapshot();if(!same(initial,value))fail();return value;};const line=classify({proveActive});await proof.health();proveActive();return line;}catch{return UNKNOWN_PDF_STAGE;}
}
