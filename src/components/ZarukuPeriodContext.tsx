type Period = { from: string; to: string };

type Props = {
  onsite: { requested: Period; actual: Period };
  search: Array<{ label: string; period: string }>;
  ai: { period: string; provenance: string | null } | null;
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function range(period: Period) {
  return `${formatDate(period.from)}–${formatDate(period.to)}`;
}

export default function ZarukuPeriodContext({ onsite, search, ai }: Props) {
  return (
    <section aria-label="Периоды данных" className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded-md bg-white px-2.5 py-1.5 shadow-sm">
          <strong className="text-slate-800">Ежедневные данные:</strong> {range(onsite.actual)} · стандартный лаг 48 часов
        </span>
        {search.map((item) => (
          <span key={`${item.label}:${item.period}`} className="rounded-md bg-white px-2.5 py-1.5 shadow-sm">
            <strong className="text-slate-800">{item.label}:</strong> {item.period}
            {item.label === "SEO OS" ? (
              <>
                {" · недельный срез позиций "}
                <span className="group relative inline-flex align-middle">
                  <span
                    aria-label="О периоде SEO OS"
                    aria-describedby="zaruku-seo-os-period-note"
                    className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-slate-400 bg-white text-[10px] font-semibold leading-none text-slate-600"
                    tabIndex={0}
                  >
                    i
                  </span>
                  <span
                    id="zaruku-seo-os-period-note"
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-72 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block"
                  >
                    Это независимый недельный срез: он не относится к выбранному ежедневному периоду и не ограничивает данные Метрики, GSC или Вебмастера.
                  </span>
                </span>
              </>
            ) : null}
          </span>
        ))}
        {ai ? (
          <span className="rounded-md bg-white px-2.5 py-1.5 shadow-sm">
            <strong className="text-slate-800">AI:</strong> {ai.period}{ai.provenance ? ` · ${ai.provenance}` : ""}
          </span>
        ) : null}
      </div>
    </section>
  );
}
