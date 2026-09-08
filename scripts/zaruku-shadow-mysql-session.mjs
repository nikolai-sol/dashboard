import path from 'node:path';
import { spawn } from 'node:child_process';

const fail=()=>{throw new Error('Zaruku private MySQL session failed');};
export function bindSessionSql(sql,params=[]) {
  if(typeof sql!=='string'||sql.length>64000||/[;\n\r\0\\]/.test(sql))fail();
  let index=0;
  const result=sql.replaceAll('?',()=>{
    if(index>=params.length)fail();const value=params[index++];
    if(value&&typeof value==='object'&&value.toSqlString?.()==="'dashboard_zaruku_reader'@'127.0.0.1'")return value.toSqlString();
    if(Number.isSafeInteger(value)&&value>=0)return String(value);
    if(typeof value!=='string'||value.length>4096)fail();
    if(sql.startsWith('CREATE USER ')){if(!/^[a-f0-9]{96}$/.test(value))fail();return `'${value}'`;}
    return `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
  });
  if(index!==params.length)fail();return result;
}

async function session(mode,password,guard) {
  guard();
  const child=spawn('/usr/bin/python3',['-I','-B',path.join(import.meta.dirname,'zaruku-shadow-mysql-session.py'),'session'],{env:{},stdio:['pipe','pipe','pipe']});
  let pending=null,closed=false,output='';
  const broken=()=>{closed=true;if(pending){clearTimeout(pending.timer);pending.reject(new Error('Zaruku private MySQL session failed'));pending=null;}child.kill();};
  child.on('error',broken);child.on('exit',broken);child.stderr.on('data',broken);
  for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',broken);
  child.stdout.on('data',chunk=>{
    output+=chunk.toString('utf8');if(output.length>131072||!pending)return broken();
    if(!output.endsWith('\n'))return;
    try {
      const value=JSON.parse(output);output='';const current=pending;pending=null;clearTimeout(current.timer);current.resolve(value);
    }catch{broken();}
  });
  const send=value=>new Promise((resolve,reject)=>{
    try{guard();if(closed||pending)fail();pending={resolve,reject,timer:setTimeout(broken,40000)};child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)broken();});}catch{reject(new Error('Zaruku private MySQL session failed'));}
  });
  try {
    const ready=await send({mode,password});
    if(Object.keys(ready).join(',')!=='sessionId'||!/^\d+$/.test(ready.sessionId))fail();
    return {sessionId:ready.sessionId,async query(sql,params=[]) {
      const value=await send({sql:bindSessionSql(sql,params)});
      if(Object.keys(value).join(',')==='errno'&&[1044,1045,1142].includes(value.errno))throw Object.assign(new Error('Zaruku access denied'),{errno:value.errno});
      if(Object.keys(value).join(',')!=='rows'||!Array.isArray(value.rows)){broken();fail();}
      return value.rows;
    },async close(){if(closed)return;closed=true;child.stdin.end();const finished=new Promise(resolve=>child.once('close',resolve));const timer=setTimeout(()=>child.kill('SIGKILL'),1000);await finished;clearTimeout(timer);}};
  }catch{broken();fail();}
}

export async function openAdminSession(guard) {
  const admin=await session('admin',null,guard);
  admin.context=async()=>{
    const rows=await admin.query('SELECT CURRENT_USER() AS currentUser');
    if(rows.length!==1||Object.keys(rows[0]).join(',')!=='currentUser')fail();
    return {platform:process.platform,effectiveUid:process.geteuid(),protocol:'socket',currentUser:rows[0].currentUser};
  };
  admin.openReader=password=>session('reader',password,guard);
  return admin;
}
