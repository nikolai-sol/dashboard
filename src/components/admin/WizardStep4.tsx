"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type {
  CustomKpiCardForm,
  DashboardFormData,
  DashboardPostClickFieldId,
  DashboardPromopagesFieldId,
  DashboardSectionId,
} from "@/lib/admin-ui-types";
import {
  sanitizeSectionOrder as sanitizeDashboardSectionOrder,
  SPEND_RELATED_METRICS,
} from "@/lib/dashboard-presets";
import { normalizeDashboardSectionFieldOverrides } from "@/lib/dashboard-section-fields";

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

const SECTION_OPTIONS: Array<{ id: DashboardSectionId; label: string; spendRelated?: boolean; performanceOnly?: boolean }> = [
  { id: "kpi_grid", label: "KPI cards" },
  { id: "spend_section", label: "Spend by platform + channel mix", spendRelated: true },
  { id: "trend_chart", label: "Trend chart" },
  { id: "analytics", label: "Website analytics" },
  { id: "postclick_analytics", label: "Post-click analytics" },
  { id: "promopages", label: "Promopages" },
  { id: "conversion_funnel", label: "Conversion funnel", performanceOnly: true },
  { id: "campaign_table", label: "Campaign performance", spendRelated: true, performanceOnly: true },
  { id: "scatter_plot", label: "Spend vs conversions scatter", spendRelated: true, performanceOnly: true },
  { id: "platform_plan_fact", label: "Platform performance plan/fact" },
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

const POSTCLICK_FIELD_OPTIONS: Array<{ id: DashboardPostClickFieldId; label: string }> = [
  { id: "visits", label: "Visits" },
  { id: "users", label: "Users" },
  { id: "pageviews", label: "Pageviews" },
  { id: "goal_reaches", label: "Goal reaches" },
  { id: "conversion_rate", label: "Conversion rate" },
  { id: "bounce_rate", label: "Bounce rate" },
  { id: "avg_visit_duration", label: "Avg visit duration" },
];

const PROMOPAGES_FIELD_OPTIONS: Array<{ id: DashboardPromopagesFieldId; label: string }> = [
  { id: "impressions", label: "Impressions" },
  { id: "reach", label: "Reach" },
  { id: "views", label: "Views" },
  { id: "budget", label: "Budget" },
  { id: "ctr", label: "CTR" },
  { id: "cpm", label: "CPM" },
  { id: "clickouts", label: "Clickouts" },
  { id: "full_reads", label: "Full reads" },
  { id: "metrica_visits", label: "Metrika visits" },
];

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

function sanitizeCustomKpiCards(cards: CustomKpiCardForm[] | undefined, showSpend: boolean): CustomKpiCardForm[] {
  const allowed = sanitizeMetricPool(showSpend);
  const fallbackTrendSource = allowed[0] ?? "impressions";
  if (!Array.isArray(cards)) return [];
  return cards
    .map((card, index) => {
      const title = String(card.title ?? "").trim();
      const value = Number(card.value ?? 0);
      const trendSource = allowed.includes(card.trend_source) ? card.trend_source : fallbackTrendSource;
      if (!title || !Number.isFinite(value)) return null;
      return {
        id: String(card.id ?? "").trim() || `custom_${Date.now()}_${index}`,
        title,
        value,
        trend_source: trendSource,
      };
    })
    .filter((card): card is CustomKpiCardForm => Boolean(card));
}

function sanitizeSectionOrder(
  order: DashboardSectionId[] | undefined,
  dashboardType: DashboardFormData["dashboard_type"],
  showSpend: boolean,
  fillDefaults = false,
): DashboardSectionId[] {
  return sanitizeDashboardSectionOrder(order, dashboardType, showSpend, fillDefaults);
}

function createCustomKpiCard(index: number): CustomKpiCardForm {
  return {
    id: `custom_${Date.now()}_${index}`,
    title: `Custom KPI ${index + 1}`,
    value: 0,
    trend_source: "conversions",
  };
}

export default function WizardStep4({ data, onChange }: WizardStep4Props) {
  const config = data.config;
  const showSpend = Boolean(config.show_spend);
  const sectionFieldOverrides = normalizeDashboardSectionFieldOverrides(config.section_field_overrides);
  const metricPool = sanitizeMetricPool(showSpend);
  const kpiCards = sanitizeCards(config.kpi_cards ?? [], showSpend);
  const sectionOrder = sanitizeSectionOrder(config.section_order, data.dashboard_type, showSpend, false);
  const customKpiCards = sanitizeCustomKpiCards(config.custom_kpi_cards, showSpend);
  const visibleSectionOptions = SECTION_OPTIONS.filter(
    (section) =>
      (data.dashboard_type === "performance" || !section.performanceOnly) &&
      (showSpend || !section.spendRelated),
  );

  const patchConfig = (patch: Partial<DashboardFormData["config"]>) => {
    onChange({
      ...data,
      config: {
        ...config,
        ...patch,
      },
    });
  };

  const patchSectionFieldOverrides = (
    patch: Partial<NonNullable<DashboardFormData["config"]["section_field_overrides"]>>,
  ) => {
    patchConfig({
      section_field_overrides: {
        ...sectionFieldOverrides,
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
      ? sanitizeSectionOrder([...sectionOrder, sectionId], data.dashboard_type, showSpend, false)
      : sanitizeSectionOrder(sectionOrder.filter((item) => item !== sectionId), data.dashboard_type, showSpend, false);
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
      section_order: sanitizeSectionOrder(config.section_order, data.dashboard_type, checked, false),
      custom_kpi_cards: sanitizeCustomKpiCards(config.custom_kpi_cards, checked),
    });
  };

  const patchCustomKpiCards = (cards: CustomKpiCardForm[]) => {
    patchConfig({ custom_kpi_cards: sanitizeCustomKpiCards(cards, showSpend) });
  };

  const addCustomKpiCard = () => {
    patchCustomKpiCards([...customKpiCards, createCustomKpiCard(customKpiCards.length)]);
  };

  const updateCustomKpiCard = (
    id: string,
    patch: Partial<CustomKpiCardForm>,
  ) => {
    patchCustomKpiCards(
      customKpiCards.map((card) =>
        card.id === id
          ? {
              ...card,
              ...patch,
            }
          : card,
      ),
    );
  };

  const removeCustomKpiCard = (id: string) => {
    patchCustomKpiCards(customKpiCards.filter((card) => card.id !== id));
  };

  const togglePostclickField = (fieldId: DashboardPostClickFieldId, checked: boolean) => {
    const current = new Set(sectionFieldOverrides.postclick_analytics?.visible_fields ?? []);
    if (checked) current.add(fieldId);
    else current.delete(fieldId);
    patchSectionFieldOverrides({
      postclick_analytics: {
        visible_fields: Array.from(current) as DashboardPostClickFieldId[],
      },
    });
  };

  const togglePromopagesField = (fieldId: DashboardPromopagesFieldId, checked: boolean) => {
    const current = new Set(sectionFieldOverrides.promopages?.visible_metrics ?? []);
    if (checked) current.add(fieldId);
    else current.delete(fieldId);
    patchSectionFieldOverrides({
      promopages: {
        visible_metrics: Array.from(current) as DashboardPromopagesFieldId[],
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Custom KPI cards</h4>
            <p className="mt-1 text-xs text-slate-500">
              Add static KPI values that are always shown as entered. Trend and delta are borrowed from the selected base KPI.
            </p>
          </div>
          <button
            type="button"
            onClick={addCustomKpiCard}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Add custom KPI card
          </button>
        </div>

        {customKpiCards.length ? (
          <div className="mt-3 space-y-3">
            {customKpiCards.map((card, index) => (
              <div key={card.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900">Custom card #{index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeCustomKpiCard(card.id)}
                    className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-sm text-slate-700">
                    <span className="mb-1 block">Title</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={card.title}
                      onChange={(e) => updateCustomKpiCard(card.id, { title: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    <span className="mb-1 block">Value</span>
                    <input
                      type="number"
                      step="any"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={card.value}
                      onChange={(e) => updateCustomKpiCard(card.id, { value: Number(e.target.value || 0) })}
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    <span className="mb-1 block">Trend source</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={card.trend_source}
                      onChange={(e) => updateCustomKpiCard(card.id, { trend_source: e.target.value })}
                    >
                      {metricPool.map((metric) => (
                        <option key={metric} value={metric}>
                          {metric.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
          {visibleSectionOptions.map((section) => {
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
        <h4 className="text-sm font-semibold text-slate-900">Section field controls</h4>
        <p className="mt-1 text-xs text-slate-500">
          Configure which fields each optional section exposes. Website analytics metrics are managed in the
          Yandex Metrika screen because they use dashboard-level Metrika settings and selected conversion goals.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <h5 className="text-sm font-semibold text-slate-900">Post-click analytics columns</h5>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {POSTCLICK_FIELD_OPTIONS.map((field) => (
                <label key={field.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={sectionFieldOverrides.postclick_analytics?.visible_fields.includes(field.id) ?? false}
                    onChange={(e) => togglePostclickField(field.id, e.target.checked)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h5 className="text-sm font-semibold text-slate-900">Promopages metrics</h5>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PROMOPAGES_FIELD_OPTIONS.map((field) => (
                <label key={field.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={sectionFieldOverrides.promopages?.visible_metrics.includes(field.id) ?? false}
                    onChange={(e) => togglePromopagesField(field.id, e.target.checked)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Additional options</h4>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <div className="space-y-2">
            <p className="font-medium text-slate-900">Dashboard filter scope</p>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input
                type="radio"
                name="filter_scope"
                checked={(config.filter_scope ?? "both") === "both"}
                onChange={() => patchConfig({ filter_scope: "both" })}
              />
              <span>
                <span className="block font-medium text-slate-900">Platforms + Channels</span>
                <span className="block text-xs text-slate-500">
                  Let users switch between platform and channel chips in the dashboard filter.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input
                type="radio"
                name="filter_scope"
                checked={(config.filter_scope ?? "both") === "platform"}
                onChange={() => patchConfig({ filter_scope: "platform" })}
              />
              <span>
                <span className="block font-medium text-slate-900">Platforms only</span>
                <span className="block text-xs text-slate-500">
                  Show only platform chips in the dashboard filter.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <input
                type="radio"
                name="filter_scope"
                checked={(config.filter_scope ?? "both") === "channel"}
                onChange={() => patchConfig({ filter_scope: "channel" })}
              />
              <span>
                <span className="block font-medium text-slate-900">Channels only</span>
                <span className="block text-xs text-slate-500">
                  Show only channel chips in the dashboard filter.
                </span>
              </span>
            </label>
          </div>
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
