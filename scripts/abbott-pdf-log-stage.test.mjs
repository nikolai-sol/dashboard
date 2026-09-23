import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { classifyAbbottPdfLog, readAbbottPdfLogStage, UNKNOWN_PDF_STAGE } from './abbott-pdf-log-stage.mjs';

const LOG='/var/log/dashboard-abbott-error.log',stamp='2026-09-15 12:34:56';
const marker=(stage='ready',kind='Error',time=stamp)=>`${time}: Abbott PDF generation failed { stage: '${stage}', error_class: '${kind}' }\n`;
const expected=(stage='ready',kind='Error')=>`ABBOTT_PDF_STAGE stage=${stage} class=${kind}\n`;
const proof=()=>({bootId:'1c736efb-eaa2-42d9-b247-bd1a2ef36a4e',pmId:6,pid:12345,startTime:'123456789',uid:982,gid:984,releaseId:'8c79caf495f147ad91b2174b9bc5f65c',sourceSha:'6f09982fb1e8068f02340ddfcb5c945fb02ebfd5',errorLog:LOG});

test('actual Node console object format and both PM2 multiline timestamp layouts',()=>{
 for(const stage of ['authorize','launch','prepare','navigate','ready','render'])for(const kind of ['Error','NonError']){
  const stream=new PassThrough();let output='';stream.on('data',part=>{output+=part.toString();});
  new Console({stdout:stream,stderr:stream}).error('Abbott PDF generation failed',{stage,error_class:kind});
  assert.equal(classifyAbbottPdfLog(Buffer.from(`${stamp}: ${output}`)),expected(stage,kind));stream.destroy();
  for(const prefix of ['',`${stamp}: `])assert.equal(classifyAbbottPdfLog(Buffer.from(`${stamp}: Abbott PDF generation failed {\n${prefix}  stage: '${stage}',\n${prefix}  error_class: '${kind}'\n${prefix}}\n`)),expected(stage,kind));
 }
});
test('only latest complete unique chronological marker is classified',()=>{
 assert.equal(classifyAbbottPdfLog(Buffer.from(marker('launch','Error','2026-09-15 12:34:55')+marker())),expected());
 for(const text of [marker()+marker(),marker()+marker('launch','Error','2026-09-15 12:34:55'),marker().slice(0,-1),marker()+`${stamp}: Abbott PDF generation failed {`,marker('launch','Error','2026-02-31 12:00:00')])assert.equal(classifyAbbottPdfLog(Buffer.from(text)),UNKNOWN_PDF_STAGE);
});
test('malformed fields and arbitrary/forged/secret-bearing error context are unknown without leakage',()=>{
 const secret='synthetic-secret-token?access_token=do-not-output';
 for(const text of [
  marker('SECRET'),marker('ready',secret),marker().replace("stage: 'ready'","stage: 'ready', stage: 'launch'"),
  marker().replace("error_class: 'Error'",`error_class: 'Error', message: '${secret}'`),
  `Error: ${secret}\n${marker()}`,`${stamp}: Error: ${secret}\n${marker()}`,
  `${stamp}: Error: ${secret} ${marker()}`,marker()+`${stamp}: ${secret}\n`,
  marker().replace('Abbott PDF','Forged Abbott PDF'),marker().replace('ready','rea\0dy'),
  marker().replace('ready','rea\u001bdy'),marker().replace('ready','rea\rdy'),'',secret,
 ]){const result=classifyAbbottPdfLog(Buffer.from(text));assert.equal(result,UNKNOWN_PDF_STAGE);assert.ok(!result.includes(secret));}
 assert.equal(classifyAbbottPdfLog(Buffer.alloc(65537,65)),UNKNOWN_PDF_STAGE);
});

function fixture(t,content=marker()){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'abbott-pdf-log-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'error.log');fs.writeFileSync(file,content,{mode:0o600});
 const calls={read:0,closed:0,proof:0},map=p=>{assert.equal(p,LOG);return file;};
 const stat=s=>Object.assign(s,{uid:0,gid:0});
 const io={constants:fs.constants,
  lstatSync:p=>p==='/var'||p==='/var/log'?{uid:0,gid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false}:stat(fs.lstatSync(map(p))),
  realpathSync:p=>p==='/var'||p==='/var/log'?p:(fs.realpathSync(map(p))===file?LOG:'invalid'),
  openSync:(p,flags)=>{assert.equal(flags,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);return fs.openSync(map(p),flags);},
  fstatSync:fd=>stat(fs.fstatSync(fd)),
  readSync:(...args)=>{calls.read++;assert.ok(args[3]<=65536);return fs.readSync(...args);},
  closeSync:fd=>{calls.closed++;fs.closeSync(fd);},
 };
 const options={io,hostname:()=> 'ybjqbzojln',getuid:()=>0,proveActive:()=>{calls.proof++;return proof();}};
 return {options,io,calls,file,dir};
}
test('fixed read-only descriptor, exact process proof before/after, buffer zero and closure',t=>{
 const f=fixture(t);let buffer;const read=f.io.readSync;f.io.readSync=(...args)=>{buffer=args[1];return read(...args);};
 assert.equal(readAbbottPdfLogStage(f.options),expected());assert.equal(f.calls.proof,2);assert.equal(f.calls.closed,1);assert.ok(buffer.every(x=>x===0));
});
test('no proof, wrong host/user and every process binding drift refuse before read',t=>{
 for(const overrides of [{proveActive:undefined},{hostname:()=> 'foreign'},{getuid:()=>982},...Object.keys(proof()).map(key=>({proveActive:()=>({...proof(),[key]:typeof proof()[key]==='number'?-1:'foreign'})}))]){
  const f=fixture(t);assert.equal(readAbbottPdfLogStage({...f.options,...overrides}),UNKNOWN_PDF_STAGE);assert.equal(f.calls.read,0);
 }
});
test('rotation, truncation, append and process replacement during read refuse and close',t=>{
 for(const change of ['rotate','truncate','append','process']){
  const f=fixture(t),read=f.io.readSync;f.io.readSync=(...args)=>{const n=read(...args);if(change==='rotate'){fs.renameSync(f.file,f.file+'.1');fs.writeFileSync(f.file,marker(),{mode:0o600});}if(change==='truncate')fs.truncateSync(f.file,1);if(change==='append')fs.appendFileSync(f.file,'x');return n;};
  if(change==='process')f.options.proveActive=()=>({...proof(),pid:++f.calls.proof===1?12345:12346});
  assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);assert.equal(f.calls.closed,1);
 }
});
test('unsafe metadata, symlink, hardlink and huge file refuse without content read',t=>{
 for(const mode of [0o666,0o640,0o644,0o4000]){const f=fixture(t);fs.chmodSync(f.file,mode);assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);assert.equal(f.calls.read,0);}
 for(const change of ['symlink','hardlink','huge','owner','group']){
  const f=fixture(t);if(change==='symlink'){fs.renameSync(f.file,f.file+'.target');fs.symlinkSync(f.file+'.target',f.file);}if(change==='hardlink')fs.linkSync(f.file,f.file+'.link');if(change==='huge')fs.truncateSync(f.file,2**32);
  if(change==='owner'||change==='group'){const stat=f.io.lstatSync;f.io.lstatSync=p=>Object.assign(stat(p),{[change==='owner'?'uid':'gid']:982});}
  assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);assert.equal(f.calls.read,0);
 }
});
test('thrown secret errors are erased from public output and opened descriptor closes',t=>{
 const f=fixture(t);f.io.readSync=()=>{throw Error('synthetic-secret-token');};assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);assert.equal(f.calls.closed,1);
});
test('partial reads are bounded; open/fstat/read/close failure and extra proof fields stay unknown',t=>{
 const partial=fixture(t),read=partial.io.readSync;partial.io.readSync=(fd,buffer,offset,length,position)=>read(fd,buffer,offset,Math.min(7,length),position);
 assert.equal(readAbbottPdfLogStage(partial.options),expected());assert.ok(partial.calls.read>1);assert.equal(partial.calls.closed,1);
 for(const key of ['openSync','fstatSync','readSync','closeSync']){const f=fixture(t),original=f.io[key];f.io[key]=(...args)=>{if(key==='closeSync')original(...args);throw Error('synthetic-secret-error');};assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);}
 const f=fixture(t);f.options.proveActive=()=>({...proof(),unexpected:'synthetic-secret-error'});assert.equal(readAbbottPdfLogStage(f.options),UNKNOWN_PDF_STAGE);assert.equal(f.calls.read,0);
});
test('fixed contract matches the actual pinned deployed handler and ecosystem, with no standalone execution',()=>{
 const sha=proof().sourceSha;
 const source=file=>execFileSync('/usr/bin/git',['show',`${sha}:${file}`],{encoding:'utf8',maxBuffer:65536});
 const handler=source('apps/abbott/src/lib/abbott-pdf-handler.ts');
 assert.match(handler,/console\.error\("Abbott PDF generation failed", \{\s+stage,\s+error_class: error instanceof Error \? "Error" : "NonError",\s+\}\)/);
 const ecosystem=source('deploy/abbott/ecosystem.config.cjs');
 assert.ok(ecosystem.includes(`error_file: '${LOG}'`));assert.ok(ecosystem.includes("log_date_format: 'YYYY-MM-DD HH:mm:ss'"));assert.match(ecosystem,/merge_logs: true/);
 const moduleSource=fs.readFileSync(new URL('./abbott-pdf-log-stage.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(moduleSource,/console\.|process\.(stdout|stderr)|writeFile|appendFile|renameSync|chmodSync|unlinkSync|child_process/);
});
