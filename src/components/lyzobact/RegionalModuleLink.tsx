'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {moduleHref,isRegionalNavigationCandidate} from './presentation';
export default function RegionalModuleLink({dashboardId,accessToken}:{dashboardId:string;accessToken:string}){
 const [enabled,setEnabled]=useState(false);
 const eligible=isRegionalNavigationCandidate(dashboardId);
 useEffect(()=>{if(!eligible)return;const controller=new AbortController();const q=new URLSearchParams({availability:'1'});if(accessToken)q.set('access_token',accessToken);fetch(`/api/dashboard/${encodeURIComponent(dashboardId)}/regions?${q}`,{signal:controller.signal,cache:'no-store'}).then(async r=>setEnabled(r.ok&&(await r.json()).enabled===true)).catch(()=>setEnabled(false));return()=>controller.abort();},[eligible,dashboardId,accessToken]);
 if(!eligible||!enabled)return null;
 return <Link className="mb-5 inline-flex rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 font-semibold text-sky-900" href={moduleHref(dashboardId,new URLSearchParams(accessToken?{access_token:accessToken}:{}))}>Карта регионов · Лизобакт →</Link>;
}
