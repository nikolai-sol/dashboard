export type WeatherCentre={regionKey:string;centreId:string;centreName:string;latitude:number;longitude:number;timeZone:string;sourceUrl:string;mappingNote?:string};
export type WeatherFact={centre_id:string;local_date:string;status:string;temperature_c:number|null;observed_at:string|null;retrieved_at:string};
export type RegionalWeatherRow={regionKey:string;centreName:string;timeZone:string;dueDate:string;temperatureC:number|null;observedAt:string|null;retrievedAt:string|null;status:'active'|'not_met'|'insufficient_data';consecutiveColdMornings:number;days:{date:string;temperatureC:number|null}[]};
export type RegionalWeatherData={status:'ready'|'unavailable';provider:'OpenWeather';checkedAt:string;regions:RegionalWeatherRow[]};
function localTime(date:Date,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));return {date:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};
}
function previousDate(date:string,days=1){return new Date(Date.parse(date+'T12:00:00Z')-days*86400000).toISOString().slice(0,10);}
/** Validate the actual retrieval window, not an invented daily average or forecast. */
export function validateWeatherSample(f:WeatherFact,c:WeatherCentre):boolean{
 if(f.centre_id!==c.centreId||f.status!=='valid'||typeof f.temperature_c!=='number'||!Number.isFinite(f.temperature_c)||!f.observed_at)return false;
 const observed=new Date(f.observed_at),retrieved=new Date(f.retrieved_at);
 if(!Number.isFinite(+observed)||!Number.isFinite(+retrieved))return false;
 const local=localTime(retrieved,c.timeZone),age=+retrieved-+observed;
 return local.date===f.local_date&&local.minutes>=540&&local.minutes<555&&localTime(observed,c.timeZone).date===f.local_date&&age>=-300000&&age<=10800000;
}
export function buildRegionalWeather(centres:WeatherCentre[],facts:WeatherFact[],now=new Date()):RegionalWeatherData{
 return {status:'ready',provider:'OpenWeather',checkedAt:now.toISOString(),regions:centres.map(c=>{
  const valid=new Map(facts.filter(f=>validateWeatherSample(f,c)&&Date.parse(f.retrieved_at)<=+now).map(f=>[f.local_date,f]));
  const local=localTime(now,c.timeZone),dueDate=local.minutes>=555||valid.has(local.date)?local.date:previousDate(local.date);
  const days=Array.from({length:7},(_,i)=>{const date=previousDate(dueDate,i);return {date,temperatureC:valid.get(date)?.temperature_c??null};});
  let consecutiveColdMornings=0,status:RegionalWeatherRow['status']='active';
  for(const day of days){if(day.temperatureC===null){status='insufficient_data';break;}if(day.temperatureC>=12){status='not_met';break;}consecutiveColdMornings++;}
  const latest=valid.get(dueDate);
  return {regionKey:c.regionKey,centreName:c.centreName,timeZone:c.timeZone,dueDate,temperatureC:latest?.temperature_c??null,observedAt:latest?.observed_at??null,retrievedAt:latest?.retrieved_at??null,status,consecutiveColdMornings,days};
 })};
}
