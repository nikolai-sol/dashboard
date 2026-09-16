import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import JSZip from 'jszip';
import {EventEmitter} from 'node:events';
const api=()=>import('./abbott-browser-prerequisite.mjs').catch(()=>({}));

test('browser contract derives the production-equivalent pinned Linux Chrome build and official source',async()=>{
  const m=await api();assert.equal(typeof m.deriveBrowserContract,'function');
  assert.deepEqual(m.BROWSER_SIZE_LIMITS,{archive:256*1024*1024,file:384*1024*1024,tree:768*1024*1024});
  const c=await m.deriveBrowserContract();
  assert.equal(c.buildId,'146.0.7680.76');assert.equal(c.browser,'chrome');assert.equal(c.platform,'linux');
  assert.equal(c.source,'https://storage.googleapis.com/chrome-for-testing-public/146.0.7680.76/linux64/chrome-linux64.zip');
  assert.equal(c.executable,'chrome/linux-146.0.7680.76/chrome-linux64/chrome');
  assert.equal(c.coreVersion,'24.39.1');assert.equal(c.browsersVersion,'2.13.0');
});

function fixture(t){
  const parent=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'abbott-browser-fixture-')),root=path.join(parent,'browser-cache-chrome');
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));return {parent,root,uid:process.getuid(),gid:process.getgid()};
}
const digest=x=>createHash('sha256').update(x).digest('hex');

test('immutable installation is idempotent, root/group separated, stamped and drift refusing',async(t)=>{
  const m=await api();assert.equal(typeof m.installBrowserPrerequisite,'function');const f=fixture(t),contract=await m.deriveBrowserContract();let downloads=0;
  const umask=process.umask(0o077);t.after(()=>process.umask(umask));
  const platform={...f,contract,download:async()=>{downloads++;return Buffer.from('fixture archive');},unpack:async(stage)=>{const p=path.join(stage,contract.executable);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture browser',{mode:0o755});},validateArchive:async()=>{},checkExecutable:()=>true};
  const result=await m.installBrowserPrerequisite(platform);assert.equal(result.status,'created');assert.equal(downloads,1);
  const stamp=JSON.parse(fs.readFileSync(path.join(f.root,'stamp.json')));assert.equal(stamp.archiveSha256,digest('fixture archive'));assert.deepEqual(stamp.contract,contract);
  assert.equal(fs.statSync(f.root).mode&0o777,0o750);assert.equal(fs.statSync(path.join(f.root,contract.executable)).mode&0o777,0o750);
  assert.equal(fs.statSync(path.join(f.root,'stamp.json')).mode&0o777,0o640);
  assert.equal((await m.installBrowserPrerequisite(platform)).status,'unchanged');assert.equal(downloads,1);
  fs.appendFileSync(path.join(f.root,contract.executable),'drift');await assert.rejects(m.installBrowserPrerequisite(platform),/ABBOTT_BROWSER_REFUSED/);assert.equal(downloads,1);
});

test('interrupted download or extraction never publishes and removes owned staging only',async(t)=>{
  const m=await api();assert.equal(typeof m.installBrowserPrerequisite,'function');const f=fixture(t),contract=await m.deriveBrowserContract();
  for(const failure of ['download','unpack']){
    await assert.rejects(m.installBrowserPrerequisite({...f,contract,download:async()=>{if(failure==='download')throw Error('private-url');return Buffer.from('archive');},validateArchive:async()=>{},unpack:async()=>{throw Error('private-url');},checkExecutable:()=>true}),/^Error: ABBOTT_BROWSER_REFUSED$/);
    assert.equal(fs.existsSync(f.root),false);assert.deepEqual(fs.readdirSync(f.parent),[]);
  }
});

test('archive metadata rejects traversal, duplicates, symlinks, oversized expansion and foreign roots',async()=>{
  const m=await api();assert.equal(typeof m.validateArchiveEntries,'function');
  const good={name:'chrome-linux64/chrome',size:20,mode:0o100755};
  assert.doesNotThrow(()=>m.validateArchiveEntries([good]));
  for(const entries of [[{...good,name:'../escape'}],[good,good],[{...good,mode:0o120777}],[{...good,size:1024**3}],[{...good,name:'/etc/passwd'}],[{...good,name:'other/browser'}]])assert.throws(()=>m.validateArchiveEntries(entries),/^Error: ABBOTT_BROWSER_REFUSED$/);
});

test('existing symlink cache or invalid contract refuses without download or prior file change',async(t)=>{
  const m=await api();assert.equal(typeof m.installBrowserPrerequisite,'function');const f=fixture(t),contract=await m.deriveBrowserContract();fs.symlinkSync(f.parent,f.root);
  await assert.rejects(m.installBrowserPrerequisite({...f,contract,download:async()=>assert.fail('no network')}),/ABBOTT_BROWSER_REFUSED/);
  fs.unlinkSync(f.root);
  await assert.rejects(m.installBrowserPrerequisite({...f,contract:{...contract,buildId:'untrusted'},download:async()=>assert.fail('no network')}),/ABBOTT_BROWSER_REFUSED/);assert.deepEqual(fs.readdirSync(f.parent),[]);
});

test('installed API extracts only validated preseeded ZIP with every HTTP method disabled',async(t)=>{
  const m=await api(),f=fixture(t),contract=await m.deriveBrowserContract();
  for(const protocol of [http,https])for(const method of ['get','request'])t.mock.method(protocol,method,()=>assert.fail('Network forbidden in extraction test'));
  const zip=new JSZip();zip.file('chrome-linux64/chrome','fixture executable',{unixPermissions:0o100755});
  const bytes=await zip.generateAsync({type:'nodebuffer',platform:'UNIX'});
  const result=await m.installBrowserPrerequisite({...f,contract,download:async()=>Buffer.from(bytes),unpack:m.unpackWithInstalledApi,checkExecutable:()=>true});
  assert.equal(result.status,'created');assert.equal(fs.readFileSync(path.join(f.root,contract.executable),'utf8'),'fixture executable');
});

test('wrong version, mode, symlink, executable access or extra file never passes immutable verification',async(t)=>{
  const m=await api(),f=fixture(t),contract=await m.deriveBrowserContract();
  const p={...f,contract,download:async()=>Buffer.from('archive'),validateArchive:async()=>{},unpack:async stage=>{const file=path.join(stage,contract.executable);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'browser',{mode:0o755});},checkExecutable:()=>true};
  await m.installBrowserPrerequisite(p);
  fs.chmodSync(f.parent,0o777);assert.throws(()=>m.verifyBrowserInstallation(p),/ABBOTT_BROWSER_REFUSED/);fs.chmodSync(f.parent,0o700);
  for(const override of [{contract:{...contract,coreVersion:'0.0.0'}},{checkExecutable:()=>false}])assert.throws(()=>m.verifyBrowserInstallation({...p,...override}),/^Error: ABBOTT_BROWSER_REFUSED$/);
  const executable=path.join(f.root,contract.executable);fs.chmodSync(executable,0o770);assert.throws(()=>m.verifyBrowserInstallation(p),/ABBOTT_BROWSER_REFUSED/);fs.chmodSync(executable,0o750);
  fs.writeFileSync(path.join(f.root,'extra'),'extra');assert.throws(()=>m.verifyBrowserInstallation(p),/ABBOTT_BROWSER_REFUSED/);fs.unlinkSync(path.join(f.root,'extra'));
  fs.renameSync(executable,executable+'.saved');fs.symlinkSync(executable+'.saved',executable);assert.throws(()=>m.verifyBrowserInstallation(p),/ABBOTT_BROWSER_REFUSED/);
});

test('invalid archive and unexecutable staged browser refuse before publication',async(t)=>{
  const m=await api(),f=fixture(t),contract=await m.deriveBrowserContract();
  const zip=new JSZip();zip.file('chrome-linux64/escape','../../escape',{unixPermissions:0o120777});
  await assert.rejects(m.validateZip(await zip.generateAsync({type:'nodebuffer',platform:'UNIX'})),/ABBOTT_BROWSER_REFUSED/);
  const p={...f,contract,download:async()=>Buffer.from('archive'),validateArchive:async()=>{},unpack:async stage=>{const file=path.join(stage,contract.executable);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'browser',{mode:0o755});},checkExecutable:()=>false};
  await assert.rejects(m.installBrowserPrerequisite(p),/ABBOTT_BROWSER_REFUSED/);assert.equal(fs.existsSync(f.root),false);assert.deepEqual(fs.readdirSync(f.parent),[]);
});

test('official download refuses redirects, truncation, oversized bodies, errors and deadline with fixed output',async(t)=>{
  const m=await api(),contract=await m.deriveBrowserContract();
  for(const scenario of ['redirect','truncated','oversized','error','deadline']){
    const get=t.mock.method(https,'get',(url,options,callback)=>{
      assert.equal(url,contract.source);assert.equal(options.agent,false);
      const request=new EventEmitter(),response=new EventEmitter();response.complete=false;
      request.destroy=()=>queueMicrotask(()=>request.emit('close'));response.destroy=request.destroy;
      queueMicrotask(()=>{
        if(scenario==='deadline')return;
        if(scenario==='error'){request.emit('error',Error('private-token https://private.invalid'));request.emit('close');return;}
        response.statusCode=scenario==='redirect'?302:200;response.headers={'content-length':scenario==='oversized'?String(1024**3):'10',location:'https://private.invalid/token'};
        callback(response);if(scenario==='truncated'){response.emit('data',Buffer.from('short'));response.complete=true;response.emit('end');request.emit('close');}
      });return request;
    });
    let timer;if(scenario==='deadline')timer=t.mock.method(globalThis,'setTimeout',(callback,ms)=>{assert.equal(ms,120000);queueMicrotask(callback);return 0;});
    try{await assert.rejects(m.downloadOfficialArchive(contract),/^Error: ABBOTT_BROWSER_REFUSED$/);}finally{get.mock.restore();timer?.mock.restore();}
  }
});

test('cancellation before download or after extraction cannot promote a browser',async(t)=>{
  const m=await api(),f=fixture(t),contract=await m.deriveBrowserContract();
  for(const at of ['before','unpack']){
    const abort=new AbortController();if(at==='before')abort.abort();let downloads=0;
    await assert.rejects(m.installBrowserPrerequisite({...f,contract,signal:abort.signal,download:async()=>{downloads++;return Buffer.from('archive');},validateArchive:async()=>{},unpack:async stage=>{const p=path.join(stage,contract.executable);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'browser',{mode:0o755});abort.abort();},checkExecutable:()=>true}),/ABBOTT_BROWSER_REFUSED/);
    assert.equal(downloads,at==='before'?0:1);assert.equal(fs.existsSync(f.root),false);assert.deepEqual(fs.readdirSync(f.parent),[]);
  }
});
