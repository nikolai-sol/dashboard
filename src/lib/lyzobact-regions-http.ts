type Access = {authorized:boolean;audience?:string;context:null|{id:number;client_id:string;client_name:string;dashboard_name:string;auth_mode:string}};
type Dependencies = {authorize:(request:Request,id:string)=>Promise<Access>;enabled:(id:number)=>Promise<boolean>;load:(id:number,snapshot?:string)=>Promise<unknown>};
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
   if(access.context.auth_mode==='public') return json({error:'Для регионального модуля требуется закрытый доступ к дашборду.'},403);
   if(access.audience!=='manager') return json({error:'Региональный модуль доступен только менеджеру.'},403);
   const url=new URL(request.url), snapshot=url.searchParams.get('snapshot')??undefined;
   if(snapshot!==undefined&&!/^[A-Za-z0-9_-]{1,64}$/.test(snapshot)) return json({error:'Некорректный идентификатор снимка.'},400);
   if(url.searchParams.get('availability')==='1') return json({enabled:true});
   const data=await dependencies.load(access.context.id,snapshot);
   if(data&&typeof data==='object'&&'status' in data&&data.status==='unavailable') return json({error:'Данные регионального модуля временно недоступны.'},503);
   if(data&&typeof data==='object'&&'status' in data&&data.status==='snapshot_not_found') return json({error:'Снимок не найден.'},404);
   return json(data);
  } catch {return json({error:'Данные регионального модуля временно недоступны.'},503);}
 };
}
