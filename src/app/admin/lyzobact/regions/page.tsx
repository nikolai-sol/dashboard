'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import RegionalDashboard from '@/components/lyzobact/RegionalDashboard';
import type {RegionalModuleData} from '@/lib/lyzobact-regions-types';
export default function AdminRegionsPage(){
 const [snapshot,setSnapshot]=useState(''),[data,setData]=useState<RegionalModuleData|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{const controller=new AbortController();Promise.resolve().then(()=>{if(controller.signal.aborted)return;setData(null);setError(null);const query=snapshot?'?snapshot='+encodeURIComponent(snapshot):'';fetch('/api/admin/lyzobact/regions'+query,{cache:'no-store',signal:controller.signal}).then(async response=>{if(response.status===401){window.location.assign('/admin/login?next=%2Fadmin%2Flyzobact%2Fregions');return;}const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось загрузить данные');setData(result);}).catch(error=>{if(error.name!=='AbortError')setError(error.message);});});return()=>controller.abort();},[snapshot]);
 return <main className="min-h-screen bg-[#f6f8fa]"><div className="mx-auto max-w-[1600px] px-5 pt-6 md:px-8"><Link href="/admin" className="text-sm font-semibold text-sky-800">← Администрирование</Link></div>{error?<section role="alert" className="mx-auto my-16 max-w-2xl rounded-2xl border border-amber-200 bg-white p-8"><h1 className="text-xl font-bold">Региональный модуль недоступен</h1><p className="mt-3">{error}</p><p className="mt-3 text-sm text-slate-500">Отсутствующие данные не заменяются нулями.</p></section>:data?<RegionalDashboard data={data} onSnapshotChange={setSnapshot}/>:<p role="status" className="p-16 text-center text-slate-500">Загружаем проверенный снимок…</p>}</main>;
}
