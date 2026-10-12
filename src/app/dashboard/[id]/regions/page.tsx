'use client';
import {useEffect,useState} from 'react';
import {useParams,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import DashboardAccessGate from '@/components/DashboardAccessGate';
import RegionalDashboard from '@/components/lyzobact/RegionalDashboard';
import type {RegionalModuleData} from '@/lib/lyzobact-regions-types';
export default function RegionsPage(){
 const params=useParams<{id:string}>(),search=useSearchParams();
 const [token,setToken]=useState(search.get('access_token')??''),[data,setData]=useState<RegionalModuleData|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
 const [auth,setAuth]=useState<{dashboard_name:string;client_name:string;auth_mode:'email_password'|'password_only'}|null>(null);
 useEffect(()=>{const controller=new AbortController();const q=new URLSearchParams();if(token)q.set('access_token',token);const embed=search.get('embed_key');if(embed)q.set('embed_key',embed);Promise.resolve().then(()=>{if(controller.signal.aborted)return;setLoading(true);setData(null);setError(null);setAuth(null);
 fetch(`/api/dashboard/${encodeURIComponent(params.id)}/regions${q.size?`?${q}`:''}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const json=await response.json();if(response.status===401&&json.auth_required){setAuth(json.dashboard);return;}if(!response.ok)throw Error(json.error||'Не удалось загрузить региональный модуль.');setData(json);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});});return()=>controller.abort();},[params.id,token,reload,search]);
 const backQuery=new URLSearchParams();if(token)backQuery.set('access_token',token);
 return <main className="min-h-screen bg-[#f6f8fa]"><div className="mx-auto max-w-[1600px] px-5 pt-6 md:px-8"><Link href={`/dashboard/${encodeURIComponent(params.id)}${backQuery.size?'?'+backQuery:''}`} className="text-sm font-semibold text-sky-800">← К рекламному отчёту</Link></div>{auth?<DashboardAccessGate dashboardId={params.id} dashboardName={auth.dashboard_name} clientName={auth.client_name} authMode={auth.auth_mode} onSuccess={value=>{if(value)setToken(value);setReload(v=>v+1);}}/>:loading?<p role="status" className="p-16 text-center text-slate-500">Загружаем проверенный снимок…</p>:error?<section role="alert" className="mx-auto my-16 max-w-2xl rounded-2xl border border-amber-200 bg-white p-8"><h1 className="text-xl font-bold text-slate-800">Региональный модуль недоступен</h1><p className="mt-3 text-slate-600">{error}</p><p className="mt-3 text-sm text-slate-500">Данные не подменяются нулевыми значениями.</p><button className="mt-5 rounded-lg bg-sky-900 px-4 py-2 text-white" onClick={()=>setReload(v=>v+1)}>Повторить</button></section>:data?<RegionalDashboard data={data}/>:null}</main>;
}
