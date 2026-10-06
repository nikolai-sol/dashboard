#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareRegionalImport,persistRegionalImport} from '../src/lib/lyzobact-regions-import';

export function parseRegionalImportArgs(args:string[]){
  const values:Record<string,string>={};let apply=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--apply'){apply=true;continue;}
    if(!['--register','--sources','--snapshot','--label','--dashboard-id'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Expected --register FILE --sources FILE --snapshot ID --label LABEL --dashboard-id N [--apply]');
    if(values[args[i]])throw new Error('Duplicate argument');values[args[i]]=args[++i];
  }
  for(const key of ['--register','--sources','--snapshot','--label','--dashboard-id'])if(!values[key])throw new Error(`Missing ${key}`);
  const dashboardId=Number(values['--dashboard-id']);if(!Number.isSafeInteger(dashboardId)||dashboardId<=0)throw new Error('Invalid dashboard ID');
  return {register:values['--register'],sources:values['--sources'],snapshotId:values['--snapshot'],label:values['--label'],dashboardId,apply};
}
export async function main(args=process.argv.slice(2)){
  const options=parseRegionalImportArgs(args);
  const [register,sources]=await Promise.all([readFile(options.register,'utf8'),readFile(options.sources,'utf8')]);
  const input=prepareRegionalImport(register,sources,options);
  const summary={mode:options.apply?'apply':'dry_run',dashboardId:options.dashboardId,snapshotId:input.snapshotId,label:input.label,checkedAt:input.checkedAt,regions:input.rows.length,sources:input.sourcePages.length,registerSha256:input.registerSha256,sourcesSha256:input.sourcesSha256,inputSha256:input.inputSha256,metrics:{cases:input.rows.filter(r=>r.cases!==null).length,casesPrior:input.rows.filter(r=>r.casesPrior!==null).length,reportedWow:input.rows.filter(r=>r.reportedWowPct!==null).length,calculatedWow:input.rows.filter(r=>r.calculatedWowPct!==null).length},campaignUnknown:input.rows.filter(r=>r.campaignStatus==='unknown').length};
  if(!options.apply){console.log(JSON.stringify(summary,null,2));return;}
  // No network/database module is loaded in dry-run mode. Never applies migrations.
  const {default:pool}=await import('../src/lib/db');
  try{
    const connection=await pool.getConnection();
    try{
      const [rows]=await connection.execute('SELECT client_id FROM dashboards WHERE id = ? AND is_active = TRUE',[options.dashboardId]);
      const row=(rows as {client_id:string}[])[0];
      if(!row||!['lyzobact','lisobact'].includes(row.client_id))throw new Error('Target must be an active Lysobact dashboard');
      const result=await persistRegionalImport({beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),rollback:()=>connection.rollback(),execute:(sql,params)=>connection.execute(sql,[...(params??[])] as (string|number|null)[])},options.dashboardId,input);
      console.log(JSON.stringify({...summary,result},null,2));
    }finally{connection.release();}
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){main().catch((error:unknown)=>{
  // Do not expose mysql error messages containing connection details or source payloads.
  const code=(error as {code?:string}).code;
  console.error(code?`Import failed (${/^[A-Z0-9_]+$/.test(code)?code:'database_error'}).`:(error instanceof Error?error.message:'Import failed.'));process.exitCode=1;
});}
