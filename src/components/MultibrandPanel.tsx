"use client";

type BrandSummary = {
  id: string;
  label: string;
  color: string;
  description?: string;
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_conversions: number;
  avg_ctr: number;
  platforms_count: number;
  channels_count: number;
};

type MultibrandPanelProps = {
  title: string;
  subtitle?: string;
  brands: BrandSummary[];
  selectedBrandId: string | null;
  currencyFormatter: (value: number) => string;
  formatCompact: (value: number) => string;
  onSelectBrand: (brandId: string | null) => void;
};

export default function MultibrandPanel({
  title,
  subtitle,
  brands,
  selectedBrandId,
  currencyFormatter,
  formatCompact,
  onSelectBrand,
}: MultibrandPanelProps) {
  const totals = brands.reduce(
    (acc, brand) => ({
      impressions: acc.impressions + brand.total_impressions,
      clicks: acc.clicks + brand.total_clicks,
      spend: acc.spend + brand.total_spend,
      conversions: acc.conversions + brand.total_conversions,
    }),
    { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
  );
  const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

  return (
    <section className="mb-6 grid gap-4 xl:grid-cols-[320px_1fr]">
      <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Executive Panel
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}

        <div className="mt-5 rounded-[24px] bg-slate-950 p-4 text-white">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Brands</div>
              <div className="mt-1 text-2xl font-semibold">{brands.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Impressions</div>
              <div className="mt-1 text-2xl font-semibold">{formatCompact(totals.impressions)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Clicks</div>
              <div className="mt-1 text-2xl font-semibold">{formatCompact(totals.clicks)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">CTR</div>
              <div className="mt-1 text-2xl font-semibold">{avgCtr.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Spend</div>
              <div className="mt-1 text-2xl font-semibold">{currencyFormatter(totals.spend)}</div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => onSelectBrand(null)}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
              !selectedBrandId
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
            }`}
          >
            <div className="text-sm font-semibold">All brands</div>
            <div className={`mt-1 text-xs ${!selectedBrandId ? "text-slate-300" : "text-slate-500"}`}>
              Executive overview across the whole dashboard
            </div>
          </button>
        </div>
      </aside>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((brand) => {
          const active = brand.id === selectedBrandId;
          return (
            <button
              key={brand.id}
              type="button"
              onClick={() => onSelectBrand(active ? null : brand.id)}
              className={`rounded-[28px] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 ${
                active ? "border-slate-950 ring-2 ring-slate-950/10" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex h-2.5 w-10 rounded-full" style={{ backgroundColor: brand.color }} />
                  <div className="mt-3 text-lg font-semibold text-slate-950">{brand.label}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {brand.description || `${brand.channels_count} channels`}
                  </div>
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {active ? "Selected" : "Open"}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Impressions</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {formatCompact(brand.total_impressions)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Spend</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {currencyFormatter(brand.total_spend)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Clicks</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {formatCompact(brand.total_clicks)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">CTR</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">{brand.avg_ctr.toFixed(2)}%</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{brand.platforms_count} platforms</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{brand.channels_count} channels</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
