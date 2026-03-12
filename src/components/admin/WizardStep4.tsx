"use client";

import type { DashboardFormData } from "@/lib/admin-ui-types";

type WizardStep4Props = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

const KPI_POOL = [
  "impressions",
  "clicks",
  "ctr",
  "cpm",
  "cpc",
  "spend",
  "views",
  "cpv",
  "conversions",
  "cpa",
  "roas",
  "reach",
  "frequency",
];

const PRESETS: Record<string, string[]> = {
  awareness: ["impressions", "clicks", "ctr", "cpm", "spend"],
  video: ["views", "cpv", "impressions", "cpm", "spend"],
  performance: ["conversions", "cpa", "clicks", "cpc", "spend"],
};

export default function WizardStep4({ data, onChange }: WizardStep4Props) {
  const config = data.config;
  const kpiCards = [...(config.kpi_cards ?? [])];
  while (kpiCards.length < 5) {
    kpiCards.push(PRESETS.awareness[kpiCards.length] ?? "impressions");
  }

  const setKpiCard = (index: number, value: string) => {
    const nextCards = [...kpiCards];
    nextCards[index] = value;
    onChange({
      ...data,
      config: {
        ...config,
        kpi_cards: nextCards,
      },
    });
  };

  const setPreset = (presetKey: keyof typeof PRESETS) => {
    onChange({
      ...data,
      config: {
        ...config,
        kpi_cards: PRESETS[presetKey],
      },
    });
  };

  const toggleMetric = (metric: string, checked: boolean) => {
    const set = new Set(config.visible_metrics);
    if (checked) set.add(metric);
    else set.delete(metric);

    onChange({
      ...data,
      config: {
        ...config,
        visible_metrics: Array.from(set),
      },
    });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">KPI cards (5 positions)</h4>
        <div className="mt-3 space-y-2">
          {kpiCards.slice(0, 5).map((metric, index) => (
            <label key={index} className="grid grid-cols-[24px_1fr] items-center gap-2 text-sm">
              <span className="font-mono text-slate-500">{index + 1}.</span>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={metric}
                onChange={(e) => setKpiCard(index, e.target.value)}
              >
                {KPI_POOL.map((item) => (
                  <option key={item} value={item}>
                    {item.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPreset("awareness")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Awareness
          </button>
          <button
            type="button"
            onClick={() => setPreset("video")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Video/OLV
          </button>
          <button
            type="button"
            onClick={() => setPreset("performance")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Performance
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Visible metrics</h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {KPI_POOL.map((metric) => (
            <label key={metric} className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={config.visible_metrics.includes(metric)}
                onChange={(e) => toggleMetric(metric, e.target.checked)}
              />
              {metric.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Additional options</h4>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.show_spend}
              onChange={(e) =>
                onChange({
                  ...data,
                  config: {
                    ...config,
                    show_spend: e.target.checked,
                  },
                })
              }
            />
            Show spend
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.show_ai_summary}
              onChange={(e) =>
                onChange({
                  ...data,
                  config: {
                    ...config,
                    show_ai_summary: e.target.checked,
                  },
                })
              }
            />
            Show AI summary
          </label>
        </div>
      </div>
    </section>
  );
}
