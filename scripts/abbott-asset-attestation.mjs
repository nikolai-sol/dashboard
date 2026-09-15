import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash}from'node:crypto';
const ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control';
const ID='8c79caf495f147ad91b2174b9bc5f65c',SHA='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5';
const HASH='a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2',PREVIOUS='6cd2f12e245a47dcbd5f6ce928c4ed83';
const fail=()=>{throw Error('ABBOTT_ASSET_ATTESTATION_REFUSED');};
const same=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);

export function readAttestedAbbottAssets({io=fs,hostname=os.hostname,proveSource,hash=value=>createHash('sha256').update(value).digest('hex')}={}) {
  try{
    if(hostname()!=='ybjqbzojln'||typeof proveSource!=='function')fail();proveSource();
    const check=(p,dir=false)=>{const s=io.lstatSync(p);if(io.realpathSync(p)!==p||s.uid!==0||s.gid!==0||s.mode&0o022||(dir?!s.isDirectory():!s.isFile()||s.nlink!==1))fail();return s;};
    const ancestors=p=>{for(let dir=path.dirname(p);dir!=='/';dir=path.dirname(dir))check(dir,true);};
    function read(p,max){ancestors(p);const before=check(p);if(before.size>max||p.startsWith(CONTROL+'/')&&(before.mode&0o7777)!==0o600)fail();let fd;try{fd=io.openSync(p,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!same(before,io.fstatSync(fd)))fail();const bytes=io.readFileSync(fd);if(bytes.length!==before.size||!same(before,io.fstatSync(fd))||!same(before,io.lstatSync(p)))fail();return bytes;}finally{if(fd!==undefined)io.closeSync(fd);}}
    for(const dir of [CONTROL,CONTROL+'/'+ID])if((check(dir,true).mode&0o7777)!==0o700)fail();
    const currentBytes=read(CONTROL+'/current.json',4096),recordBytes=read(CONTROL+'/'+ID+'/record.json',4096);
    const current=JSON.parse(currentBytes);
    if(!currentBytes.equals(recordBytes)||current.id!==ID||current.scope!=='abbott'||current.sourceSha!==SHA||current.manifestDigest!==HASH||current.previousId!==PREVIOUS)fail();
    const manifestBytes=read(CONTROL+'/'+ID+'/trusted-runtime-manifest.json',2*1024*1024);
    if(hash(manifestBytes)!==HASH)fail();const manifest=JSON.parse(manifestBytes);
    if(manifest.version!==1||manifest.scope!=='abbott'||manifest.sourceSha!==SHA||!Array.isArray(manifest.files)||manifest.files.length>10000)fail();
    const publicRoots=['apps/abbott/.next-abbott/static/','apps/abbott/public/'],entries=new Map();
    for(const item of manifest.files){
      if(typeof item.path!=='string'||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='.'||x==='..'))fail();
      if(!publicRoots.some(prefix=>item.path.startsWith(prefix)))continue;
      if(entries.has(item.path)||item.type!=='file'||!Number.isSafeInteger(item.size)||item.size<0||item.size>16*1024*1024||!Number.isSafeInteger(item.mode)||item.mode&0o022||! /^[a-f0-9]{64}$/.test(item.sha256))fail();entries.set(item.path,item);
    }
    if(!entries.size||entries.size>256)fail();const assets=[],seen=new Set();
    const visit=dir=>{const before=check(dir,true);for(const name of io.readdirSync(dir)){
      if(!/^[A-Za-z0-9_.()\[\]-]+$/.test(name)||name==='.'||name==='..')fail();const file=dir+'/'+name,s=io.lstatSync(file);
      if(s.isDirectory()){visit(file);continue;}
      const relative=file.slice(ROOT.length+1),entry=entries.get(relative);if(!entry||seen.has(relative)||(s.mode&0o777)!==entry.mode)fail();
      const bytes=read(file,16*1024*1024);try{if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)fail();}finally{bytes.fill(0);}
      seen.add(relative);assets.push({path:relative.startsWith(publicRoots[0])?'/_next-abbott/_next/static/'+relative.slice(publicRoots[0].length):'/'+relative.slice(publicRoots[1].length),size:entry.size,sha256:entry.sha256});
    }if(!same(before,io.lstatSync(dir)))fail();};
    for(const prefix of publicRoots){const directory=ROOT+'/'+prefix.slice(0,-1);if(io.existsSync(directory))visit(directory);}
    if(seen.size!==entries.size||!read(CONTROL+'/current.json',4096).equals(currentBytes))fail();proveSource();
    return {version:1,releaseId:ID,sourceSha:SHA,assets:assets.sort((a,b)=>a.path.localeCompare(b.path))};
  }catch{fail();}
}

export function runRemoteAssetAttestation(proveSource) {
  try{
    if(process.argv.length!==1||Object.keys(process.env).length)fail();
    const out=fs.fstatSync(1);if(process.stdout.isTTY||!(out.isFIFO()||out.isSocket()))fail();
    const bytes=Buffer.from(JSON.stringify(readAttestedAbbottAssets({proveSource}))+'\n');if(bytes.length>262144)fail();process.stdout.write(bytes);
  }catch{process.stderr.write('ABBOTT_ASSET_ATTESTATION_REFUSED\n');process.exitCode=1;}
}
