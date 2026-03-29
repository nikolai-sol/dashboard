"use client";

export type MultibrandBrandSummary = {
  id: string;
  label: string;
  color: string;
  description?: string;
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_conversions: number;
  avg_ctr: number;
  total_views: number;
  total_reach: number;
  channels_count: number;
};

type ExecKpi = {
  key: string;
  label: string;
  formatted: string;
};

type Props = {
  title: string;
  subtitle?: string;
  brands: MultibrandBrandSummary[];
  execKpis: ExecKpi[];
  formatCompact: (v: number) => string;
  formatCtr: (v: number) => string;
  onSelectBrand: (brandId: string) => void;
};

function pctColor(pct: number): string {
  if (pct >= 70) return "text-emerald-600";
  if (pct >= 40) return "text-amber-600";
  return "text-red-500";
}

function maxOf(brands: MultibrandBrandSummary[], key: keyof MultibrandBrandSummary): number {
  return Math.max(1, ...brands.map((b) => Number(b[key])));
}

export default function MultibrandExecutivePage({
  title,
  subtitle,
  brands,
  execKpis,
  formatCompact,
  formatCtr,
  onSelectBrand,
}: Props) {
  const totalImpressions = brands.reduce((s, b) => s + b.total_impressions, 0);
  const totalClicks = brands.reduce((s, b) => s + b.total_clicks, 0);
  const totalReach = brands.reduce((s, b) => s + b.total_reach, 0);
  const totalViews = brands.reduce((s, b) => s + b.total_views, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // For comparison table proportional bars
  const maxImp = maxOf(brands, "total_impressions");
  const maxClicks = maxOf(brands, "total_clicks");
  const maxViews = maxOf(brands, "total_views");
  const maxReach = maxOf(brands, "total_reach");
  const maxCtr = Math.max(1, ...brands.map((b) => b.avg_ctr));

  const compMetrics = [
    {
      key: "impressions",
      label: "Показы",
      getValue: (b: MultibrandBrandSummary) => formatCompact(b.total_impressions),
      getBar: (b: MultibrandBrandSummary) => (b.total_impressions / maxImp) * 100,
    },
    {
      key: "clicks",
      label: "Клики",
      getValue: (b: MultibrandBrandSummary) => formatCompact(b.total_clicks),
      getBar: (b: MultibrandBrandSummary) => (b.total_clicks / maxClicks) * 100,
    },
    {
      key: "ctr",
      label: "CTR",
      getValue: (b: MultibrandBrandSummary) => formatCtr(b.avg_ctr),
      getBar: (b: MultibrandBrandSummary) => (b.avg_ctr / maxCtr) * 100,
    },
    {
      key: "views",
      label: "Просмотры",
      getValue: (b: MultibrandBrandSummary) => formatCompact(b.total_views),
      getBar: (b: MultibrandBrandSummary) => (b.total_views / maxViews) * 100,
    },
    {
      key: "reach",
      label: "Охват",
      getValue: (b: MultibrandBrandSummary) => formatCompact(b.total_reach),
      getBar: (b: MultibrandBrandSummary) => (b.total_reach / maxReach) * 100,
    },
  ];

  return (
    <div className="space-y-4">

      {/* ── Hero row: Exec Panel + Brand Cards ── */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[280px_1fr]">

        {/* Exec panel (dark) */}
        <div className="relative flex flex-col overflow-hidden rounded-2xl bg-[#0f1117] p-6">
          {/* subtle blue glow */}
          <div className="pointer-events-none absolute right-0 top-0 h-full w-48 bg-gradient-to-l from-blue-500/5 to-transparent" />

          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            Executive Summary
          </div>
          <div className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-white">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-1 text-[12px] text-slate-500">{subtitle}</div>
          ) : null}

          <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-4 pt-6">
            {execKpis.map((kpi) => (
              <div key={kpi.key}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {kpi.label}
                </div>
                <div className="mt-1 text-[18px] font-semibold leading-none tracking-tight text-white">
                  {kpi.formatted}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Brand cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {brands.map((brand) => (
            <article
              key={brand.id}
              className="flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:translate-y-0"
              onClick={() => onSelectBrand(brand.id)}
            >
              {/* color accent top bar */}
              <div className="h-[3px] w-full flex-shrink-0" style={{ background: brand.color }} />

              <div className="flex flex-1 flex-col p-4">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-semibold leading-tight tracking-tight text-slate-950">
                      {brand.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {brand.description ?? `${brand.channels_count} каналов`}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    Открыть →
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Показы */}
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Показы
                    </div>
                    <div className="mt-1 text-[15px] font-semibold leading-none tracking-tight text-slate-950">
                      {formatCompact(brand.total_impressions)}
                    </div>
                    <div className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (brand.total_impressions / maxImp) * 100)}%`,
                          background: brand.color,
                        }}
                      />
                    </div>
                  </div>
                  {/* Клики */}
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Клики
                    </div>
                    <div className="mt-1 text-[15px] font-semibold leading-none tracking-tight text-slate-950">
                      {formatCompact(brand.total_clicks)}
                    </div>
                    <div className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (brand.total_clicks / maxClicks) * 100)}%`,
                          background: brand.color,
                        }}
                      />
                    </div>
                  </div>
                  {/* CTR */}
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      CTR
                    </div>
                    <div className="mt-1 text-[15px] font-semibold leading-none tracking-tight text-slate-950">
                      {formatCtr(brand.avg_ctr)}
                    </div>
                    <div className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (brand.avg_ctr / maxCtr) * 100)}%`,
                          background: brand.color,
                        }}
                      />
                    </div>
                  </div>
                  {/* Охват */}
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Охват
                    </div>
                    <div className="mt-1 text-[15px] font-semibold leading-none tracking-tight text-slate-950">
                      {formatCompact(brand.total_reach)}
                    </div>
                    <div className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (brand.total_reach / maxReach) * 100)}%`,
                          background: brand.color,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Aggregate KPI row ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Показы", value: formatCompact(totalImpressions) },
          { label: "Клики", value: formatCompact(totalClicks) },
          { label: "CTR", value: formatCtr(avgCtr) },
          { label: "Просмотры", value: formatCompact(totalViews) },
          { label: "Охват", value: formatCompact(totalReach) },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              {item.label}
            </div>
            <div className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-slate-950">
              {item.value}
            </div>
          </div>
        ))}
      </section>

      {/* ── Comparison table ── */}
      {brands.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="text-[13px] font-semibold text-slate-950">Сравнение брендов</div>
            <div className="text-[11px] text-slate-400">{brands.length} бренда</div>
          </div>

          {/* column headers */}
          <div className="grid items-center border-b border-slate-100 px-5 py-2"
            style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}>
            <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">Бренд</div>
            {compMetrics.map((m) => (
              <div key={m.key} className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {m.label}
              </div>
            ))}
          </div>

          {brands.map((brand, idx) => (
            <div
              key={brand.id}
              className={`grid cursor-pointer items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50 ${
                idx < brands.length - 1 ? "border-b border-slate-50" : ""
              }`}
              style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}
              onClick={() => onSelectBrand(brand.id)}
            >
              {/* brand name */}
              <div className="flex items-center gap-2.5">
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: brand.color }}
                />
                <span className="truncate text-[13px] font-medium text-slate-950">
                  {brand.label}
                </span>
              </div>

              {/* metric cells */}
              {compMetrics.map((m) => (
                <div key={m.key} className="space-y-1">
                  <div className="text-[12px] font-semibold text-slate-950">
                    {m.getValue(brand)}
                  </div>
                  <div className="h-[4px] overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, m.getBar(brand))}%`,
                        background: brand.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}

    </div>
  );
}
