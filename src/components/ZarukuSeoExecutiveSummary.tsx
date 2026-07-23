import type { SeoExecutiveSnapshot } from "@/components/zaruku-seo-workspace";

export type ZarukuSeoSourcePeriods = {
  google: string | null;
  webmaster: string | null;
  seoOs: string | null;
  ai: string | null;
};

type Props = {
  snapshot: SeoExecutiveSnapshot;
  trafficPeriod: { from: string; to: string };
  primaryWeek: string | null;
  comparisonWeek: string | null;
  sourcePeriods: ZarukuSeoSourcePeriods;
  locale?: string;
};

function formatNumber(value: number, locale: string): string {
  return Math.round(value).toLocaleString(locale);
}

function formatDecimal(value: number | null, locale: string, digits = 1): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function formatPercent(value: number | null, locale: string): string {
  return value === null || !Number.isFinite(value) ? "—" : `${formatDecimal(value, locale)}%`;
}

function periodLabel(value: string | null): string {
  return value ?? "нет данных";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function ExecutiveCard({
  title,
  period,
  accent,
  note,
  children,
}: {
  title: string;
  period: string | null;
  accent: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100/60">
      <div className={`h-1 ${accent}`} />
      <div className="p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="min-w-0 text-sm font-semibold leading-snug text-slate-800">{title}</h3>
          <span className="shrink-0 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
            {periodLabel(period)}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">{note}</p>
      </div>
    </article>
  );
}

export default function ZarukuSeoExecutiveSummary({
  snapshot,
  trafficPeriod,
  primaryWeek,
  comparisonWeek,
  sourcePeriods,
  locale = "ru-RU",
}: Props) {
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="zaruku-seo-executive-title">
      <div className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-4 text-white shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-teal-300">SEO · executive overview</p>
            <h2 id="zaruku-seo-executive-title" className="mt-1 text-lg font-semibold">Состояние органического поиска</h2>
          </div>
          <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:min-w-[620px]">
            <div className="rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
              <div className="text-xs text-slate-400">Период поведения на сайте</div>
              <div className="mt-1 font-medium tabular-nums text-slate-100">{trafficPeriod.from} — {trafficPeriod.to}</div>
              <div className="mt-1 text-xs text-slate-400">
                {snapshot.post_click
                  ? `${formatNumber(snapshot.post_click.visits, locale)} визитов · ${snapshot.post_click.users_available ? formatNumber(snapshot.post_click.users, locale) : "—"} пользователей`
                  : "данные недоступны"}
              </div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
              <div className="text-xs text-slate-400">Отчётная SEO-неделя</div>
              <div className="mt-1 font-medium tabular-nums text-slate-100">{periodLabel(primaryWeek)}</div>
              <div className="mt-1 text-xs text-slate-400">
                {comparisonWeek ? `Сравнение: ${comparisonWeek}` : "Без сравнения с другой неделей"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ExecutiveCard
          title="Google RF"
          period={sourcePeriods.google}
          accent="bg-blue-500"
          note="Google Search Console · только поисковый спрос из России. Средняя позиция до клика."
        >
          <Metric label="Показы" value={snapshot.google ? formatNumber(snapshot.google.impressions, locale) : "—"} />
          <Metric label="Клики" value={snapshot.google ? formatNumber(snapshot.google.clicks, locale) : "—"} />
          <Metric label="CTR" value={snapshot.google ? formatPercent(snapshot.google.ctr, locale) : "—"} />
          <Metric label="Ср. позиция" value={snapshot.google ? formatDecimal(snapshot.google.average_position, locale) : "—"} />
        </ExecutiveCard>

        <ExecutiveCard
          title="Яндекс Вебмастер"
          period={sourcePeriods.webmaster}
          accent="bg-amber-400"
          note="Спрос по хосту zaruku.ru: показы, клики и средняя позиция до клика."
        >
          <Metric label="Показы" value={snapshot.webmaster ? formatNumber(snapshot.webmaster.impressions, locale) : "—"} />
          <Metric label="Клики" value={snapshot.webmaster ? formatNumber(snapshot.webmaster.clicks, locale) : "—"} />
          <Metric label="CTR" value={snapshot.webmaster ? formatPercent(snapshot.webmaster.ctr, locale) : "—"} />
          <Metric label="Ср. позиция" value={snapshot.webmaster ? formatDecimal(snapshot.webmaster.average_position, locale) : "—"} />
        </ExecutiveCard>

        <ExecutiveCard
          title="SEO OS · Яндекс, отслеживаемые позиции"
          period={sourcePeriods.seoOs}
          accent="bg-teal-500"
          note="Контрольный набор запросов SEO OS. Позиция и покрытие не смешиваются со средней позицией Webmaster."
        >
          <Metric label="Ср. позиция" value={snapshot.seo_os ? formatDecimal(snapshot.seo_os.average_position, locale) : "—"} />
          <Metric
            label="Покрытие"
            value={snapshot.seo_os ? formatPercent(snapshot.seo_os.coverage === null ? null : snapshot.seo_os.coverage * 100, locale) : "—"}
          />
        </ExecutiveCard>

        <ExecutiveCard
          title="AI-видимость"
          period={sourcePeriods.ai}
          accent="bg-violet-500"
          note="Зафиксированные упоминания и цитирования из подключённого источника AI-видимости."
        >
          <Metric label="Присутствие" value={snapshot.ai ? formatPercent(snapshot.ai.presence_rate, locale) : "—"} />
          <Metric label="Упоминания" value={snapshot.ai ? formatNumber(snapshot.ai.mentions, locale) : "—"} />
          <Metric label="Цитирования" value={snapshot.ai ? formatNumber(snapshot.ai.citations, locale) : "—"} />
        </ExecutiveCard>
      </div>
    </section>
  );
}
