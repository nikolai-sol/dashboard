import fs from'node:fs';import path from'node:path';import{RECOVERY_REASONS}from'./abbott-recovery-diagnostics.mjs';
export const RECOVERY_EVIDENCE_DIRECTORY='/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation/.superpowers/sdd/.abbott-recovery-evidence';
const fail=()=>{throw Error('ABBOTT_RECOVERY_EVIDENCE_REFUSED');};
const valid=row=>row&&Object.keys(row).sort().join(',')==='exit,exitVerified,pid,stage,start'&&(row.pid===null||Number.isSafeInteger(row.pid)&&row.pid>0)&&(row.start===null||typeof row.start==='string'&&/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ 0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9] [0-9]{4}$/.test(row.start))&&typeof row.exit==='boolean'&&typeof row.exitVerified==='boolean'&&(!row.exitVerified||row.exit)&&Object.hasOwn(RECOVERY_REASONS,row.stage);
// The only production path is fixed. The filesystem seam is for temp fixtures.
export function createRecoveryEvidence(filesystem=fs){
 const root=RECOVERY_EVIDENCE_DIRECTORY,file=root+'/identity.json',next=file+'.next',uid=process.getuid();let directory,last;
 const same=(a,b)=>['dev','ino','mode','uid','gid','nlink'].every(k=>a[k]===b[k]);
 const checkDirectory=()=>{const s=filesystem.lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o7777)!==0o700||filesystem.realpathSync(root)!==root||!['dev','ino','mode','uid','gid'].every(k=>directory[k]===s[k]))fail();};
 const read=()=>{checkDirectory();const a=filesystem.lstatSync(file);if(!a.isFile()||a.nlink!==1||a.uid!==uid||(a.mode&0o7777)!==0o600||a.size>1024)fail();const fd=filesystem.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;try{if(!same(a,filesystem.fstatSync(fd)))fail();bytes=filesystem.readFileSync(fd);if(bytes.length!==a.size||!same(a,filesystem.lstatSync(file)))fail();const value=JSON.parse(bytes);if(!valid(value)||JSON.stringify(value)!==JSON.stringify(last))fail();return value;}finally{bytes?.fill(0);filesystem.closeSync(fd);}};
 try{
  const parent=path.dirname(root);if(filesystem.realpathSync(parent)!==parent)fail();
  const p=filesystem.lstatSync(parent);if(!p.isDirectory()||p.uid!==uid||p.mode&0o022)fail();
  if(filesystem.lstatSync(root,{throwIfNoEntry:false}))fail();
  filesystem.mkdirSync(root,{mode:0o700});directory=filesystem.lstatSync(root);checkDirectory();
 }catch{fail();}
 return{
  record(row){let bytes,temporary;try{
   if(!valid(row))fail();checkDirectory();if(last)read();else if(filesystem.lstatSync(file,{throwIfNoEntry:false}))fail();
   if(filesystem.lstatSync(next,{throwIfNoEntry:false}))fail();bytes=Buffer.from(JSON.stringify(row)+'\n');
   const fd=filesystem.openSync(next,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   try{filesystem.fchmodSync(fd,0o600);temporary=filesystem.fstatSync(fd);filesystem.writeFileSync(fd,bytes);filesystem.fsyncSync(fd);}finally{filesystem.closeSync(fd);}
   checkDirectory();if(last)read();filesystem.renameSync(next,file);last={...row};
  }catch{fail();}finally{bytes?.fill(0);if(temporary)try{checkDirectory();const now=filesystem.lstatSync(next,{throwIfNoEntry:false});if(now&&same(now,temporary))filesystem.unlinkSync(next);}catch{}}},
  finish(){try{const row=last?read():null;const summary={identityCaptured:Boolean(row?.pid&&row?.start),exitObserved:row?.exit??false,exitVerified:row?.exitVerified??false};checkDirectory();if(filesystem.readdirSync(root).sort().join()!==(last?'identity.json':''))fail();if(last)filesystem.unlinkSync(file);filesystem.rmdirSync(root);return summary;}catch{fail();}},
 };
}
