export type SignalState='unknown'|'growth'|'decline'|'stable';
export function signalState(row:{reportedWowPct:number|null;calculatedWowPct:number|null;isHistorical:boolean;isAutumn2026:boolean;sourceQualityKind:string}):SignalState {
 if(row.isHistorical||!row.isAutumn2026||!['primary_autumn','secondary_autumn'].includes(row.sourceQualityKind))return 'unknown';
 const n=row.reportedWowPct??row.calculatedWowPct;
 return n===null||!Number.isFinite(n)?'unknown':n>0?'growth':n<0?'decline':'stable';
}
export function campaignState(status:unknown):'active'|'inactive'|'unknown' {return status==='active'||status==='inactive'?status:'unknown';}
export function moduleHref(id:string,params:URLSearchParams) {const query=new URLSearchParams();for(const key of ['access_token','embed_key']){const v=params.get(key);if(v)query.set(key,v);}return `/dashboard/${encodeURIComponent(id)}/regions${query.size?'?'+query:''}`;}
export const signalColors={unknown:'#dfe5e9',growth:'#f59b42',decline:'#71ada5',stable:'#8db7d4'};
export const campaignColors={unknown:'#dfe5e9',active:'#1482b1',inactive:'#b9c3cc'};
export const qualityLabels:Record<string,string>={primary_autumn:'Первичный источник · осень 2026',secondary_autumn:'СМИ / вторичный источник · осень 2026',historical:'Исторический источник',index_only:'Только поисковый индекс',unknown:'Качество не установлено'};
export function number(value:number|null|undefined){return value==null?'—':value.toLocaleString('ru-RU',{maximumFractionDigits:2});}
export function percent(value:number|null|undefined){return value==null?'—':`${value>0?'+':''}${number(value)}%`;}
export function safeSourceUrl(value:string|null|undefined){if(!value)return undefined;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}
/** The portal uses client slugs; numeric routes deliberately avoid global capability probes. */
export function isRegionalNavigationCandidate(id:string){return ['lyzobact','lisobact'].includes(id.toLowerCase());}
