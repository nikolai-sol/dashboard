import type { RowDataPacket } from 'mysql2';
import type { RegionalModuleData, RegionalRow, RegionalSourcePage } from './lyzobact-regions-types';
import {validateRegionalWordstat} from './lyzobact-wordstat';
export type RegionalQueryRunner = (sql:string,params:readonly (number|string)[])=>Promise<Record<string,unknown>[]>;
const query:RegionalQueryRunner=async(sql,params)=>{
  // Loaded only when executing a runtime query; offline importer/tests need no credentials.
  const {default:pool}=await import('./db');
  const [rows]=await pool.execute<RowDataPacket[]>(sql,[...params]);return rows;
};
function object(value:unknown):Record<string,unknown>{
  const parsed=typeof value==='string'?JSON.parse(value):value;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid stored payload');
  return parsed as Record<string,unknown>;
}
function validId(id:number){return Number.isSafeInteger(id)&&id>0;}
/** Dashboard authorization belongs to the caller; this additional gate never grants access. */
export async function isRegionalModuleEnabled(dashboardId:number,run:RegionalQueryRunner=query):Promise<boolean>{
  if(!validId(dashboardId))return false;
  const rows=await run('SELECT client_id, config FROM dashboards WHERE id = ? AND is_active = TRUE LIMIT 1',[dashboardId]);
  const row=rows[0];if(!row||!['lyzobact','lisobact'].includes(String(row.client_id)))return false;
  try {const config=object(row.config);return object(config.lyzobact_regions).enabled===true;}catch{return false;}
}

/** Public access is a separate, default-deny opt-in for this single regional module. */
export async function isRegionalModulePublicReadEnabled(dashboardId:number,run:RegionalQueryRunner=query):Promise<boolean>{
 if(dashboardId!==49)return false;
 const rows=await run('SELECT client_id, is_active, config FROM dashboards WHERE id = ? AND is_active = TRUE LIMIT 1',[dashboardId]);
 const row=rows[0];if(!row||row.client_id!=='lyzobact'||(row.is_active!==1&&row.is_active!==true))return false;
 try{const config=object(object(row.config).lyzobact_regions);return config.enabled===true&&config.public_read===true;}catch{return false;}
}

function rowPayload(value:unknown):RegionalRow{
  const r=object(value);
  if(typeof r.regionKey!=='string'||typeof r.name!=='string'||typeof r.period!=='string'||typeof r.checkedAt!=='string'||typeof r.sourceQuality!=='string'||typeof r.isHistorical!=='boolean'||typeof r.isAutumn2026!=='boolean')throw new Error('Invalid stored region');
  for(const key of ['cases','casesPrior','reportedWowPct','calculatedWowPct','wordstatWowPct','temperatureC'])if(r[key]!==null&&(typeof r[key]!=='number'||!Number.isFinite(r[key])))throw new Error('Invalid stored metric');
  if(!['primary_autumn','secondary_autumn','historical','index_only','unknown'].includes(String(r.sourceQualityKind))||!['active','inactive','unknown'].includes(String(r.campaignStatus)))throw new Error('Invalid stored status');
  if(r.wordstat!==undefined)r.wordstat=validateRegionalWordstat(r.wordstat,r.regionKey as string);
  return r as unknown as RegionalRow;
}
function sourcePayload(value:unknown):RegionalSourcePage{
  const r=object(value);if(typeof r.regionKey!=='string'||!Number.isSafeInteger(r.id)||typeof r.data!=='string')throw new Error('Invalid source payload');return r as unknown as RegionalSourcePage;
}
export async function loadRegionalModule(dashboardId:number,snapshotId?:string,run:RegionalQueryRunner=query):Promise<RegionalModuleData>{
  const empty:RegionalModuleData={dashboardId,status:'not_imported',snapshots:[],selectedSnapshotId:null,rows:[],sourcePages:[]};
  if(!validId(dashboardId))return {...empty,status:'unavailable',errorCode:'read_failed'};
  try{
    const snapshots=await run("SELECT id,label,checked_at,region_count,source_count FROM lyzobact_regions_snapshots WHERE dashboard_id = ? AND publication_status = 'published' ORDER BY checked_at DESC, published_at DESC, id DESC",[dashboardId]);
    const publicSnapshots=snapshots.map(s=>({id:String(s.id),label:String(s.label),checkedAt:String(s.checked_at)}));
    if(!snapshots.length)return empty;
    const selected=snapshotId?snapshots.find(s=>s.id===snapshotId):snapshots[0];
    if(!selected)return {...empty,status:'snapshot_not_found',snapshots:publicSnapshots};
    const id=String(selected.id);
    const [observations,pages]=await Promise.all([
      run('SELECT region_key,payload_json FROM lyzobact_regions_observations WHERE dashboard_id = ? AND snapshot_id = ? ORDER BY region_key',[dashboardId,id]),
      run('SELECT source_ordinal,region_key,payload_json FROM lyzobact_regions_source_pages WHERE dashboard_id = ? AND snapshot_id = ? ORDER BY source_ordinal',[dashboardId,id]),
    ]);
    if(observations.length!==Number(selected.region_count)||pages.length!==Number(selected.source_count))throw new Error('Incomplete published snapshot');
    const rows=observations.map(r=>{const parsed=rowPayload(r.payload_json);if(parsed.regionKey!==r.region_key)throw new Error('Region identity mismatch');return parsed});
    const sourcePages=pages.map(r=>{const parsed=sourcePayload(r.payload_json);if(parsed.regionKey!==r.region_key||parsed.id!==Number(r.source_ordinal))throw new Error('Source identity mismatch');return parsed});
    if(new Set(rows.map(r=>r.regionKey)).size!==rows.length||sourcePages.some(p=>!rows.some(r=>r.regionKey===p.regionKey)))throw new Error('Invalid snapshot relationships');
    return {dashboardId,status:'ready',snapshots:publicSnapshots,selectedSnapshotId:id,rows,sourcePages};
  }catch(error){return {...empty,status:'unavailable',errorCode:(error as {code?:string})?.code==='ER_NO_SUCH_TABLE'?'schema_missing':'read_failed'};}
}
