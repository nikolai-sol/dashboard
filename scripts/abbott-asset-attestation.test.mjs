import assert from 'node:assert/strict';import test from 'node:test';import {createHash}from'node:crypto';
const api=async()=>{try{return await import('./abbott-asset-attestation.mjs');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;}};
const digest=x=>createHash('sha256').update(x).digest('hex');
const ID='6cd2f12e245a47dcbd5f6ce928c4ed83',SHA='f80607fbc8a693aa2c720b0976938e88732cdf1a',HASH='7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f';
function fixture(){
  const root='/var/www/dashboard-abbott',control='/var/www/.dashboard-abbott-control',asset='apps/abbott/.next-abbott/static/chunks/a.js',bytes=Buffer.from('synthetic-static');
  const manifest=Buffer.from(JSON.stringify({version:1,scope:'abbott',sourceSha:SHA,files:[{path:asset,type:'file',mode:420,size:bytes.length,sha256:digest(bytes)}]}));
  const record=Buffer.from(JSON.stringify({id:ID,scope:'abbott',sourceSha:SHA,manifestDigest:HASH,previousId:null}));
  const files=new Map([[control+'/current.json',record],[control+'/'+ID+'/record.json',record],[control+'/'+ID+'/trusted-runtime-manifest.json',manifest],[root+'/'+asset,bytes]]);
  const dirs=new Set(['/var','/var/www',root,control,control+'/'+ID,root+'/apps',root+'/apps/abbott',root+'/apps/abbott/.next-abbott',root+'/apps/abbott/.next-abbott/static',root+'/apps/abbott/.next-abbott/static/chunks']);
  const overrides=new Map(),fds=new Map();let next=1,proofs=0;
  const stat=p=>{if(!files.has(p)&&!dirs.has(p))throw Error('missing');return{isFile:()=>files.has(p),isDirectory:()=>dirs.has(p),uid:0,gid:0,mode:files.has(p)?(p.startsWith(root)?0o100644:0o100600):(p.startsWith(control)?0o40700:0o40755),nlink:1,size:files.get(p)?.length??0,dev:1,ino:[...dirs,...files.keys()].indexOf(p)+1,mtimeMs:1,ctimeMs:1,...overrides.get(p)};};
  const io={constants:{O_RDONLY:0,O_NOFOLLOW:1},lstatSync:stat,realpathSync:p=>p,openSync:p=>{const fd=next++;fds.set(fd,p);return fd;},fstatSync:fd=>stat(fds.get(fd)),readFileSync:fd=>Buffer.from(files.get(fds.get(fd))),closeSync:fd=>fds.delete(fd),existsSync:p=>files.has(p)||dirs.has(p),readdirSync:p=>[...new Set([...dirs,...files.keys()].filter(x=>x.startsWith(p+'/')).map(x=>x.slice(p.length+1).split('/')[0]))]};
  return {files,dirs,overrides,fds,manifest,root,control,platform:{io,hostname:()=> 'ybjqbzojln',proveSource:()=>{proofs++;},hash:value=>value.equals(manifest)?HASH:digest(value)},proofs:()=>proofs};
}
test('asset attester binds fixed release/hash, source proof and every public file without writes',async()=>{
  const m=await api();assert.equal(typeof m.readAttestedAbbottAssets,'function');const f=fixture();
  const result=m.readAttestedAbbottAssets(f.platform);assert.equal(result.releaseId,ID);assert.equal(result.sourceSha,SHA);assert.equal(result.assets.length,1);assert.equal(result.assets[0].path,'/_next-abbott/_next/static/chunks/a.js');assert.equal(f.proofs(),2);assert.equal(f.fds.size,0);assert.ok(!JSON.stringify(result).includes('synthetic-static'));
});
test('host, source, manifest, pointer, public hash/mode/link and unattested file drift all refuse',async()=>{
  const m=await api();assert.equal(typeof m.readAttestedAbbottAssets,'function');
  for(const mutate of [
    f=>{f.platform.hostname=()=> 'wrong';},f=>{f.platform.proveSource=()=>{throw Error('private');};},f=>{f.platform.hash=digest;},
    f=>{f.files.set(f.control+'/current.json',Buffer.from('{}'));},
    f=>{f.files.set(f.root+'/apps/abbott/.next-abbott/static/chunks/a.js',Buffer.from('changed'));},
    f=>{f.overrides.set(f.root+'/apps/abbott/.next-abbott/static/chunks/a.js',{nlink:2});},
    f=>{f.overrides.set(f.root+'/apps/abbott/.next-abbott/static/chunks/a.js',{mode:0o100666});},
    f=>{f.platform.io.realpathSync=p=>p.endsWith('a.js')?'/outside':p;},
    f=>{f.files.set(f.root+'/apps/abbott/.next-abbott/static/chunks/extra.js',Buffer.from('unexpected'));},
  ]){const f=fixture();mutate(f);assert.throws(()=>m.readAttestedAbbottAssets(f.platform),/^Error: ABBOTT_ASSET_ATTESTATION_REFUSED$/);assert.equal(f.fds.size,0);}
});
