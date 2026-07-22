import type { UnifiedSeoPageRow } from "@/components/zaruku-seo-workspace";

type Props = {
  rows: UnifiedSeoPageRow[];
  seoWeek: string | null;
  sourceWeeks: {
    google: string | null;
    webmaster: string | null;
    seoOs: string | null;
  };
  trafficPeriod: { from: string; to: string };
  locale?: string;
};

function formatNumber(value: number | null | undefined, locale: string): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : Math.round(value).toLocaleString(locale);
}

function formatDecimal(value: number | null | undefined, locale: string, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function formatPercent(value: number | null | undefined, locale: string): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatDecimal(value, locale)}%`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value, "https://zaruku.ru");
    return url.pathname || "/";
  } catch {
    return value;
  }
}

function SourceHeading({ label, period, dot }: { label: string; period: string | null; dot: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="font-normal normal-case text-slate-400">{period ?? "нет данных"}</span>
    </div>
  );
}

export default function ZarukuSeoPageComparison({ rows, seoWeek, sourceWeeks, trafficPeriod, locale = "ru-RU" }: Props) {
  const sortedRows = [...rows].sort((left, right) =>
    (right.post_click?.visits ?? 0) - (left.post_click?.visits ?? 0)
      || ((right.google?.impressions ?? 0) + (right.webmaster?.impressions ?? 0))
        - ((left.google?.impressions ?? 0) + (left.webmaster?.impressions ?? 0))
      || left.label.localeCompare(right.label, locale),
  );

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100/60" aria-labelledby="seo-page-comparison-title">
      <header className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h3 id="seo-page-comparison-title" className="text-base font-semibold text-slate-900">Посадочные страницы: спрос и поведение</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              До клика и после клика показаны раздельно. Строки объединяются только по точному нормализованному URL.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium tabular-nums text-slate-500">
            <span className="rounded-md bg-slate-50 px-2.5 py-1.5">SEO-неделя {seoWeek ?? "—"}</span>
            <span className="rounded-md bg-slate-50 px-2.5 py-1.5">Поведение на сайте {trafficPeriod.from} — {trafficPeriod.to}</span>
          </div>
        </div>
      </header>

      <div className="max-h-[42rem] overflow-auto">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e2e8f0]">
            <tr className="text-xs font-semibold text-slate-600">
              <th rowSpan={2} className="w-[300px] border-r border-slate-100 bg-white px-4 py-3 text-left align-bottom">Страница</th>
              <th colSpan={4} className="border-r border-slate-100 bg-blue-50/70 px-3 py-2 text-center">
                <SourceHeading label="Google RF" period={sourceWeeks.google} dot="bg-blue-500" />
              </th>
              <th colSpan={4} className="border-r border-slate-100 bg-amber-50/70 px-3 py-2 text-center">
                <SourceHeading label="Яндекс Вебмастер" period={sourceWeeks.webmaster} dot="bg-amber-400" />
              </th>
              <th colSpan={4} className="border-r border-slate-100 bg-violet-50/70 px-3 py-2 text-center">
                <SourceHeading label="Метрика" period={`${trafficPeriod.from} — ${trafficPeriod.to}`} dot="bg-violet-500" />
              </th>
              <th rowSpan={2} className="w-[110px] bg-teal-50/70 px-3 py-3 text-right align-bottom">
                <div>Запросы SEO OS</div>
                <div className="mt-1 font-normal text-slate-400">{sourceWeeks.seoOs ?? "нет данных"}</div>
              </th>
            </tr>
            <tr className="text-[11px] text-slate-500">
              <th className="bg-blue-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-blue-50/70 px-2 py-2 text-right">Позиция</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-amber-50/70 px-2 py-2 text-right">Позиция</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Визиты</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Пользователи</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Отказы</th>
              <th className="border-r border-slate-100 bg-violet-50/70 px-2 py-2 text-right">Время</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedRows.map((row) => (
              <tr key={row.key} className="align-top transition hover:bg-slate-50/70">
                <td className="border-r border-slate-100 px-4 py-3">
                  <div className="font-medium leading-snug text-slate-800">{row.label}</div>
                  <a href={row.url} className="mt-1 block max-w-[270px] truncate text-xs text-slate-400 hover:text-teal-700" title={row.url}>
                    {shortUrl(row.url)}
                  </a>
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.google?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.google?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.webmaster?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.webmaster?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.post_click?.visits, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.post_click?.users, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.post_click?.bounce_rate, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right tabular-nums text-slate-500">{formatDuration(row.post_click?.avg_duration_seconds)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-teal-800">{formatNumber(row.seo_os_tracked_queries, locale)}</td>
              </tr>
            ))}
            {sortedRows.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-slate-500">Нет страниц для выбранных периодов.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
