import fs from'node:fs';import os from'node:os';import path from'node:path';import{execFileSync}from'node:child_process';import{isDeepStrictEqual as same}from'node:util';import{createHash}from'node:crypto';
import{readAbbottPdfLogStage,UNKNOWN_PDF_STAGE}from'./abbott-pdf-log-stage.mjs';
const ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control',ID='8c79caf495f147ad91b2174b9bc5f65c',SHA='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',HASH='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2',LOG='/var/log/dashboard-abbott-error.log';
const BOOT='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e';
const fail=()=>{throw Error('ABBOTT_PDF_PROOF_UNKNOWN');};
const stable=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const command=(binary,args)=>{if(binary!=='/usr/bin/ss'||!same(args,['-ltnpH','( sport = :3004 )']))fail();try{return execFileSync(binary,args,{cwd:'/',env:{},stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:8192});}catch{fail();}};

export function createFixedPdfProof({io=fs,run=command,fetchImpl=fetch,hostname=os.hostname,getuid=()=>process.getuid(),signal,digest=value=>createHash('sha256').update(value).digest('hex')}={}){
 const active=()=>{if(signal?.aborted)fail();};
 function read(file,max=8192,privateFile=false,proc=false,decode=bytes=>bytes.toString()){
  let fd,bytes;try{
   for(let dir=path.dirname(file);dir!=='/';dir=path.dirname(dir)){const s=io.lstatSync(dir),appProc=/^\/proc\/[1-9][0-9]*$/.test(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==(appProc?982:0)||s.gid!==(appProc?984:0)||s.mode&0o022||io.realpathSync(dir)!==dir)fail();}
   const before=io.lstatSync(file),appProc=/^\/proc\/[1-9][0-9]*\//.test(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==(appProc?982:0)||before.gid!==(appProc?984:0)||before.mode&0o022||!proc&&(privateFile&&(before.mode&0o7777)!==0o600||before.size>max||io.realpathSync(file)!==file))fail();
   fd=io.openSync(file,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!stable(before,io.fstatSync(fd)))fail();bytes=Buffer.alloc(max+1);let n=0;
   while(n<bytes.length){const count=io.readSync(fd,bytes,n,bytes.length-n,n);if(!Number.isSafeInteger(count)||count<0||count>bytes.length-n)fail();if(!count)break;n+=count;}if(n>max||!proc&&n!==before.size||!stable(before,io.fstatSync(fd))||!stable(before,io.lstatSync(file)))fail();return decode(bytes.subarray(0,n));
  }finally{bytes?.fill(0);if(fd!==undefined)io.closeSync(fd);}
 }
 const protectedJson=file=>JSON.parse(read(file,8192,true));
 const record={scope:'abbott',id:ID,sourceSha:SHA,manifestDigest:HASH,previousId:'6cd2f12e245a47dcbd5f6ce928c4ed83'};
 function snapshot(){
  active();if(hostname()!=='ybjqbzojln'||getuid()!==0||read('/proc/sys/kernel/random/boot_id',128,false,true).trim()!==BOOT)fail();
  if(!same(protectedJson(CONTROL+'/current.json'),record)||!same(protectedJson(CONTROL+'/'+ID+'/record.json'),record)||read(ROOT+'/.release-source-sha',128)!==SHA+'\n'||read(ROOT+'/.release-runtime-scope',64)!=='abbott\n')fail();
  const launcher=read('/var/www/.dashboard-abbott-launcher.cjs',65536),sealed=read(CONTROL+'/'+ID+'/deploy/abbott/start.cjs',65536);if(launcher!==sealed)fail();
  const manifest=read(CONTROL+'/'+ID+'/trusted-runtime-manifest.json',2*1024*1024,true);if(digest(manifest)!==HASH)fail();
  const names=io.readdirSync(CONTROL);if(names.length>256)fail();const receipts=names.filter(n=>/^ownership-[a-f0-9-]{36}\.json$/.test(n)).map(n=>protectedJson(CONTROL+'/'+n)).filter(r=>r.record?.id===ID);
  if(receipts.length!==1)fail();const receipt=receipts[0],directory=io.lstatSync(ROOT);if(Object.keys(receipt).sort().join(',')!=='binding,directory,process,record,transaction,version'||receipt.version!==1||!same(receipt.record,record)||receipt.binding?.sourceSha!==SHA||Object.keys(receipt.binding).sort().join(',')!=='runId,sourceSha'||!/^[a-f0-9-]{36}$/.test(receipt.binding.runId)||!/^[a-f0-9-]{36}$/.test(receipt.transaction)||!same(receipt.directory,{dev:String(directory.dev),ino:String(directory.ino)}))fail();
  const p=receipt.process,args=['-i','PATH=/usr/local/bin:/usr/bin:/bin','/usr/bin/node','/var/www/.dashboard-abbott-launcher.cjs'];
  if(!p||Object.keys(p).sort().join(',')!=='appName,bootId,cwd,gid,pid,pmId,registration,script,sourceSha,startTime,uid'||p.appName!=='dashboard-abbott'||p.bootId!==BOOT||p.uid!==982||p.gid!==984||p.sourceSha!==SHA||!Number.isSafeInteger(p.pmId)||p.pmId<0||!Number.isSafeInteger(p.pid)||p.pid<=0||!/^\d{1,20}$/.test(p.startTime)||p.cwd!==ROOT+'/apps/abbott'||p.script!==args[3])fail();
  if(!['dashboard-abbott',982].includes(p.registration?.uid)||!['dashboard-abbott',984].includes(p.registration?.gid))fail();
  const registration={appName:'dashboard-abbott',pmId:p.pmId,exec:'/usr/bin/env',cwd:p.cwd,args,uid:p.registration.uid,gid:p.registration.gid,releaseId:ID,sourceSha:SHA};
  if(!same(p.registration,registration))fail();
  const proc='/proc/'+p.pid;
  const boundary=()=>{const s=io.lstatSync(proc);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==982||s.gid!==984||io.realpathSync(proc)!==proc)fail();return s;};
  const before=boundary();
  const links=()=>{for(const[name,target]of [['cwd',p.cwd],['exe','/usr/bin/node']]){const file=proc+'/'+name,a=io.lstatSync(file);if(!a.isSymbolicLink()||a.uid!==982||a.gid!==984||io.realpathSync(file)!==target||!stable(a,io.lstatSync(file)))fail();}};
  const stat=()=>{const text=read(proc+'/stat',8192,false,true),close=text.lastIndexOf(')'),fields=text.slice(close+2).trim().split(/\s+/);if(!text.startsWith(p.pid+' (')||close<0||!['R','S','D','I'].includes(fields[0])||fields[19]!==p.startTime)fail();};
  const status=()=>{const text=read(proc+'/status',8192,false,true);for(const[field,value]of [['Uid',982],['Gid',984]]){const rows=text.split('\n').filter(line=>line.startsWith(field+':'));if(rows.length!==1||rows[0].trim().split(/\s+/).slice(1).join(',')!==[value,value,value,value].join(','))fail();}};
  stat();status();links();
  // env -i establishes this initial kernel environment. The launcher later
  // replaces process.env in userspace; receipt identity, not environ, binds the
  // source/control release. Never decode or retain arbitrary environment text.
  read(proc+'/environ',65536,false,true,b=>{if(!b.equals(Buffer.from('PATH=/usr/local/bin:/usr/bin:/bin\0')))fail();});
  // Next16.1.6 rewrites argv memory to its fixed process title. Permit only that
  // exact title or the fixed original Node/launcher argv, with NUL padding.
  read(proc+'/cmdline',4096,false,true,b=>{if(!b.length||b.at(-1)!==0)fail();let end=b.length;while(end&&b[end-1]===0)end--;const value=b.subarray(0,end);if(!value.equals(Buffer.from('next-server (v16.1.6)'))&&!value.equals(Buffer.from('/usr/bin/node\0'+args[3])))fail();});
  const listeners=run('/usr/bin/ss',['-ltnpH','( sport = :3004 )']);try{if(!Buffer.isBuffer(listeners)||listeners.length>8192)fail();const rows=listeners.toString().trim().split('\n'),owners=[...rows[0].matchAll(/pid=(\d+),/g)].map(m=>Number(m[1]));if(rows.length!==1||rows[0].trim().split(/\s+/)[3]!=='127.0.0.1:3004'||!owners.length||owners.some(pid=>pid!==p.pid))fail();}finally{listeners?.fill(0);}
  stat();status();links();if(!stable(before,boundary()))fail();
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
