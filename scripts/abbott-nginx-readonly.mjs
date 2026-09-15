import fs from'node:fs';import os from'node:os';import path from'node:path';
import{diagnoseAbbottNginxText}from'./runtime-release-remote.mjs';
// Fixed metadata/content read only. No command, network, env or include loading.
export function readAbbottNginxNames({io=fs,hostname=os.hostname,getuid=()=>process.getuid()}={}){
 const file='/etc/nginx/conf.d/dashboard-next.conf',max=1048576;let fd,bytes;
 const fail=()=>{throw Error();},stable=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
 const ancestry=()=>{const result=[];for(let p=path.dirname(file);p!=='/';p=path.dirname(p)){const s=io.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.mode&0o022||io.realpathSync(p)!==p)fail();result.push([p,s]);}return result;};
 try{
  if(getuid()!==0||hostname()!=='ybjqbzojln')fail();const parents=ancestry(),before=io.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||before.nlink!==1||(before.mode&0o7777)!==0o644||!Number.isSafeInteger(before.size)||before.size<1||before.size>max||io.realpathSync(file)!==file)fail();
  fd=io.openSync(file,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!stable(before,io.fstatSync(fd)))fail();
  bytes=Buffer.alloc(max+1);let n=0;while(n<bytes.length){const count=io.readSync(fd,bytes,n,bytes.length-n,n);if(!Number.isSafeInteger(count)||count<0||count>bytes.length-n)fail();if(!count)break;n+=count;}
  if(n!==before.size||n>max||!stable(before,io.fstatSync(fd))||!stable(before,io.lstatSync(file)))fail();
  const result=diagnoseAbbottNginxText(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,n)));
  if(!stable(before,io.fstatSync(fd))||!stable(before,io.lstatSync(file))||parents.some(([p,s])=>!stable(s,io.lstatSync(p)))||ancestry().length!==parents.length)fail();
  io.closeSync(fd);fd=undefined;return result;
 }catch{return ['other'];}finally{bytes?.fill(0);if(fd!==undefined)try{io.closeSync(fd);}catch{}}
}
