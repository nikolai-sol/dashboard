'use client';
import { useMemo, useState } from 'react';
import { creativeKey, type CreativePerformance } from '@/lib/creative-performance-contract';
export default function CreativePerformanceTable({ data, locale = 'en-US', currency = 'EUR', showSpend = true }: {
    data: CreativePerformance;
    locale?: string;
    currency?: string;
    showSpend?: boolean;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const ru = locale.startsWith('ru');
    const rows = useMemo(() => data.rows.filter(r => [r.name, r.platform_creative_id, r.platform_campaign_id, r.platform_account_id, r.channel, r.source_key].join(' ').toLowerCase().includes(search.toLowerCase())), [data.rows, search]);
    const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
    const fmt = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString(locale, { maximumFractionDigits: 2 });
    const allHeads = ru ? ['Источник / кабинет', 'Кампания', 'ID креатива', 'Креатив', 'Размер', 'Показы', 'Клики', `Расход платформы (${currency})`, 'CTR %', `CPC (${currency})`] : ['Source / account', 'Campaign', 'Creative ID', 'Creative name', 'Size', 'Impressions', 'Clicks', `Platform spend (${currency})`, 'CTR %', `CPC (${currency})`];
    const heads = allHeads.filter((_, i) => showSpend || ![7, 9].includes(i));
    if (data.has_mappings)
        heads.push(...(ru ? ['Визиты', 'Пользователи*', 'Просмотры страниц', 'Глубина', 'Цели', 'CR %', 'Отказы %', 'Время (сек.)'] : ['Visits', 'Users*', 'Pageviews', 'Page depth', 'Goal reaches', 'CR %', 'Bounce %', 'Visit duration (s)']));
    return <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
  <h2 className="text-lg font-semibold">{ru ? 'Эффективность креативов' : 'Creative performance'}</h2>
  <p className="mt-1 text-sm text-gray-500">{ru ? 'Данные платформ доступны без UTM-сопоставления. Строки Hybrid могут представлять группы креативов. Неизвестные значения: —.' : 'Platform data is available without UTM mapping. Hybrid rows may represent creative groups. Unknown values are shown as —.'}</p>
  <input aria-label="Search creatives" placeholder={ru ? 'Поиск креативов, кампаний или кабинетов' : 'Search creatives, campaigns or accounts'} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="my-4 w-full rounded border p-2 print:hidden"/>
  <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm print:text-[7px]">
   <thead><tr>{heads.map(h => <th key={h} className="whitespace-nowrap border-b px-3 py-2 text-left print:whitespace-normal print:px-1">{h}</th>)}</tr></thead>
   <tbody>{rows.map((r, index) => <tr key={creativeKey(r)} title={r.availability} className={index >= safePage * 50 && index < (safePage + 1) * 50 ? '' : 'hidden print:table-row'}>
    {[`${r.source_key} / ${r.platform_account_id}`, r.platform_campaign_id, r.platform_creative_id, r.name, r.size, fmt(r.impressions), fmt(r.clicks), ...(showSpend ? [fmt(r.spend)] : []), fmt(r.ctr), ...(showSpend ? [fmt(r.cpc)] : []), ...(data.has_mappings ? [r.postclick?.visits, r.postclick?.users, r.postclick?.pageviews, r.postclick?.page_depth, r.postclick?.goal_reaches, r.postclick?.conversion_rate, r.postclick?.bounce_rate, r.postclick?.avg_visit_duration].map(fmt) : [])].map((v, i) => <td key={i} className="whitespace-nowrap border-b px-3 py-2 print:whitespace-normal print:px-1">{v}</td>)}
   </tr>)}</tbody>
  </table></div>
  {!rows.length && <p className="py-4 text-gray-500">{ru ? 'Нет данных по креативам за выбранный период.' : 'No creative-level platform data for this period.'}</p>}
  <div className="mt-3 flex items-center gap-3 text-sm print:hidden"><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>{ru ? 'Назад' : 'Previous'}</button><span>{rows.length} · {ru ? 'Страница' : 'Page'} {safePage + 1}</span><button disabled={(safePage + 1) * 50 >= rows.length} onClick={() => setPage(safePage + 1)}>{ru ? 'Далее' : 'Next'}</button></div>
  {data.has_mappings && <p className="mt-2 text-xs text-gray-500">{ru ? 'Атрибуция Метрики: last. * Пользователи недоступны, если нельзя исключить повторы между датами или UTM. Наведите курсор на строку, чтобы увидеть статус данных.' : 'Metrica attribution: last. * Users are unavailable when deduplication across dates or UTM tuples cannot be established. Hover a row for its collection or mapping status.'}</p>}
 </section>;
}
