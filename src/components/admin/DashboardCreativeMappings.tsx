'use client';
import { useEffect, useState } from 'react';
import { creativeKey, UTM_FIELDS, type CreativeMapping, type CreativeRow, type UtmTuple } from '@/lib/creative-performance-contract';
export default function DashboardCreativeMappings({ dashboardId }: {
    dashboardId: string;
}) {
    const [rows, setRows] = useState<CreativeRow[]>([]), [counters, setCounters] = useState<string[]>([]), [mappings, setMappings] = useState<CreativeMapping[]>([]), [target, setTarget] = useState(''), [counter, setCounter] = useState(''), [search, setSearch] = useState(''), [message, setMessage] = useState('Loading…'), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
    const [tuple, setTuple] = useState<UtmTuple>({ utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' });
    const url = `/api/admin/dashboards/${dashboardId}/creative-mappings`;
    useEffect(() => { let active = true; fetch(url).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.error); if (active) {
        setRows(d.creatives);
        setCounters(d.counters);
        setCounter(d.counters[0] ?? '');
        setMappings(d.mappings);
        setLoaded(true);
        setMessage('');
    } }).catch(e => { if (active)
        setMessage(String(e)); }); return () => { active = false; }; }, [url]);
    async function save() { if (!loaded)
        return; setBusy(true); try {
        const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings }) });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setMappings(d.mappings);
        setMessage('Mappings saved');
    }
    catch (e) {
        setMessage(String(e));
    }
    finally {
        setBusy(false);
    } }
    function add() { const row = rows.find(r => creativeKey(r) === target); if (!row || !counter) {
        setMessage('Select a creative and Metrica counter');
        return;
    } setMappings(old => { const existing = old.find(m => creativeKey(m) === target && m.counter_id === counter); return existing ? old.map(m => m === existing ? { ...m, tuples: [...m.tuples, { ...tuple }] } : m) : [...old, { ...row, counter_id: counter, tuples: [{ ...tuple }] }]; }); setMessage('Unsaved changes'); }
    return <div className="space-y-4 rounded-xl border bg-white p-5"><p>Mapping is optional. Platform creative data remains visible without it. Each full UTM combination belongs to one creative; empty fields match exact empty values.</p><input aria-label="Search creatives" placeholder="Search creative or campaign" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded border p-2"/><select aria-label="Creative" value={target} onChange={e => setTarget(e.target.value)} className="w-full rounded border p-2"><option value="">Select creative</option>{rows.filter(r => `${r.name} ${r.platform_creative_id} ${r.platform_campaign_id} ${r.platform_account_id}`.toLowerCase().includes(search.toLowerCase())).map(r => <option key={creativeKey(r)} value={creativeKey(r)}>{r.source_key} / {r.platform_account_id} / {r.platform_campaign_id} / {r.platform_creative_id} — {r.name} — {r.size}</option>)}</select><label>Metrica counter <select value={counter} onChange={e => setCounter(e.target.value)} className="rounded border p-2">{counters.map(c => <option key={c}>{c}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2">{UTM_FIELDS.map(k => <label key={k}>{k}<input value={tuple[k]} onChange={e => setTuple({ ...tuple, [k]: e.target.value })} className="block w-full rounded border p-2"/></label>)}</div><button disabled={!loaded || busy} onClick={add} className="rounded border px-4 py-2">Add exact combination</button><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Creative</th><th>Counter</th>{UTM_FIELDS.map(k => <th key={k}>{k}</th>)}<th>Remove</th></tr></thead><tbody>{mappings.flatMap((m, i) => m.tuples.map((t, j) => <tr key={`${i}-${j}`}><td>{m.source_key}/{m.platform_account_id}/{m.platform_campaign_id}/{m.platform_creative_id}</td><td>{m.counter_id}</td>{UTM_FIELDS.map(k => <td className="border-b p-2" key={k}>{t[k] || '(empty)'}</td>)}<td><button aria-label="Remove mapping" onClick={() => { setMappings(old => old.map((v, n) => n === i ? { ...v, tuples: v.tuples.filter((_, n) => n !== j) } : v).filter(v => v.tuples.length)); setMessage('Unsaved changes'); }}>Remove</button></td></tr>))}</tbody></table></div><button disabled={!loaded || busy} onClick={save} className="rounded bg-blue-600 px-4 py-2 text-white">{busy ? 'Saving…' : 'Save mappings'}</button><p role="status">{message}</p></div>;
}
