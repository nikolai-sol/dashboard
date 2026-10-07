import {ADMIN_SESSION_COOKIE,parseCookieValue} from './access-auth';
type Dependencies={verifySession:(token:string|null)=>{email:string}|null;resolve:(slug:'lyzobact')=>Promise<number|null>;enabled:(id:number)=>Promise<boolean>;load:(id:number,snapshot?:string)=>Promise<unknown>};
const headers={'Cache-Control':'private, no-store','Content-Type':'application/json; charset=utf-8'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
/** Dedicated admin entry: no query-supplied dashboard identity and no viewer fallback. */
export function createRegionalAdminGetHandler(deps:Dependencies){return async(request:Request)=>{
 try{if(!deps.verifySession(parseCookieValue(request.headers.get('cookie'),ADMIN_SESSION_COOKIE)))return json({error:'Требуется вход администратора'},401);}catch{return json({error:'Требуется вход администратора'},401);}
 try{
  const snapshot=new URL(request.url).searchParams.get('snapshot')??undefined;
  if(snapshot!==undefined&&!/^[A-Za-z0-9_-]{1,64}$/.test(snapshot))return json({error:'Некорректный идентификатор снимка'},400);
  const id=await deps.resolve('lyzobact');if(id===null||!await deps.enabled(id))return json({error:'Региональный модуль не включён'},404);
  const data=await deps.load(id,snapshot);
  if(data&&typeof data==='object'&&'status' in data){if(data.status==='unavailable')return json({error:'Данные временно недоступны'},503);if(data.status==='snapshot_not_found')return json({error:'Снимок не найден'},404);}
  return json(data);
 }catch{return json({error:'Данные временно недоступны'},503);}
};}
