import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

export const BROWSER_ROOT='/var/lib/dashboard-abbott/browser-cache-chrome';
const MAX_ARCHIVE=256*1024*1024,MAX_TREE=768*1024*1024;
const fail=()=>{throw Error('ABBOTT_BROWSER_REFUSED');};
const hash=x=>createHash('sha256').update(x).digest('hex');
const requireHere=()=>createRequire(import.meta.url);

export function deriveBrowserContract(requirePackage=requireHere()){
  const core=requirePackage('puppeteer-core'),browsers=requirePackage('@puppeteer/browsers');
  const coreEntry=requirePackage.resolve('puppeteer-core'),browserEntry=requirePackage.resolve('@puppeteer/browsers');
  const coreVersion=JSON.parse(fs.readFileSync(path.resolve(coreEntry,'../../../../package.json'))).version;
  const browsersVersion=JSON.parse(fs.readFileSync(path.resolve(browserEntry,'../../../package.json'))).version;
  const buildId=core.PUPPETEER_REVISIONS.chrome;
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(buildId))fail();
  const browser='chrome',platform='linux';
  const source=browsers.getDownloadUrl(browser,platform,buildId).href;
  const executable=path.relative('/cache',browsers.computeExecutablePath({cacheDir:'/cache',browser,platform,buildId}));
  const contract={version:1,coreVersion,browsersVersion,buildId,browser,platform,source,executable};
  validateContract(contract);return contract;
}

export function validateContract(c){
  if(!c||Object.keys(c).sort().join(',')!=='browser,browsersVersion,buildId,coreVersion,executable,platform,source,version'||c.version!==1||c.browser!=='chrome'||c.platform!=='linux'||!/^\d+\.\d+\.\d+\.\d+$/.test(c.buildId)||!/^\d+\.\d+\.\d+$/.test(c.coreVersion)||!/^\d+\.\d+\.\d+$/.test(c.browsersVersion)||c.source!==`https://storage.googleapis.com/chrome-for-testing-public/${c.buildId}/linux64/chrome-linux64.zip`||c.executable!==`chrome/linux-${c.buildId}/chrome-linux64/chrome`)fail();
}

export function validateArchiveEntries(entries){
  if(!Array.isArray(entries)||!entries.length||entries.length>4096)fail();let total=0;const names=new Set();
  for(const e of entries){
    const name=e.name,parts=typeof name==='string'?name.replace(/\/$/,'').split('/'):[];
    if(!parts.length||parts[0]!=='chrome-linux64'||parts.some(p=>!p||p==='.'||p==='..'||! /^[A-Za-z0-9_.-]+$/.test(p))||names.has(name)||!Number.isSafeInteger(e.size)||e.size<0||(total+=e.size)>MAX_TREE||!Number.isInteger(e.mode)||![0,0o100000,0o040000].includes(e.mode&0o170000))fail();
    names.add(name);
  }
}

export async function validateZip(bytes,requirePackage=requireHere()){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_ARCHIVE)fail();
  const yauzl=requirePackage('yauzl');
  await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(Error('ABBOTT_BROWSER_REFUSED'));const entries=[];
    const refuse=()=>{zip.close();reject(Error('ABBOTT_BROWSER_REFUSED'));};zip.on('error',refuse);
    zip.on('entry',entry=>{try{entries.push({name:entry.fileName,size:entry.uncompressedSize,mode:entry.externalFileAttributes>>>16});validateArchiveEntries(entries);zip.readEntry();}catch{refuse();}});
    zip.on('end',()=>{try{validateArchiveEntries(entries);resolve();}catch{refuse();}});zip.readEntry();
  }));
}

// No proxy, redirects, cookies, authorization, alternate source or fallback.
// API's downloader follows redirects without a deadline; pre-seed its archive
// using this bounded transport, then use installed API extraction offline.
export function downloadOfficialArchive(contract,{signal}={}){
  validateContract(contract);
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0,response;const request=https.get(contract.source,{agent:false,signal},res=>{
      response=res;
      if(res.statusCode!==200||!/^\d+$/.test(res.headers['content-length']??'')||Number(res.headers['content-length'])>MAX_ARCHIVE){res.destroy();request.destroy();reject(Error('ABBOTT_BROWSER_REFUSED'));return;}
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX_ARCHIVE){res.destroy();return;}chunks.push(chunk);});
      res.once('error',()=>reject(Error('ABBOTT_BROWSER_REFUSED')));
      res.once('end',()=>{if(size!==Number(res.headers['content-length'])||!size)reject(Error('ABBOTT_BROWSER_REFUSED'));else resolve(Buffer.concat(chunks));});
    });
    const timer=setTimeout(()=>request.destroy(),120000);request.once('error',()=>reject(Error('ABBOTT_BROWSER_REFUSED')));
    request.once('close',()=>{clearTimeout(timer);if(!response?.complete)reject(Error('ABBOTT_BROWSER_REFUSED'));});
  });
}

function safeDirectory(p,uid,gid,mode){const s=fs.lstatSync(p);if(!s.isDirectory()||fs.realpathSync(p)!==p||s.uid!==uid||s.gid!==gid||(s.mode&0o7777)!==mode)fail();}
function safeAncestors(root,uid){
  for(let p=path.dirname(root);;p=path.dirname(p)){
    const s=fs.lstatSync(p),systemTemp=s.uid===0&&(s.mode&0o1000)&&['/tmp','/private/tmp'].includes(p);
    if(!s.isDirectory()||fs.realpathSync(p)!==p||![0,uid].includes(s.uid)||s.mode&0o022&&!systemTemp)fail();
    if(p===path.dirname(p))break;
  }
}
function inventory(root,{uid,gid,normalize=false}={}){
  const files=[];let total=0;
  function visit(dir){
    const stat=fs.lstatSync(dir);if(!stat.isDirectory()||fs.realpathSync(dir)!==dir)fail();
    if(normalize){fs.chmodSync(dir,0o750);fs.chownSync(dir,uid,gid);}else safeDirectory(dir,uid,gid,0o750);
    for(const name of fs.readdirSync(dir).sort()){
      if(!/^[A-Za-z0-9_.-]+$/.test(name))fail();const file=path.join(dir,name),s=fs.lstatSync(file);
      if(s.isDirectory()){visit(file);continue;}
      if(!s.isFile()||s.nlink!==1||s.size>MAX_ARCHIVE||(total+=s.size)>MAX_TREE)fail();
      const relative=path.relative(root,file);if(relative==='stamp.json')continue;
      const mode=s.mode&0o111?0o750:0o640;
      if(normalize){fs.chmodSync(file,mode);fs.chownSync(file,uid,gid);}else if(s.uid!==uid||s.gid!==gid||(s.mode&0o7777)!==mode)fail();
      files.push({path:relative,size:s.size,mode,sha256:hash(fs.readFileSync(file))});if(files.length>4096)fail();
    }
  }visit(root);return files;
}

export function verifyBrowserInstallation({root=BROWSER_ROOT,contract,uid=0,gid=984,checkExecutable}={}){
  try{
    validateContract(contract);safeAncestors(root,uid);safeDirectory(root,uid,gid,0o750);
    const stampPath=path.join(root,'stamp.json'),s=fs.lstatSync(stampPath);
    if(!s.isFile()||s.nlink!==1||s.uid!==uid||s.gid!==gid||(s.mode&0o7777)!==0o640||s.size>1024*1024)fail();
    const stamp=JSON.parse(fs.readFileSync(stampPath));
    if(stamp.version!==1||JSON.stringify(stamp.contract)!==JSON.stringify(contract)||! /^[a-f0-9]{64}$/.test(stamp.archiveSha256)||JSON.stringify(stamp.files)!==JSON.stringify(inventory(root,{uid,gid})))fail();
    const executable=path.join(root,contract.executable);
    if(!stamp.files.some(f=>f.path===contract.executable&&f.mode===0o750)||typeof checkExecutable!=='function'||!checkExecutable(executable))fail();
    return {status:'verified',executable,archiveSha256:stamp.archiveSha256};
  }catch{fail();}
}

export async function installBrowserPrerequisite({root=BROWSER_ROOT,parent=path.dirname(root),uid=0,gid=984,contract,download=downloadOfficialArchive,validateArchive=validateZip,unpack,checkExecutable,signal}={}){
  let stage,bytes;
  try{
    if(signal?.aborted)fail();validateContract(contract);safeAncestors(root,uid);if(path.dirname(root)!==parent||path.basename(root)!==path.basename(BROWSER_ROOT))fail();
    const p=fs.lstatSync(parent);if(!p.isDirectory()||fs.realpathSync(parent)!==parent||p.uid!==uid||p.mode&0o022)fail();
    if(fs.existsSync(root)||fs.lstatSync(root,{throwIfNoEntry:false}))return {...verifyBrowserInstallation({root,contract,uid,gid,checkExecutable}),status:'unchanged'};
    if(typeof unpack!=='function'||typeof checkExecutable!=='function')fail();
    stage=fs.mkdtempSync(path.join(parent,'.browser-stage-'));fs.chmodSync(stage,0o700);
    bytes=await download(contract);if(signal?.aborted||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ARCHIVE)fail();await validateArchive(bytes);if(signal?.aborted)fail();
    const archiveSha256=hash(bytes);await unpack(stage,bytes,contract);bytes.fill(0);bytes=null;if(signal?.aborted)fail();
    const files=inventory(stage,{uid,gid,normalize:true});
    if(!files.some(f=>f.path===contract.executable&&f.mode===0o750))fail();
    fs.writeFileSync(path.join(stage,'stamp.json'),JSON.stringify({version:1,contract,archiveSha256,files})+'\n',{flag:'wx',mode:0o640});fs.chmodSync(path.join(stage,'stamp.json'),0o640);fs.chownSync(path.join(stage,'stamp.json'),uid,gid);
    verifyBrowserInstallation({root:stage,contract,uid,gid,checkExecutable});
    if(signal?.aborted||fs.lstatSync(root,{throwIfNoEntry:false}))fail();fs.renameSync(stage,root);stage=null;
    return {...verifyBrowserInstallation({root,contract,uid,gid,checkExecutable}),status:'created'};
  }catch{fail();}finally{bytes?.fill(0);if(stage)fs.rmSync(stage,{recursive:true,force:true});}
}

export async function unpackWithInstalledApi(stage,bytes,contract,requirePackage=requireHere()){
  validateContract(contract);
  const browsers=requirePackage('@puppeteer/browsers');
  const expected=path.join(stage,contract.executable),dir=path.join(stage,'chrome');fs.mkdirSync(dir,{mode:0o700});
  const archive=path.join(dir,`${contract.buildId}-chrome-linux64.zip`);fs.writeFileSync(archive,bytes,{flag:'wx',mode:0o600});
  const result=await browsers.install({cacheDir:stage,browser:contract.browser,platform:contract.platform,buildId:contract.buildId,baseUrl:'https://storage.googleapis.com/chrome-for-testing-public',installDeps:false});
  if(result.executablePath!==expected)fail();
}
