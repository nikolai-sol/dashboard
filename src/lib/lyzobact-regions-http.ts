
import type {RegionalModuleData,RegionalRow,RegionalSourcePage,RegionalWordstat,RegionalWordstatBasket} from './lyzobact-regions-types';
const publicRowKeys=['regionKey','name','period','publicationDate','checkedAt','cases','casesPrior','reportedWowPct','calculatedWowPct','comparisonBasis','sourceUrl','alternateSourceUrl','sourceQuality','sourceQualityKind','isHistorical','isAutumn2026','geography','organization','notes','available','status','cadence','format','restriction','campaignStatus','campaignStatusAt','wordstatWowPct','temperatureC'] as const satisfies readonly(keyof RegionalRow)[];
const publicSourceKeys=['id','regionKey','regionName','stage','period','publicationDate','data','url','verification','geography','checkedAt','restriction','rawSha256'] as const satisfies readonly(keyof RegionalSourcePage)[];
const publicWordstatKeys=['version','status','priorPeriod','currentPeriod','providerRegionId','providerGeography','mappingStatus','geographyNote','limitation'] as const satisfies readonly(keyof RegionalWordstat)[];
const publicBasketKeys=['key','phrase','priorCount','currentCount','wowPct','zeroBaseline','daysReceived','httpStatus','retrievedAt','rawSha256'] as const satisfies readonly(keyof RegionalWordstatBasket)[];
function selectFields<T extends object,K extends keyof T>(value:T,keys:readonly K[]):Pick<T,K>{
 return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]])) as Pick<T,K>;
}
/** Anonymous transport is an allowlist; stored manager objects are never mutated. */
function publicPayload(input:unknown){
 const data=input as RegionalModuleData;
 return {dashboardId:data.dashboardId,status:data.status,selectedSnapshotId:data.selectedSnapshotId,
  snapshots:data.snapshots.map(({id,label,checkedAt})=>({id,label,checkedAt})),
  rows:data.rows.map(row=>({...selectFields(row,publicRowKeys),...(row.wordstat?{wordstat:{...selectFields(row.wordstat,publicWordstatKeys),baskets:row.wordstat.baskets.map(basket=>selectFields(basket,publicBasketKeys))}}:{})})),
  sourcePages:data.sourcePages.map(page=>selectFields(page,publicSourceKeys))};
}
type Access = {authorized:boolean;audience?:string;context:null|{id:number;client_id:string;client_name:string;dashboard_name:string;auth_mode:string}};
type Dependencies = {authorize:(request:Request,id:string)=>Promise<Access>;enabled:(id:number)=>Promise<boolean>;publicRead?:(id:number)=>Promise<boolean>;load:(id:number,snapshot?:string)=>Promise<unknown>};
const headers={'Cache-Control':'private, no-store','Content-Type':'application/json; charset=utf-8'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function createRegionalGetHandler(dependencies:Dependencies) {
 return async (request:Request,context:{params:Promise<{id:string}>|{id:string}})=>{
  try {
   const {id}=await context.params;
   const access=await dependencies.authorize(request,id);
   if(!access.context) return json({error:'Dashboard not found'},404);
   if(!access.authorized) return json({error:'Authentication required',auth_required:true,dashboard:{dashboard_name:access.context.dashboard_name,client_name:access.context.client_name,auth_mode:access.context.auth_mode}},401);
   if(!await dependencies.enabled(access.context.id)) return json({error:'Региональный модуль не включён для этого дашборда.'},404);
   const publicRequest=access.context.auth_mode==='public';
   if(publicRequest&&(access.context.id!==49||access.context.client_id!=='lyzobact'||!['49','lyzobact'].includes(id)||!await dependencies.publicRead?.(49)))return json({error:'Публичный доступ к региональному модулю не включён.'},403);
   if(!publicRequest&&access.audience!=='manager') return json({error:'Региональный модуль доступен только менеджеру.'},403);
   const url=new URL(request.url), snapshot=url.searchParams.get('snapshot')??undefined;
   if(snapshot!==undefined&&!/^[A-Za-z0-9_-]{1,64}$/.test(snapshot)) return json({error:'Некорректный идентификатор снимка.'},400);
   if(url.searchParams.get('availability')==='1') return json({enabled:true});
   const data=await dependencies.load(access.context.id,snapshot);
   if(data&&typeof data==='object'&&'status' in data&&data.status==='unavailable') return json({error:'Данные регионального модуля временно недоступны.'},503);
   if(data&&typeof data==='object'&&'status' in data&&data.status==='snapshot_not_found') return json({error:'Снимок не найден.'},404);
   return json(publicRequest?publicPayload(data):data);
  } catch {return json({error:'Данные регионального модуля временно недоступны.'},503);}
 };
}
