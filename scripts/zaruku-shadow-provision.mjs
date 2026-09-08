import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { applyReaderBoundary } from './zaruku-shadow-db.mjs';
import { createHostAdapter, runtimeSecretBytes, publishAnonymousRuntimeSecret, removeOwnedRuntimeSecret } from './zaruku-shadow-host-implementation.mjs';
import { openAdminSession } from './zaruku-shadow-mysql-session.mjs';

const RECEIPT='/var/www/.dashboard-zaruku-shadow/db-provision.json';
const fail=()=>{throw new Error('Zaruku joint provisioning failed; inspect ownership receipt');};

function receipt() {
  const parent=path.dirname(RECEIPT),stat=fs.lstatSync(parent);
  if(!stat.isDirectory()||stat.uid||stat.gid||(stat.mode&0o7777)!==0o700)fail();
  const fd=fs.openSync(RECEIPT,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600),pin=fs.fstatSync(fd);
  fs.closeSync(fd);
  return {save(value) {
    const fd=fs.openSync(RECEIPT,fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW);
    try {
      for(const current of [fs.lstatSync(RECEIPT),fs.fstatSync(fd)])if(current.dev!==pin.dev||current.ino!==pin.ino||current.uid||current.gid||current.nlink!==1||(current.mode&0o7777)!==0o600)fail();
      const current=fs.lstatSync(parent);if(current.dev!==stat.dev||current.ino!==stat.ino)fail();
      fs.ftruncateSync(fd);fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);
      const dir=fs.openSync(parent,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
    } finally {fs.closeSync(fd);}
  }};
}
function productionAdapter(guard) {
  const host=createHostAdapter();
  return {random:randomBytes,openAdmin:()=>openAdminSession(guard),receipt,
    publish(password,onAllocated) {
      const bytes=runtimeSecretBytes(host,password);
      try {return publishAnonymousRuntimeSecret(host,bytes,(fd,parent)=>{
        guard();
        const result=spawnSync('/usr/bin/python3',['-I','-B',path.join(import.meta.dirname,'zaruku-shadow-mysql-session.py'),'publish-secret'],{env:{},stdio:['ignore','pipe','pipe',fd,parent],timeout:10000,maxBuffer:4096});
        if(result.status!==0||result.error||result.signal||result.stdout.length||result.stderr.length)fail();
      },onAllocated);}finally{bytes.fill(0);}
    },remove:identity=>removeOwnedRuntimeSecret(host,identity)};
}

/** The dispatcher is the only production caller; test injection never enters CLI/env. */
export async function provisionReaderAndSecrets(sourceSha,guard,adapter) {
  if(!/^[a-f0-9]{40}$/.test(sourceSha)||typeof guard!=='function')fail();
  guard();adapter??=productionAdapter(guard);
  let admin,password,encoded,journal,secretIdentity=null;
  const state={version:1,sourceSha,runId:randomUUID(),sessionId:null,status:'pending',accountCreated:false,accountDropped:false,secretIdentity:null};
  try {
    journal=adapter.receipt();journal.save(state);
    admin=await adapter.openAdmin();state.sessionId=admin.sessionId;journal.save(state);
    guard();password=adapter.random(48);
    if(!Buffer.isBuffer(password)||password.length!==48)fail();
    encoded=Buffer.from(password.toString('hex'));
    const result=await applyReaderBoundary(admin,encoded,{
      created(){guard();state.accountCreated=true;state.status='account-created';journal.save(state);},
      async verified(value){guard();await adapter.publish(value,identity=>{secretIdentity=identity;state.secretIdentity=identity;state.status='secret-allocated';journal.save(state);});state.status='installed';journal.save(state);},
      dropped(){state.accountDropped=true;state.status='account-rolled-back';journal.save(state);},
    });
    state.status='complete';journal.save(state);
    return {...result,secretInstalled:true,sourceSha};
  } catch {
    if(secretIdentity){try{guard();await adapter.remove(secretIdentity);state.secretIdentity=null;}catch{/* Preserve foreign inode and receipt for review. */}}
    state.status=state.accountDropped?'rolled-back':'requires-review';
    try{journal?.save(state);}catch{/* Never replace an unknown receipt. */}
    fail();
  } finally {
    password?.fill(0);encoded?.fill(0);
    try{await admin?.close();}catch{/* Closing never authorizes another DB session. */}
  }
}
