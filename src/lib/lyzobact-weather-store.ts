import centres from './lyzobact-weather-centres.json';
import {buildRegionalWeather,type WeatherFact,type RegionalWeatherData} from './lyzobact-weather';
import type {RegionalQueryRunner} from './lyzobact-regions-store';
/** Separate current overlay: an old audit selection must never date current weather. */
export async function loadRegionalWeather(run:RegionalQueryRunner,now=new Date()):Promise<RegionalWeatherData>{
 try{
  const rows=await run("SELECT centre_id,DATE_FORMAT(local_date,'%Y-%m-%d') AS local_date,status,temperature_c,DATE_FORMAT(observed_at,'%Y-%m-%dT%H:%i:%sZ') AS observed_at,DATE_FORMAT(retrieved_at,'%Y-%m-%dT%H:%i:%sZ') AS retrieved_at FROM canonical_fact_lyzobact_weather_daily WHERE local_date >= ? AND local_date <= ?",[new Date(+now-9*86400000).toISOString().slice(0,10),new Date(+now+86400000).toISOString().slice(0,10)]);
  return buildRegionalWeather(centres,rows as unknown as WeatherFact[],now);
 }catch{return {status:'unavailable',provider:'OpenWeather',checkedAt:now.toISOString(),regions:[]};}
}
