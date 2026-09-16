import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash}from'node:crypto';
const ROOT='/var/www/dashboard-abbott',CONTROL='/var/www/.dashboard-abbott-control';
const ID='cf5f0759e633421cba2fbc4fb822a244',SHA='b607f1111f1143d7cfa35f0c8c0b9d6d3f6d62a8';
const HASH='115ccb22599201672d7270948fc96c744e7b7b92ab62e7ace9380be420297504',PREVIOUS='1a2f99c57e594fc38d1f3a663f781cf4';
export const ASSET_ATTESTATION_REASONS=Object.freeze(['record_schema','pin_mismatch','tree_hash','asset_prefix','predecessor','transport','source_proof','metadata','unknown','remote_import','remote_attestation']);
const reasons=new WeakMap();
const fail=reason=>{const error=Error('ABBOTT_ASSET_ATTESTATION_REFUSED');if(ASSET_ATTESTATION_REASONS.includes(reason))reasons.set(error,reason);throw error;};
export const formatAssetAttestationFailure=error=>`ABBOTT_ASSET_ATTESTATION_REFUSED reason=${reasons.get(error)??'unknown'}\n`;
const same=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);

export function readAttestedAbbottAssets({io=fs,hostname=os.hostname,proveSource,hash=value=>createHash('sha256').update(value).digest('hex')}={}) {
  let phase='source_proof';
  try{
    if(hostname()!=='ybjqbzojln'||typeof proveSource!=='function')fail();proveSource();
    phase='metadata';
    const check=(p,dir=false)=>{const s=io.lstatSync(p);if(io.realpathSync(p)!==p||s.uid!==0||s.gid!==0||s.mode&0o022||(dir?!s.isDirectory():!s.isFile()||s.nlink!==1))fail('metadata');return s;};
    const ancestors=p=>{for(let dir=path.dirname(p);dir!=='/';dir=path.dirname(dir))check(dir,true);};
    function read(p,max){ancestors(p);const before=check(p);if(before.size>max||p.startsWith(CONTROL+'/')&&(before.mode&0o7777)!==0o600)fail();let fd;try{fd=io.openSync(p,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);if(!same(before,io.fstatSync(fd)))fail();const bytes=io.readFileSync(fd);if(bytes.length!==before.size||!same(before,io.fstatSync(fd))||!same(before,io.lstatSync(p)))fail();return bytes;}finally{if(fd!==undefined)io.closeSync(fd);}}
    for(const dir of [CONTROL,CONTROL+'/'+ID])if((check(dir,true).mode&0o7777)!==0o700)fail();
    const currentBytes=read(CONTROL+'/current.json',4096),recordBytes=read(CONTROL+'/'+ID+'/record.json',4096);
    phase='record_schema';const current=JSON.parse(currentBytes);
    if(!current||Array.isArray(current)||Object.keys(current).sort().join(',')!=='id,manifestDigest,previousId,scope,sourceSha'||!currentBytes.equals(recordBytes))fail();
    if(current.id!==ID||current.scope!=='abbott'||current.sourceSha!==SHA||current.manifestDigest!==HASH)fail('pin_mismatch');
    if(current.previousId!==PREVIOUS)fail('predecessor');
    phase='metadata';
    const manifestBytes=read(CONTROL+'/'+ID+'/trusted-runtime-manifest.json',2*1024*1024);
    if(hash(manifestBytes)!==HASH)fail('tree_hash');phase='record_schema';const manifest=JSON.parse(manifestBytes);
    if(manifest.version!==1||manifest.scope!=='abbott'||manifest.sourceSha!==SHA||!Array.isArray(manifest.files)||manifest.files.length>10000)fail();
    const publicRoots=['apps/abbott/.next-abbott/static/','apps/abbott/public/'],entries=new Map();
    for(const item of manifest.files){
      if(typeof item.path!=='string'||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='.'||x==='..'))fail('asset_prefix');
      if(!publicRoots.some(prefix=>item.path.startsWith(prefix)))continue;
      if(entries.has(item.path)||item.type!=='file'||!Number.isSafeInteger(item.size)||item.size<0||item.size>16*1024*1024||!Number.isSafeInteger(item.mode)||item.mode&0o022||! /^[a-f0-9]{64}$/.test(item.sha256))fail();entries.set(item.path,item);
    }
    if(!entries.size||entries.size>256)fail('asset_prefix');const assets=[],seen=new Set();phase='metadata';
    const visit=dir=>{const before=check(dir,true);for(const name of io.readdirSync(dir)){
      if(!/^[A-Za-z0-9_.()\[\]-]+$/.test(name)||name==='.'||name==='..')fail('asset_prefix');const file=dir+'/'+name,s=io.lstatSync(file);
      if(s.isDirectory()){visit(file);continue;}
      const relative=file.slice(ROOT.length+1),entry=entries.get(relative);if(!entry||seen.has(relative)||(s.mode&0o777)!==entry.mode)fail('tree_hash');
      const bytes=read(file,16*1024*1024);try{if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)fail('tree_hash');}finally{bytes.fill(0);}
      seen.add(relative);assets.push({path:relative.startsWith(publicRoots[0])?'/_next-abbott/_next/static/'+relative.slice(publicRoots[0].length):'/'+relative.slice(publicRoots[1].length),size:entry.size,sha256:entry.sha256});
    }if(!same(before,io.lstatSync(dir)))fail();};
    for(const prefix of publicRoots){const directory=ROOT+'/'+prefix.slice(0,-1);if(io.existsSync(directory))visit(directory);}
    if(seen.size!==entries.size)fail('tree_hash');if(!read(CONTROL+'/current.json',4096).equals(currentBytes))fail('pin_mismatch');phase='source_proof';proveSource();
    return {version:1,releaseId:ID,sourceSha:SHA,assets:assets.sort((a,b)=>a.path.localeCompare(b.path))};
  }catch(error){fail(reasons.get(error)??phase);}
}

export function runRemoteAssetAttestation(proveSource) {
  try{
    if(process.argv.length!==1||Object.keys(process.env).length)fail('transport');
    const out=fs.fstatSync(1);if(process.stdout.isTTY||!(out.isFIFO()||out.isSocket()))fail('transport');
    const bytes=Buffer.from(JSON.stringify(readAttestedAbbottAssets({proveSource}))+'\n');if(bytes.length>262144)fail('transport');process.stdout.write(bytes);
  }catch(error){process.stderr.write(reasons.has(error)?formatAssetAttestationFailure(error):'ABBOTT_ASSET_ATTESTATION_REFUSED reason=remote_attestation\n');process.exitCode=1;}
}
