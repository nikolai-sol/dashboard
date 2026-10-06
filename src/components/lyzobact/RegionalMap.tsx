'use client';
import {useEffect,useState,useMemo} from 'react';
import {NaturalEarth} from '@visx/geo';
import type {Feature,FeatureCollection,Geometry} from 'geojson';
import {projectionGeometry} from './map-geometry';
import type {RegionalRow} from '@/lib/lyzobact-regions-types';
import {signalState,campaignState,signalColors,campaignColors} from './presentation';
export type RegionalGeometry=FeatureCollection<Geometry,{regionKey:string;name?:string}>;
export default function RegionalMap({rows,mode,selected,onSelect,initialGeometry}:{rows:RegionalRow[];mode:'signal'|'campaign';selected:string|null;onSelect:(key:string)=>void;initialGeometry?:RegionalGeometry}){
 const [geometry,setGeometry]=useState<RegionalGeometry|null>(initialGeometry??null),[error,setError]=useState(false);
 useEffect(()=>{if(initialGeometry)return;const c=new AbortController();fetch('/lyzobact/regions.geojson',{signal:c.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setGeometry).catch(e=>{if(e.name!=='AbortError')setError(true);});return()=>c.abort();},[initialGeometry]);
 const projected=useMemo(()=>geometry?projectionGeometry(geometry):null,[geometry]);
 const byKey=new Map(rows.map(r=>[r.regionKey,r]));
 if(error)return <div className="flex min-h-80 items-center justify-center text-slate-500">Карта недоступна. Все регионы остаются в списке ниже.</div>;
 if(!projected)return <div className="flex min-h-80 items-center justify-center text-slate-500">Загружаем границы регионов…</div>;
 return <svg viewBox="0 0 1000 520" role="group" aria-label="Карта 85 регионов. Выберите регион для просмотра источников" className="w-full min-h-64">
 <NaturalEarth data={projected.features as Feature<Geometry>[]} rotate={[-100,0,0]} fitExtent={[[[18,18],[982,502]],{type:"Feature",properties:{},geometry:{type:"GeometryCollection",geometries:projected.features.map(f=>f.geometry)}}]}>
 {({features})=>features.map(({feature,path},index)=>{const key=String(feature.properties?.regionKey??'');const row=byKey.get(key);const fill=mode==='campaign'?campaignColors[campaignState(row?.campaignStatus)]:signalColors[row?signalState(row):'unknown'];return <path key={key||index} d={path||''} fill={fill} stroke={selected===key?'#173f64':'#fff'} strokeWidth={selected===key?2.5:0.7} role="button" tabIndex={0} aria-label={row?.name??String(feature.properties?.name??key)} aria-pressed={selected===key} onClick={()=>onSelect(key)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(key);}}} className="cursor-pointer outline-none transition-colors hover:brightness-95 focus:stroke-sky-900"><title>{row?.name??key}</title></path>;})}
 </NaturalEarth>
 </svg>;
}
