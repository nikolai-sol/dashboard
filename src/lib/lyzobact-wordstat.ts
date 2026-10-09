import type {RegionalWordstat} from './lyzobact-regions-types';
export const WORDSTAT_PHRASES = {
  flu:'(грипп|орви)',
  symptoms:'(болит горло|боль +в горле|кашель|насморк)',
  medicines:'(лекарство +от простуды|лекарство +от гриппа|таблетки +от горла|средство +от боли +в горле|лизобакт)',
} as const;
function requireValue(ok:unknown,message:string):asserts ok {if(!ok)throw new Error('Invalid Wordstat: '+message);}
function object(v:unknown):Record<string,unknown>{requireValue(v&&typeof v==='object'&&!Array.isArray(v),'object');return v as Record<string,unknown>;}
function week(value:unknown):number {
  requireValue(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(value),'week format');
  const [a,b]=value.split('/');const start=new Date(a+'T00:00:00Z'),end=new Date(b+'T00:00:00Z');
  requireValue(Number.isFinite(+start)&&Number.isFinite(+end)&&start.toISOString().slice(0,10)===a&&end.toISOString().slice(0,10)===b&&start.getUTCDay()===1&&+end-+start===6*86400000,'full Monday–Sunday week');return +start;
}
/** Shared pure validator: importer and MySQL reader use the same finite contract. */
export function validateRegionalWordstat(value:unknown,regionKey:string):RegionalWordstat {
  const r=object(value);requireValue(r.version===1,'version');requireValue(['complete','unmapped'].includes(String(r.status)),'status');
  requireValue(week(r.currentPeriod)-week(r.priorPeriod)===7*86400000,'consecutive weeks');
  requireValue(typeof r.geographyNote==='string'&&typeof r.limitation==='string','geography notes');
  const missing=r.status==='unmapped';
  if(missing){requireValue(['Nenets AO','Chukotka'].includes(regionKey)&&r.providerRegionId===null&&r.providerGeography===null&&r.mappingStatus==='not_in_returned_tree','missing geography');}
  else {
    requireValue(Number.isSafeInteger(r.providerRegionId)&&Number(r.providerRegionId)>0&&typeof r.providerGeography==='string'&&r.providerGeography.trim(),'provider geography');
    const expected=regionKey==='Moscow Oblast'?'accepted_city_proxy':regionKey==='Leningrad Oblast'?'combined_provider_geography':'exact_or_spelling_alias';
    requireValue(r.mappingStatus===expected&&!['Nenets AO','Chukotka'].includes(regionKey),'mapping category');
    if(regionKey==='Moscow Oblast'||regionKey==='Moscow city')requireValue(r.providerRegionId===213,'Moscow proxy ID');
    if(regionKey==='Leningrad Oblast')requireValue(r.providerRegionId===10174,'combined Leningrad ID');
  }
  requireValue(Array.isArray(r.baskets)&&r.baskets.length===3,'three baskets');const seen=new Set<string>();
  for(const v of r.baskets){const b=object(v),key=String(b.key);requireValue(Object.hasOwn(WORDSTAT_PHRASES,key)&&!seen.has(key),'unique basket');seen.add(key);
    requireValue(b.phrase===WORDSTAT_PHRASES[key as keyof typeof WORDSTAT_PHRASES],'exact phrase');
    if(missing){requireValue(['priorCount','currentCount','wowPct','retrievedAt','rawSha256','httpStatus'].every(k=>b[k]===null)&&b.daysReceived===0&&b.zeroBaseline===false,'missing is null');continue;}
    requireValue(Number.isSafeInteger(b.priorCount)&&Number(b.priorCount)>=0&&Number.isSafeInteger(b.currentCount)&&Number(b.currentCount)>=0,'counts');
    requireValue(b.daysReceived===14&&b.httpStatus===200,'complete14days');
    requireValue(typeof b.rawSha256==='string'&&/^[a-f0-9]{64}$/.test(b.rawSha256),'response hash');
    requireValue(typeof b.retrievedAt==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(b.retrievedAt)&&Number.isFinite(Date.parse(b.retrievedAt)),'retrieval timestamp');
    requireValue(b.zeroBaseline===(b.priorCount===0),'zero baseline');
    if(b.priorCount===0)requireValue(b.wowPct===null,'no percentage on zero base');
    else requireValue(typeof b.wowPct==='number'&&Number.isFinite(b.wowPct)&&Math.abs(b.wowPct-(Number(b.currentCount)/Number(b.priorCount)-1)*100)<1e-8,'weekly percentage');
  }
  return structuredClone(r) as unknown as RegionalWordstat;
}
