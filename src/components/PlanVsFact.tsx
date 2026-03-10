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
      <h3 className="mb-4 text-base font-semibold text-slate-900">Plan vs Fact</h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const progress = Math.max(0, Math.min(140, row.pacing * 100));
          return (
            <article key={row.platform} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <p className="text-sm font-semibold text-slate-900">{row.platform_label}</p>
                </div>
                <p className="font-mono text-xs text-slate-600">
                  {currencyFormatter(row.budget_fact)} / {currencyFormatter(row.budget_plan)} (
                  {(row.pacing * 100).toFixed(0)}%)
                </p>
              </div>

              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${getPacingColor(row.pacing)}`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between text-xs text-slate-500">
                <span>
                  Impr: {row.impressions_fact.toLocaleString("en-US")} /{" "}
                  {row.impressions_plan.toLocaleString("en-US")}
                </span>
                <span>CPM: {currencyFormatter(row.cpm_fact)} (plan {currencyFormatter(row.cpm_plan)})</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Total</p>
        <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
          {currencyFormatter(totals.fact)} / {currencyFormatter(totals.plan)} (
          {totals.plan > 0 ? ((totals.fact / totals.plan) * 100).toFixed(1) : "0.0"}%)
        </p>
      </div>
    </section>
  );
}
