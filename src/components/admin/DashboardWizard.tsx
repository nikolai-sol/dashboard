"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardPreview from "@/components/admin/DashboardPreview";
import WizardStep1 from "@/components/admin/WizardStep1";
import WizardStep2 from "@/components/admin/WizardStep2";
import WizardStep3 from "@/components/admin/WizardStep3";
import WizardStepBinding from "@/components/admin/WizardStepBinding";
import WizardStepFrequency from "@/components/admin/WizardStepFrequency";
import WizardStep4 from "@/components/admin/WizardStep4";
import type {
  DashboardFormData,
  DashboardSectionId,
  DashboardSourceForm,
  PlatformMeta,
} from "@/lib/admin-ui-types";

type DashboardWizardProps = {
  dashboardId?: string;
};

const STEPS = ["Basic", "Sources", "Filters", "Bindings", "Frequency", "Metrics"];

function defaultSectionOrder(showSpend: boolean): DashboardSectionId[] {
  return showSpend
    ? ["kpi_grid", "spend_section", "trend_chart", "platform_table", "channel_table", "plan_vs_fact"]
    : ["kpi_grid", "trend_chart", "platform_table", "channel_table", "plan_vs_fact"];
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function defaultForm(): DashboardFormData {
  const range = currentMonthRange();
  return {
    client_id: "",
    client_name: "",
    dashboard_name: "",
    dashboard_type: "awareness",
    config: {
      currency: "EUR",
      period_from: range.from,
      period_to: range.to,
      logo_url: "",
      spend_source: "platform_actual",
      visible_metrics: ["impressions", "clicks", "ctr", "cpm", "spend"],
      section_order: defaultSectionOrder(true),
      show_spend: true,
      show_ai_summary: false,
      kpi_cards: ["impressions", "clicks", "ctr", "cpm", "spend"],
        campaign_frequency_overrides: [],
    },
    sources: [],
    media_plan_bindings: [],
  };
}

function isStepComplete(step: number, formData: DashboardFormData) {
  if (step === 0) {
    return (
      Boolean(formData.client_id) &&
      Boolean(formData.client_name) &&
      Boolean(formData.dashboard_name) &&
      Boolean(formData.config.period_from) &&
      Boolean(formData.config.period_to)
    );
  }

  if (step === 1) {
    const actualCount = formData.sources.filter((source) => source.role === "actual").length;
    if (actualCount === 0) return false;
    const plan = formData.sources.find((source) => source.role === "plan");
    if (plan) {
      const sheetUrl = String(plan.source_config?.sheet_url ?? "").trim();
      const hasUpload =
        !!plan.source_config &&
        typeof plan.source_config.upload_file === "object" &&
        plan.source_config.upload_file;
      const hasInline = !!plan.source_config && Array.isArray(plan.source_config.inline_rows);
      return Boolean(sheetUrl || hasUpload || hasInline);
    }
    return true;
  }

  if (step === 2) {
    return formData.sources
      .filter((source) => source.role === "actual")
      .every((source) => {
        const filter = source.filters[0] ?? { filter_type: "all", filter_value: null };
        if (filter.filter_type === "id_list") {
          return Boolean(filter.filter_value && filter.filter_value.trim());
        }
        if (filter.filter_type === "name_pattern") {
          return Boolean(filter.filter_value && filter.filter_value.trim());
        }
        return true;
      });
  }

  if (step === 5) {
    return (formData.config.kpi_cards ?? []).length >= 5;
  }

  return true;
}

function normalizeSources(raw: unknown): DashboardSourceForm[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((source) => {
    const item = source as Partial<DashboardSourceForm>;
    return {
      id: item.id,
      platform: String(item.platform ?? "").toLowerCase(),
      schema_file: String(item.schema_file ?? ""),
      role: item.role === "plan" ? "plan" : "actual",
      source_config:
        item.source_config && typeof item.source_config === "object"
          ? (item.source_config as Record<string, unknown>)
          : null,
      filters: Array.isArray(item.filters) && item.filters.length
        ? item.filters.map((filter) => ({
            filter_type:
              filter.filter_type === "name_pattern" || filter.filter_type === "id_list"
                ? filter.filter_type
                : "all",
            filter_value: filter.filter_value ? String(filter.filter_value) : null,
          }))
        : [{ filter_type: "all", filter_value: null }],
    };
  });
}

export default function DashboardWizard({ dashboardId }: DashboardWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<DashboardFormData>(defaultForm());
  const [platforms, setPlatforms] = useState<PlatformMeta[]>([]);
  const [loading, setLoading] = useState(Boolean(dashboardId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(dashboardId);

  useEffect(() => {
    async function loadPlatforms() {
      try {
        const response = await fetch("/api/admin/platforms");
        const json = await response.json();
        setPlatforms(json.platforms ?? []);
      } catch {
        setPlatforms([]);
      }
    }

    void loadPlatforms();
  }, []);

  useEffect(() => {
    if (!dashboardId) return;

    async function loadDashboard() {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/dashboards/${dashboardId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const dash = json.dashboard;
        if (!dash) throw new Error("Dashboard payload is empty");

        const config = (dash.config ?? {}) as Record<string, unknown>;
        const fallbackRange = currentMonthRange();
        setFormData({
          client_id: String(dash.client_id ?? ""),
          client_name: String(dash.client_name ?? ""),
          dashboard_name: String(dash.dashboard_name ?? ""),
          dashboard_type: dash.dashboard_type ?? "awareness",
          config: {
            currency: (String(config.currency ?? "EUR") as "EUR" | "USD" | "RUB"),
            period_from: String(config.period_from ?? fallbackRange.from),
            period_to: String(config.period_to ?? fallbackRange.to),
            logo_url: String(config.logo_url ?? ""),
            spend_source:
              String(config.spend_source ?? "platform_actual") === "media_plan_derived"
                ? "media_plan_derived"
                : "platform_actual",
            visible_metrics: Array.isArray(config.visible_metrics)
              ? config.visible_metrics.map((item) => String(item))
              : ["impressions", "clicks", "ctr", "cpm", "spend"],
            section_order: Array.isArray(config.section_order)
              ? config.section_order.map((item) => String(item) as DashboardSectionId)
              : defaultSectionOrder(Boolean(config.show_spend ?? true)),
            show_spend: Boolean(config.show_spend ?? true),
            show_ai_summary: Boolean(config.show_ai_summary ?? false),
            kpi_cards: Array.isArray(config.kpi_cards)
              ? config.kpi_cards.map((item) => String(item)).slice(0, 5)
              : ["impressions", "clicks", "ctr", "cpm", "spend"],
            campaign_frequency_overrides: Array.isArray(config.campaign_frequency_overrides)
              ? config.campaign_frequency_overrides
                  .map((item) => {
                    const row =
                      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                    return {
                      source_key: String(row.source_key ?? "").trim().toLowerCase(),
                      platform_campaign_id: String(row.platform_campaign_id ?? "").trim(),
                      month_key: String(row.month_key ?? "").trim(),
                      frequency: Number(row.frequency ?? 0),
                    };
                  })
                  .filter(
                    (item) =>
                      item.source_key &&
                      item.platform_campaign_id &&
                      /^\d{4}-\d{2}$/.test(item.month_key) &&
                      Number.isFinite(item.frequency) &&
                      item.frequency > 0,
                  )
              : [],
          },
          sources: normalizeSources(dash.sources),
          media_plan_bindings: Array.isArray(dash.media_plan_bindings)
            ? dash.media_plan_bindings
                .map((binding: unknown) => {
                  const item =
                    binding && typeof binding === "object" ? (binding as Record<string, unknown>) : {};
                  return {
                    channel: String(item.channel ?? "").trim(),
                    source_key: String(item.source_key ?? "").trim().toLowerCase(),
                    platform_campaign_id: String(item.platform_campaign_id ?? "").trim(),
                  };
                })
                .filter(
                  (binding: {
                    channel: string;
                    source_key: string;
                    platform_campaign_id: string;
                  }) => binding.channel && binding.source_key && binding.platform_campaign_id,
                )
            : [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    void loadDashboard();
  }, [dashboardId]);

  const stepValid = useMemo(() => isStepComplete(step, formData), [formData, step]);
  const furthestAvailableStep = useMemo(() => {
    let furthest = 0;
    for (let index = 0; index < STEPS.length - 1; index += 1) {
      if (!isStepComplete(index, formData)) {
        break;
      }
      furthest = index + 1;
    }
    return furthest;
  }, [formData]);

  const canJumpToStep = (targetStep: number) => targetStep <= furthestAvailableStep;

  const submit = async () => {
    setSaving(true);
    setError(null);

    try {
      const endpoint = isEdit ? `/api/admin/dashboards/${dashboardId}` : "/api/admin/dashboards";
      const method = isEdit ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? `HTTP ${response.status}`);
      }

      router.push("/admin/dashboards");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading dashboard...</p>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {STEPS.map((label, idx) => (
            <button
              type="button"
              key={label}
              onClick={() => canJumpToStep(idx) && setStep(idx)}
              disabled={!canJumpToStep(idx)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                idx === step
                  ? "bg-indigo-600 text-white"
                  : idx < step
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-slate-100 text-slate-500"
              } ${canJumpToStep(idx) ? "cursor-pointer hover:bg-slate-200" : "cursor-not-allowed opacity-50"}`}
            >
              {idx + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        {step === 0 ? <WizardStep1 data={formData} onChange={setFormData} /> : null}
        {step === 1 ? <WizardStep2 data={formData} platforms={platforms} onChange={setFormData} /> : null}
        {step === 2 ? <WizardStep3 data={formData} onChange={setFormData} /> : null}
        {step === 3 ? (
          <WizardStepBinding data={formData} onChange={setFormData} />
        ) : null}
        {step === 4 ? (
          <WizardStepFrequency data={formData} onChange={setFormData} />
        ) : null}
        {step === 5 ? (
          <div className="space-y-4">
            <WizardStep4 data={formData} onChange={setFormData} />
            <DashboardPreview data={formData} />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
          disabled={step === 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex gap-2">
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => Math.min(prev + 1, STEPS.length - 1))}
              disabled={!stepValid}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!stepValid || saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Save changes" : "Create dashboard"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
