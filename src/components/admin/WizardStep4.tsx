"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { DashboardFormData, DashboardSectionId } from "@/lib/admin-ui-types";

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

const SPEND_RELATED_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
const SECTION_OPTIONS: Array<{ id: DashboardSectionId; label: string; spendRelated?: boolean }> = [
  { id: "kpi_grid", label: "KPI cards" },
  { id: "spend_section", label: "Spend by platform + channel mix", spendRelated: true },
  { id: "trend_chart", label: "Trend chart" },
  { id: "channel_table", label: "Channel performance" },
  { id: "plan_vs_fact", label: "Channel performance plan/fact" },
  { id: "platform_table", label: "Platform table" },
];

const PRESETS: Record<string, string[]> = {
  awareness: ["impressions", "clicks", "ctr", "cpm", "spend"],
  video: ["views", "cpv", "impressions", "cpm", "spend"],
  performance: ["conversions", "cpa", "clicks", "cpc", "spend"],
};

const NON_SPEND_FALLBACK = ["impressions", "clicks", "ctr", "views", "reach"];

function sanitizeMetricPool(showSpend: boolean) {
  return showSpend ? KPI_POOL : KPI_POOL.filter((metric) => !SPEND_RELATED_METRICS.has(metric));
}

function sanitizeCards(cards: string[], showSpend: boolean): string[] {
  const allowed = sanitizeMetricPool(showSpend);
  const filtered = cards.filter((metric) => allowed.includes(metric));
  const next = [...filtered];
  const fallback = showSpend ? PRESETS.awareness : NON_SPEND_FALLBACK;
  while (next.length < 5) {
    next.push(fallback[next.length] ?? allowed[0] ?? "impressions");
  }
  return next.slice(0, 5);
}

function sanitizeVisibleMetrics(metrics: string[], showSpend: boolean): string[] {
  const allowed = new Set(sanitizeMetricPool(showSpend));
  return metrics.filter((metric) => allowed.has(metric));
}

function sanitizeSectionOrder(
  order: DashboardSectionId[] | undefined,
  showSpend: boolean,
  fillDefaults = false,
): DashboardSectionId[] {
  const allowed = SECTION_OPTIONS.filter((section) => showSpend || !section.spendRelated).map((section) => section.id);
  const fromConfig = Array.isArray(order) ? order.filter((sectionId) => allowed.includes(sectionId)) : [];
  const seen = new Set(fromConfig);
  if (fillDefaults) {
    return [...fromConfig, ...allowed.filter((sectionId) => !seen.has(sectionId))];
  }
  return fromConfig;
}

export default function WizardStep4({ data, onChange }: WizardStep4Props) {
  const config = data.config;
  const showSpend = Boolean(config.show_spend);
  const metricPool = sanitizeMetricPool(showSpend);
  const kpiCards = sanitizeCards(config.kpi_cards ?? [], showSpend);
  const sectionOrder = sanitizeSectionOrder(config.section_order, showSpend, false);

  const patchConfig = (patch: Partial<DashboardFormData["config"]>) => {
    onChange({
      ...data,
      config: {
        ...config,
        ...patch,
      },
    });
  };

  const setKpiCard = (index: number, value: string) => {
    const nextCards = [...kpiCards];
    nextCards[index] = value;
    patchConfig({
      kpi_cards: sanitizeCards(nextCards, showSpend),
    });
  };

  const setPreset = (presetKey: keyof typeof PRESETS) => {
    patchConfig({
      kpi_cards: sanitizeCards(PRESETS[presetKey], showSpend),
    });
  };

  const toggleMetric = (metric: string, checked: boolean) => {
    const set = new Set(config.visible_metrics);
    if (checked) set.add(metric);
    else set.delete(metric);

    patchConfig({
      visible_metrics: sanitizeVisibleMetrics(Array.from(set), showSpend),
    });
  };

  const toggleSection = (sectionId: DashboardSectionId, checked: boolean) => {
    const next = checked
      ? sanitizeSectionOrder([...sectionOrder, sectionId], showSpend, false)
      : sanitizeSectionOrder(sectionOrder.filter((item) => item !== sectionId), showSpend, false);
    patchConfig({ section_order: next });
  };

  const moveSection = (sectionId: DashboardSectionId, direction: -1 | 1) => {
    const currentIndex = sectionOrder.indexOf(sectionId);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= sectionOrder.length) return;
    const next = [...sectionOrder];
    const [item] = next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, item);
    patchConfig({ section_order: next });
  };

  const toggleShowSpend = (checked: boolean) => {
    patchConfig({
      show_spend: checked,
      kpi_cards: sanitizeCards(config.kpi_cards ?? [], checked),
      visible_metrics: sanitizeVisibleMetrics(config.visible_metrics ?? [], checked),
      section_order: sanitizeSectionOrder(config.section_order, checked, false),
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
                {metricPool.map((item) => (
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
          {metricPool.map((metric) => (
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
        <h4 className="text-sm font-semibold text-slate-900">Dashboard sections</h4>
        <p className="mt-1 text-xs text-slate-500">
          Choose which dashboard blocks are shown and reorder them. Spend-related blocks are removed automatically when
          `Show spend` is off.
        </p>
        <div className="mt-3 space-y-2">
          {SECTION_OPTIONS.filter((section) => showSpend || !section.spendRelated).map((section) => {
            const enabled = sectionOrder.includes(section.id);
            const index = sectionOrder.indexOf(section.id);
            return (
              <div
                key={section.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleSection(section.id, e.target.checked)}
                  />
                  {section.label}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{enabled ? `#${index + 1}` : "hidden"}</span>
                  <button
                    type="button"
                    disabled={!enabled || index <= 0}
                    onClick={() => moveSection(section.id, -1)}
                    className="rounded border border-slate-300 p-1 disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!enabled || index === -1 || index >= sectionOrder.length - 1}
                    onClick={() => moveSection(section.id, 1)}
                    className="rounded border border-slate-300 p-1 disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Additional options</h4>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <div className="space-y-2">
            <p className="font-medium text-slate-900">Spend source</p>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input
                type="radio"
                name="spend_source"
                checked={(config.spend_source ?? "platform_actual") === "platform_actual"}
                onChange={() =>
                  onChange({
                    ...data,
                    config: {
                      ...config,
                      spend_source: "platform_actual",
                    },
                  })
                }
              />
              <span>
                <span className="block font-medium text-slate-900">Platform actual</span>
                <span className="block text-xs text-slate-500">
                  Use source-native spend from ad platforms.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input
                type="radio"
                name="spend_source"
                checked={(config.spend_source ?? "platform_actual") === "media_plan_derived"}
                onChange={() =>
                  onChange({
                    ...data,
                    config: {
                      ...config,
                      spend_source: "media_plan_derived",
                    },
                  })
                }
              />
              <span>
                <span className="block font-medium text-slate-900">Media plan derived</span>
                <span className="block text-xs text-slate-500">
                  Recalculate dashboard spend using media plan KPI unit cost when a media plan is connected.
                </span>
              </span>
            </label>
          </div>
          <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.show_spend}
                onChange={(e) => toggleShowSpend(e.target.checked)}
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
