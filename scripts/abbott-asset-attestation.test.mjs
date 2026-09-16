import assert from 'node:assert/strict';import test from 'node:test';import {createHash}from'node:crypto';import fs from'node:fs';
const api=async()=>{try{return await import('./abbott-asset-attestation.mjs');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;}};
const digest=x=>createHash('sha256').update(x).digest('hex');
const ID='cf5f0759e633421cba2fbc4fb822a244',SHA='b607f1111f1143d7cfa35f0c8c0b9d6d3f6d62a8',HASH='115ccb22599201672d7270948fc96c744e7b7b92ab62e7ace9380be420297504',PREVIOUS='1a2f99c57e594fc38d1f3a663f781cf4';
function fixture(pins={ID,SHA,HASH,PREVIOUS}){
  const {ID,SHA,HASH,PREVIOUS}=pins;
  const root='/var/www/dashboard-abbott',control='/var/www/.dashboard-abbott-control',asset='apps/abbott/.next-abbott/static/chunks/a.js',bytes=Buffer.from('synthetic-static');
  const manifest=Buffer.from(JSON.stringify({version:1,scope:'abbott',sourceSha:SHA,files:[{path:asset,type:'file',mode:420,size:bytes.length,sha256:digest(bytes)}]}));
  const record=Buffer.from(JSON.stringify({id:ID,scope:'abbott',sourceSha:SHA,manifestDigest:HASH,previousId:PREVIOUS}));
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
test('attestation rejects an older release after the observed b607f11 deployment',async()=>{
  const m=await api(),f=fixture({ID:'5ec3175697824126b8bc0be1b84e68f3',SHA:'55ec478b42405515f2d3eff3d68dd9c3ac8a8d04',HASH:'137540a76fce42ab5aac2f9ebb6805d0c1baa42ce8fe1677cab8205caa24ea69',PREVIOUS:'8c79caf495f147ad91b2174b9bc5f65c'});
  assert.throws(()=>m.readAttestedAbbottAssets(f.platform),/^Error: ABBOTT_ASSET_ATTESTATION_REFUSED$/);assert.equal(f.fds.size,0);
});
test('the new release requires the exact observed predecessor pointer',async()=>{
  const m=await api();for(const PREVIOUS of [null,'e9e548a6414c4d8c836c7715c66f37ad']){const f=fixture({ID,SHA,HASH,PREVIOUS});assert.throws(()=>m.readAttestedAbbottAssets(f.platform),/^Error: ABBOTT_ASSET_ATTESTATION_REFUSED$/);assert.equal(f.fds.size,0);}
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

test('actual sanitized deployed record has the exact accepted schema and pins',async()=>{
  const m=await api(),f=fixture(),bytes=fs.readFileSync(new URL('./fixtures/abbott-deployed-record-b607f11.json',import.meta.url));
  const record=JSON.parse(bytes);assert.deepEqual(record,{id:ID,previousId:PREVIOUS,scope:'abbott',sourceSha:SHA,manifestDigest:HASH});
  f.files.set(f.control+'/current.json',bytes);f.files.set(f.control+'/'+ID+'/record.json',bytes);
  assert.equal(m.readAttestedAbbottAssets(f.platform).releaseId,ID);
  for(const mutate of [r=>{r.extra='synthetic-secret';},r=>{delete r.scope;},r=>{r.sourceSha='f80607fbc8a693aa2c720b0976938e88732cdf1a';},r=>{r.manifestDigest='b'.repeat(64);}]){
    const bad=fixture(),r={...record};mutate(r);const b=Buffer.from(JSON.stringify(r));bad.files.set(bad.control+'/current.json',b);bad.files.set(bad.control+'/'+ID+'/record.json',b);assert.throws(()=>m.readAttestedAbbottAssets(bad.platform),/^Error: ABBOTT_ASSET_ATTESTATION_REFUSED$/);
  }
});

test('asset refusal categories preserve only branded enums and never secret-bearing error properties',async()=>{
  const m=await api();assert.equal(typeof m.formatAssetAttestationFailure,'function');
  const secret='synthetic-secret https://invalid.test/?access_token=private';
  const cases=[
    ['source_proof',f=>{f.platform.proveSource=()=>{throw Object.assign(Error(secret),{reason:'pin_mismatch',body:secret});};}],
    ['metadata',f=>{f.overrides.set(f.control+'/current.json',{mode:0o100644});}],
    ['record_schema',f=>{f.files.set(f.control+'/current.json',Buffer.from('{'+secret));}],
    ['pin_mismatch',f=>{const r=JSON.parse(f.files.get(f.control+'/current.json'));r.sourceSha='b'.repeat(40);const b=Buffer.from(JSON.stringify(r));f.files.set(f.control+'/current.json',b);f.files.set(f.control+'/'+ID+'/record.json',b);}],
    ['predecessor',f=>{const r=JSON.parse(f.files.get(f.control+'/current.json'));r.previousId=null;const b=Buffer.from(JSON.stringify(r));f.files.set(f.control+'/current.json',b);f.files.set(f.control+'/'+ID+'/record.json',b);}],
    ['tree_hash',f=>{f.platform.hash=()=> 'b'.repeat(64);}],
    ['asset_prefix',f=>{f.manifest.write('!',f.manifest.indexOf(Buffer.from('apps/abbott')));}],
  ];
  for(const [reason,mutate]of cases){const f=fixture();mutate(f);assert.throws(()=>m.readAttestedAbbottAssets(f.platform),error=>{for(const k of ['message','stack','cause','reason','url','path','headers','body','stdout','stderr'])error[k]=secret;assert.equal(m.formatAssetAttestationFailure(error),`ABBOTT_ASSET_ATTESTATION_REFUSED reason=${reason}\n`);return true;});assert.equal(f.fds.size,0);}
  for(const value of [Error(secret),{reason:'metadata',message:secret},new Proxy({},{get(){throw Error(secret);}}),null,undefined])assert.equal(m.formatAssetAttestationFailure(value),'ABBOTT_ASSET_ATTESTATION_REFUSED reason=unknown\n');
});

test('real pipe-only remote entry emits the closed source proof frame with no raw failure text',async()=>{
  const {captureBoundedChild}=await import('./abbott-bounded-child.mjs');
  const source=fs.readFileSync(new URL('./abbott-asset-attestation.mjs',import.meta.url)),url='data:text/javascript;base64,'+source.toString('base64');
  // The local macOS runtime injects an environment key even under env -i.
  // Model the fixed remote empty-env contract only inside this fixture child.
  const input=Buffer.from(`for(const key of Object.keys(process.env))delete process.env[key];const m=await import(${JSON.stringify(url)});m.runRemoteAssetAttestation(()=>{throw Error('synthetic-secret https://invalid.test/?access_token=private');});`);
  const result=await captureBoundedChild('/usr/bin/env',['-i',process.execPath,'--input-type=module'],{input,timeout:2000,maxBytes:1024});
  try{assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert.equal(result.stderr.toString(),'ABBOTT_ASSET_ATTESTATION_REFUSED reason=source_proof\n');}
  finally{source.fill(0);input.fill(0);result.stdout.fill(0);result.stderr.fill(0);}
});
