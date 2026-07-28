import ZarukuInfoPopover from "@/components/ZarukuInfoPopover";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";

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
                <ZarukuInfoPopover label={ZARUKU_CLIENT_COPY.weeklyPeriod.label}>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {ZARUKU_CLIENT_COPY.weeklyPeriod.note}
                  </p>
                </ZarukuInfoPopover>
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
