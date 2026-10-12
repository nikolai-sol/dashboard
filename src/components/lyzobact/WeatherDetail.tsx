import type {RegionalWeatherRow} from '@/lib/lyzobact-weather';
export default function WeatherDetail({weather}:{weather?:RegionalWeatherRow}){
 return <section className="mt-6 border-t border-slate-200 pt-4" aria-label="Утренняя погода">
  <h3 className="font-semibold text-[#173f64]">Утренняя погода</h3>
  {weather?<>
   <p className="mt-2 text-sm">{weather.centreName} · {weather.dueDate.split('-').reverse().join('.')} · 09:00 по местному времени</p>
   <p className="mt-2 text-xl font-bold text-[#173f64]">{weather.temperatureC===null?'Нет утреннего измерения':`${weather.temperatureC.toLocaleString('ru-RU',{maximumFractionDigits:20})} °C`}</p>
   <p className="mt-2 text-sm">{weather.status==='active'?'Сигнал: 7 утренних измерений подряд ниже 12°C':weather.status==='not_met'?'Условие 7 утренних измерений ниже 12°C не выполнено':'Недостаточно данных для 7 утренних измерений подряд'}</p>
   <p className="mt-1 text-xs text-slate-500">Утренних измерений подряд ниже 12°C: {weather.consecutiveColdMornings} из 7.</p>
   <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Последние 7 утренних измерений</summary><ul className="mt-2 space-y-1">{weather.days.map(day=><li key={day.date}>{day.date.split('-').reverse().join('.')}: {day.temperatureC===null?'нет данных':`${day.temperatureC.toLocaleString('ru-RU',{maximumFractionDigits:20})} °C`}</li>)}</ul></details>
  </>:<p className="mt-2 text-sm text-slate-500">Утренние измерения пока недоступны.</p>}
  <p className="mt-3 text-xs text-slate-500">Источник: <a className="underline" href="https://openweathermap.org/" target="_blank" rel="noreferrer">OpenWeather</a>. Погода на указанную дату, независимо от снимка источников.</p>
 </section>;
}
