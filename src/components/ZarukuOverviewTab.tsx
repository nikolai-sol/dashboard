import type { ReactNode } from "react";
import ZarukuPeriodContext from "@/components/ZarukuPeriodContext";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  children: ReactNode;
};

export default function ZarukuOverviewTab({ data, children }: Props) {
  const metas = Object.values(data.dataset_meta);
  const trafficUnavailable = data.dataset_meta.traffic_channels.state === "unavailable";
  const partial = metas.some((meta) => meta.state === "partial" || meta.state === "unavailable");
  const trust = trafficUnavailable
    ? { label: "Критическая проблема", className: "border-red-200 bg-red-50 text-red-800" }
    : partial
      ? { label: "Частичные данные", className: "border-amber-200 bg-amber-50 text-amber-800" }
      : { label: "Можно доверять", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  const search = [
    ...(data.gsc.latest_week && data.gsc.summary.length + data.gsc.queries.length > 0
      ? [{ label: "Google RF", period: data.gsc.latest_week }]
      : []),
    ...(data.webmaster.latest_week && data.webmaster.summary.length + data.webmaster.queries.length > 0
      ? [{ label: "Яндекс", period: data.webmaster.latest_week }]
      : []),
    ...(data.seo_os.latest_week && data.seo_os.position_trend.length > 0
      ? [{ label: "SEO OS", period: data.seo_os.latest_week }]
      : []),
  ];
  const aiRow = data.seo_intelligence.ai.rows.find((row) => row.period === data.seo_intelligence.ai.latest_period) ?? null;
  const onsiteMeta = data.dataset_meta.traffic_channels;

  return (
    <div className="space-y-5">
      <ZarukuPeriodContext
        onsite={{ requested: onsiteMeta.requested_period, actual: onsiteMeta.period }}
        search={search}
        ai={aiRow ? { period: aiRow.period, provenance: aiRow.provenance } : null}
      />
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Что происходит с поисковой видимостью и целевым трафиком сейчас?</h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              Поиск, onsite и AI показаны в собственных фактических периодах. Неполное покрытие не подменяется предыдущей неделей или другой метрикой.
            </p>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${trust.className}`}>{trust.label}</span>
        </div>
      </section>
      {children}
    </div>
  );
}
