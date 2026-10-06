'use client';
import { useMemo, useState } from 'react';
import { creativeDimensions, groupCreativeRows, searchCreativeGroups } from '@/lib/creative-performance-aggregation';
import { creativePlusFields, safeCreativePreviewUrl } from '@/lib/creative-preview-plus';
import { creativeFields, creativeFieldLabel, creativeFieldValue, type CreativePerformance } from '@/lib/creative-performance-contract';
export default function CreativePerformanceTable({ data, locale = 'en-US', showSpend = true, variant = 'standard' }: {
    data: CreativePerformance;
    locale?: string;
    currency?: string;
    showSpend?: boolean;
    variant?: 'standard' | 'plus';
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const ru = locale.startsWith('ru');
    const fields = useMemo(() => variant === 'plus' ? creativePlusFields(data.selected_columns, showSpend) : creativeFields(data.selected_columns, showSpend), [data.selected_columns, showSpend, variant]);
    const grouped = useMemo(() => groupCreativeRows(data.rows, fields), [data.rows, fields]);
    const rows = useMemo(() => searchCreativeGroups(grouped, fields, search), [grouped, fields, search]);
    const hasDimensions = creativeDimensions(fields).length > 0;
    const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
    const fmt = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString(locale, { maximumFractionDigits: 2 });
    const heads = fields.map(field => creativeFieldLabel(field, ru));
    const hasCost = fields.some(field => field === 'spend' || field === 'cpc');
    if (data.has_mappings)
        heads.push(...(ru ? ['Визиты', 'Пользователи*', 'Просмотры страниц', 'Глубина', 'Цели', 'CR %', 'Отказы %', 'Время (сек.)'] : ['Visits', 'Users*', 'Pageviews', 'Page depth', 'Goal reaches', 'CR %', 'Bounce %', 'Visit duration (s)']));
    return <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
  <h2 className="text-lg font-semibold">{variant === 'plus' ? 'Эффективность креативов +' : ru ? 'Эффективность креативов' : 'Creative performance'}</h2>
  <p className="mt-1 text-sm text-gray-500">{ru ? 'Данные рекламных платформ. Строки Hybrid могут представлять группы креативов. Неизвестные значения: —.' : 'Advertising platform data. Hybrid rows may represent creative groups. Unknown values are shown as —.'}</p>
  {hasCost && <p className="mt-1 text-sm text-gray-500">{ru ? 'Единицы платформы; валюта не подтверждена.' : 'Platform-reported units; currency not verified.'}{rows.some(row => row.mixed_cost_basis) && (ru ? ' Расход и CPC объединённых кабинетов с неподтверждёнными единицами: —.' : 'Spend and CPC are unavailable for groups combining accounts with unverified units.')}</p>}
  <input aria-label="Search creatives" disabled={!hasDimensions} placeholder={hasDimensions ? (ru ? 'Поиск по видимым описаниям' : 'Search visible descriptions') : (ru ? 'Нет описательных колонок для поиска' : 'No descriptive columns to search')} value={hasDimensions ? search : ''} onChange={e => { setSearch(e.target.value); setPage(0); }} className="my-4 w-full rounded border p-2 print:hidden"/>
  <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm print:text-[7px]">
   <thead><tr>{heads.map(h => <th key={h} className="whitespace-nowrap border-b px-3 py-2 text-left print:whitespace-normal print:px-1">{h}</th>)}</tr></thead>
   <tbody>{rows.map((r, index) => <tr key={r.group_key} title={r.availability} className={index >= safePage * 50 && index < (safePage + 1) * 50 ? '' : 'hidden print:table-row'}>
    {[...fields.map(field => {
      if (field === 'preview') {
        const urls = [...new Set((r.preview_urls ?? []).map(safeCreativePreviewUrl).filter((url): url is string => url !== null))];
        const link = (url: string, index: number, printed = false) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{printed ? url : urls.length === 1 ? 'Превью' : `Превью ${index + 1}`}</a>;
        return urls.length === 1 ? <>{link(urls[0], 0)}<span className="hidden print:block break-all">{urls[0]}</span></> : urls.length ? <><details className="print:hidden"><summary className="cursor-pointer text-blue-700">{urls.length} превью</summary><ul>{urls.map((url, index) => <li key={url}>{link(url, index)}</li>)}</ul></details><ul className="hidden print:block">{urls.map((url, index) => <li key={url}>{link(url, index, true)}</li>)}</ul></> : '—';
      }
      const value = creativeFieldValue(r, field); return typeof value === 'string' ? value : fmt(value);
    }), ...(data.has_mappings ? [r.postclick?.visits, r.postclick?.users, r.postclick?.pageviews, r.postclick?.page_depth, r.postclick?.goal_reaches, r.postclick?.conversion_rate, r.postclick?.bounce_rate, r.postclick?.avg_visit_duration].map(fmt) : [])].map((v, i) => <td key={i} className="whitespace-nowrap border-b px-3 py-2 print:whitespace-normal print:px-1">{v}</td>)}
   </tr>)}</tbody>
  </table></div>
  {!rows.length && <p className="py-4 text-gray-500">{ru ? 'Нет данных по креативам за выбранный период.' : 'No creative-level platform data for this period.'}</p>}
  <div className="mt-3 flex items-center gap-3 text-sm print:hidden"><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>{ru ? 'Назад' : 'Previous'}</button><span>{rows.length} · {ru ? 'Страница' : 'Page'} {safePage + 1}</span><button disabled={(safePage + 1) * 50 >= rows.length} onClick={() => setPage(safePage + 1)}>{ru ? 'Далее' : 'Next'}</button></div>
  {data.has_mappings && data.analytics_through && <p className="mt-2 text-xs text-gray-500">{ru?'Метрика по завершённым дням до':'Metrica completed days through'} {data.analytics_through} (UTC)</p>}
      {data.has_mappings && <p className="mt-2 text-xs text-gray-500">{ru ? 'Атрибуция Метрики: last. * Пользователи недоступны, если нельзя исключить повторы между датами или UTM. Наведите курсор на строку, чтобы увидеть статус данных.' : 'Metrica attribution: last. * Users are unavailable when deduplication across dates or UTM tuples cannot be established. Hover a row for its collection or mapping status.'}</p>}
 </section>;
}
