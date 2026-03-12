"use client";

import type { PlanVsFactRow } from "@/lib/types";

type PlanVsFactProps = {
  rows: PlanVsFactRow[];
  currencyFormatter: (value: number) => string;
};

function getPacingColor(pacing: number) {
  if (pacing >= 0.9) return "bg-emerald-500";
  if (pacing >= 0.7) return "bg-amber-400";
  return "bg-rose-500";
}

function metricSummary(row: PlanVsFactRow): { label: string; plan: number; fact: number; pricePlan: number; priceFact: number; priceLabel: string } {
  const buyType = row.buy_type.toUpperCase();
  if (buyType === "CPV") {
    return {
      label: "Views",
      plan: row.views_plan,
      fact: row.views_fact,
      pricePlan: row.cpv_plan,
      priceFact: row.cpv_fact,
      priceLabel: "CPV",
    };
  }
  if (buyType === "CPA") {
    return {
      label: "Conversions",
      plan: row.conversions_plan,
      fact: row.conversions_fact,
      pricePlan: row.cpa_plan,
      priceFact: row.cpa_fact,
      priceLabel: "CPA",
    };
  }
  if (buyType === "CPC") {
    return {
      label: "Clicks",
      plan: row.clicks_plan,
      fact: row.clicks_fact,
      pricePlan: row.cpc_plan,
      priceFact: row.cpc_fact,
      priceLabel: "CPC",
    };
  }
  return {
    label: "Impressions",
    plan: row.impressions_plan,
    fact: row.impressions_fact,
    pricePlan: row.cpm_plan,
    priceFact: row.cpm_fact,
    priceLabel: "CPM",
  };
}

export default function PlanVsFact({ rows, currencyFormatter }: PlanVsFactProps) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.plan += row.budget_plan;
      acc.fact += row.budget_fact;
      return acc;
    },
    { plan: 0, fact: 0 },
  );

  return (
    <section className="card-surface p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">Plan vs Fact by Media Plan Position</h3>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No media plan rows connected. Add a published `for_dashboard` CSV URL in dashboard sources.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const progress = Math.max(0, Math.min(140, row.pacing * 100));
            const metric = metricSummary(row);
            const metricPacing = metric.plan > 0 ? (metric.fact / metric.plan) * 100 : 0;

            return (
              <article key={`${row.channel}-${row.buy_type}`} className="rounded-lg border border-slate-100 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{row.channel}</p>
                    <span className="rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
                      {row.buy_type.toUpperCase()}
                    </span>
                    <div className="flex items-center gap-1">
                      {row.platform_colors.map((color, idx) => (
                        <span
                          key={`${row.channel}-color-${idx}`}
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                          title={row.platforms[idx]}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="font-mono text-xs text-slate-600">
                    {currencyFormatter(row.budget_fact)} / {currencyFormatter(row.budget_plan)} ({(row.pacing * 100).toFixed(0)}%)
                  </p>
                </div>

                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${getPacingColor(row.pacing)}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>
                    {metric.label}: {metric.fact.toLocaleString("en-US")} / {metric.plan.toLocaleString("en-US")} ({metricPacing.toFixed(0)}%)
                  </span>
                  <span>
                    {metric.priceLabel}: {currencyFormatter(metric.priceFact)} (plan {currencyFormatter(metric.pricePlan)})
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Total Budget</p>
        <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
          {currencyFormatter(totals.fact)} / {currencyFormatter(totals.plan)} ({totals.plan > 0 ? ((totals.fact / totals.plan) * 100).toFixed(1) : "0.0"}%)
        </p>
      </div>
    </section>
  );
}
