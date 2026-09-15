import fs from 'node:fs';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';

export const UNKNOWN_PDF_STAGE = 'ABBOTT_PDF_STAGE stage=unknown class=unknown\n';
const LOG='/var/log/dashboard-abbott-error.log',MAX=65536;
const STAGES=['authorize','launch','prepare','navigate','ready','render'];
const CLASSES=['Error','NonError'];
const DATE='[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}';
const marker=new RegExp(`^(${DATE}): Abbott PDF generation failed (.*)$`);
const fields=new RegExp(`^\\{ stage: '(${STAGES.join('|')})', error_class: '(Error|NonError)' \\}$`);
const same=(a,b)=>['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
const refuse=()=>{throw Error('ABBOTT_PDF_STAGE_UNKNOWN');};

// This is not a general log parser: an unframed arbitrary exception can forge a
// marker. Any unknown context, partial record, duplicate timestamp or rotation
// therefore makes this entire bounded snapshot unknown, not a guessed stage.
export function classifyAbbottPdfLog(bytes) {
 try {
  if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX)refuse();
  const text=bytes.toString('utf8');
  if(!Buffer.from(text).equals(bytes)||/[^\x20-\x7e\n]/.test(text)||!text.endsWith('\n'))refuse();
  const lines=text.slice(0,-1).split('\n');let latest='',stage,kind;
  for(let index=0;index<lines.length;index++){
   const match=marker.exec(lines[index]);if(!match)refuse();
   const [,date,body]=match;
   if(new Date(date.replace(' ','T')+'Z').toISOString()!==date.replace(' ','T')+'.000Z'||date<=latest)refuse();
   let object=body;
   if(body==='{'){
    const next=lines.slice(index+1,index+4);if(next.length!==3)refuse();
    const repeated=next.every(line=>line.startsWith(date+': '));
    const values=repeated?next.map(line=>line.slice(date.length+2)):next;
    if(!/^  stage: '[a-z]+',$/.test(values[0])||!/^  error_class: '(Error|NonError)'$/.test(values[1])||values[2]!=='}')refuse();
    object=`{ ${values[0].trim()} ${values[1].trim()} }`;index+=3;
   }
   const parsed=fields.exec(object);if(!parsed)refuse();
   latest=date;stage=parsed[1];kind=parsed[2];
  }
  if(!STAGES.includes(stage)||!CLASSES.includes(kind))refuse();
  return `ABBOTT_PDF_STAGE stage=${stage} class=${kind}\n`;
 }catch{return UNKNOWN_PDF_STAGE;}
}

function checkedProof(proveActive){
 if(typeof proveActive!=='function')refuse();const value=proveActive();
 if(!value||Object.keys(value).sort().join(',')!=='bootId,errorLog,gid,pid,pmId,releaseId,sourceSha,startTime,uid'||
  value.bootId!=='1c736efb-eaa2-42d9-b247-bd1a2ef36a4e'||!Number.isSafeInteger(value.pmId)||value.pmId<0||
  !Number.isSafeInteger(value.pid)||value.pid<=0||!/^\d{1,20}$/.test(value.startTime)||value.uid!==982||value.gid!==984||
  value.releaseId!=='8c79caf495f147ad91b2174b9bc5f65c'||value.sourceSha!=='6f09982fb1e8068f02340ddfcb5c945fb02ebfd5'||value.errorLog!==LOG)refuse();
 return structuredClone(value);
}

// No standalone CLI or SSH action. Caller must supply the reviewed live proof
// that reconciles kernel PID/start and PM2 identity with the protected receipt.
// Unknown ownership/mode/rotation is a refusal; never chmod or follow .1 files.
export function readAbbottPdfLogStage({io=fs,hostname=os.hostname,getuid=()=>process.getuid(),proveActive}={}) {
 let fd,bytes,result=UNKNOWN_PDF_STAGE;
 try {
  if(hostname()!=='ybjqbzojln'||getuid()!==0)refuse();
  const beforeProof=checkedProof(proveActive);
  for(const dir of ['/var','/var/log']){const stat=io.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0||stat.mode&0o022||io.realpathSync(dir)!==dir)refuse();}
  const before=io.lstatSync(LOG);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||before.nlink!==1||(before.mode&0o7777)!==0o600||
   !Number.isSafeInteger(before.size)||before.size<=0||before.size>MAX||io.realpathSync(LOG)!==LOG)refuse();
  fd=io.openSync(LOG,io.constants.O_RDONLY|io.constants.O_NOFOLLOW);
  if(!same(before,io.fstatSync(fd)))refuse();
  bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const length=io.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!Number.isSafeInteger(length)||length<=0||length>bytes.length-offset)refuse();offset+=length;}
  if(!same(before,io.fstatSync(fd))||!same(before,io.lstatSync(LOG))||io.realpathSync(LOG)!==LOG||!isDeepStrictEqual(beforeProof,checkedProof(proveActive)))refuse();
  result=classifyAbbottPdfLog(bytes);
 }catch{result=UNKNOWN_PDF_STAGE;}
 finally{bytes?.fill(0);if(fd!==undefined)try{io.closeSync(fd);}catch{result=UNKNOWN_PDF_STAGE;}}
 return result;
}
