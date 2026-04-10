"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardPreview from "@/components/admin/DashboardPreview";
import DashboardAiSummaryAuthoringPanel from "@/components/admin/DashboardAiSummaryAuthoringPanel";
import WizardStep1 from "@/components/admin/WizardStep1";
import WizardStep2 from "@/components/admin/WizardStep2";
import WizardStep3 from "@/components/admin/WizardStep3";
import WizardStepBinding from "@/components/admin/WizardStepBinding";
import DashboardUtmSourceMatching from "@/components/admin/DashboardUtmSourceMatching";
import WizardStepFrequency from "@/components/admin/WizardStepFrequency";
import WizardStep4 from "@/components/admin/WizardStep4";
import {
  getDefaultKpiCards,
  getDefaultSectionOrder,
  sanitizeSectionOrder as sanitizeDashboardSectionOrder,
} from "@/lib/dashboard-presets";
import { normalizeMultibrandConfig } from "@/lib/multibrand";
import { resolveSourceKey } from "@/lib/source-mapping";
import type {
  CustomKpiCardForm,
  DashboardFormData,
  DashboardSourceForm,
  PlatformMeta,
} from "@/lib/admin-ui-types";

type DashboardWizardProps = {
  dashboardId?: string;
};

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
      language: "en",
      period_from: range.from,
      period_to: range.to,
      logo_url: "",
      spend_source: "platform_actual",
      filter_scope: "both",
      visible_metrics: ["impressions", "clicks", "ctr", "cpm", "spend"],
      section_order: getDefaultSectionOrder("awareness", true),
      show_spend: true,
      show_ai_summary: false,
      kpi_cards: getDefaultKpiCards("awareness", true),
      custom_kpi_cards: [],
      campaign_frequency_overrides: [],
      multibrand: {
        enabled: false,
        executive_title: "",
        executive_subtitle: "",
        brands: [],
      },
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
    const actualCount = formData.sources.filter(
      (source) => source.role === "actual" && source.platform !== "manual_data" && source.platform !== "leads",
    ).length;
    const customTableCount = formData.sources.filter((source) => source.role === "custom_table").length;
    const manualDataCount = formData.sources.filter((source) => source.platform === "manual_data").length;
    const leadsSources = formData.sources.filter((source) => source.platform === "leads");
    if (actualCount === 0 && customTableCount === 0 && manualDataCount === 0) return false;
    const manualDataSources = formData.sources.filter((source) => source.platform === "manual_data");
    if (manualDataCount > 0) {
      const allManualHaveInput = manualDataSources.every((source) => {
        const sheetUrl = String(source.source_config?.sheet_url ?? "").trim();
        const hasUpload =
          !!source.source_config &&
          typeof source.source_config.upload_file === "object" &&
          source.source_config.upload_file;
        return Boolean(sheetUrl || hasUpload);
      });
      if (!allManualHaveInput) return false;
    }
    if (leadsSources.length > 0) {
      const allLeadsHaveInput = leadsSources.every((source) => {
        const sheetUrl = String(source.source_config?.sheet_url ?? "").trim();
        const hasUpload =
          !!source.source_config &&
          typeof source.source_config.upload_file === "object" &&
          source.source_config.upload_file;
        const hasInline = !!source.source_config && Array.isArray(source.source_config.inline_rows);
        return Boolean(sheetUrl || hasUpload || hasInline);
      });
      if (!allLeadsHaveInput) return false;
    }
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
    const filtersValid = formData.sources
      .filter((source) => source.role === "actual" && source.platform !== "leads")
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

    const multibrand = formData.config.multibrand;
    if (!multibrand?.enabled) {
      return filtersValid;
    }

    const multibrandValid = multibrand.brands.length > 0 && multibrand.brands.every((brand) => brand.id && brand.label);
    return filtersValid && multibrandValid;
  }

  return true;
}

function normalizeSources(raw: unknown): DashboardSourceForm[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((source) => {
    const item = source as Partial<DashboardSourceForm>;
    const role =
      item.role === "plan"
        ? "plan"
        : item.role === "custom_table"
          ? "custom_table"
          : "actual";
    const platform =
      role === "custom_table"
        ? "custom_table"
        : item.platform === "manual_data"
          ? "manual_data"
          : item.platform === "leads"
            ? "leads"
          : String(item.platform ?? "").toLowerCase();
    const schemaFile =
      role === "custom_table"
        ? "custom_table"
        : item.platform === "manual_data"
          ? "schemas/manual_data.yaml"
          : item.platform === "leads"
            ? "schemas/leads.yaml"
          : String(item.schema_file ?? "");
    return {
      id: item.id,
      platform,
      schema_file: schemaFile,
      role,
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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const isHydratingRef = useRef(false);
  const dirtyRef = useRef(false);
  const allowNavigationRef = useRef(false);

  const isEdit = Boolean(dashboardId);
  const hasMetrikaSource = useMemo(
    () => formData.sources.some((source) => source.role === "actual" && resolveSourceKey(source.platform) === "yandex_metrika"),
    [formData.sources],
  );
  const steps = useMemo(
    () =>
      isEdit && hasMetrikaSource
        ? ["Basic", "Sources", "Filters", "Bindings", "UTM Match", "Frequency", "Metrics"]
        : ["Basic", "Sources", "Filters", "Bindings", "Frequency", "Metrics"],
    [hasMetrikaSource, isEdit],
  );
  const utmMatchingStepIndex = isEdit && hasMetrikaSource ? 4 : -1;
  const frequencyStepIndex = utmMatchingStepIndex >= 0 ? 5 : 4;
  const metricsStepIndex = utmMatchingStepIndex >= 0 ? 6 : 5;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const confirmLeave = () => {
      if (!dirtyRef.current || allowNavigationRef.current) return true;
      const confirmed = window.confirm("You have unsaved changes. Leave this page?");
      if (confirmed) {
        allowNavigationRef.current = true;
      }
      return confirmed;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (!link.href || link.target === "_blank" || link.hasAttribute("download")) return;

      const nextUrl = new URL(link.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      const isSameDocument =
        nextUrl.origin === currentUrl.origin &&
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;
      if (isSameDocument) return;

      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handlePopState = () => {
      if (confirmLeave()) return;
      window.history.pushState(null, "", window.location.href);
    };

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const handleFormChange = (next: DashboardFormData) => {
    setFormData(next);
    if (!isHydratingRef.current) {
      setDirty(true);
      setSaveMessage(null);
    }
  };

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
        isHydratingRef.current = true;
        setFormData({
          client_id: String(dash.client_id ?? ""),
          client_name: String(dash.client_name ?? ""),
          dashboard_name: String(dash.dashboard_name ?? ""),
          dashboard_type: dash.dashboard_type ?? "awareness",
          config: {
            currency: (String(config.currency ?? "EUR") as "EUR" | "USD" | "RUB"),
            language: String(config.language ?? "en") === "ru" ? "ru" : "en",
            period_from: String(config.period_from ?? fallbackRange.from),
            period_to: String(config.period_to ?? fallbackRange.to),
            logo_url: String(config.logo_url ?? ""),
            spend_source:
              String(config.spend_source ?? "platform_actual") === "media_plan_derived"
                ? "media_plan_derived"
                : "platform_actual",
            filter_scope:
              String(config.filter_scope ?? "both") === "channel"
                ? "channel"
                : String(config.filter_scope ?? "both") === "platform"
                  ? "platform"
                  : "both",
            visible_metrics: Array.isArray(config.visible_metrics)
              ? config.visible_metrics.map((item) => String(item))
              : ["impressions", "clicks", "ctr", "cpm", "spend"],
            section_order: Array.isArray(config.section_order)
              ? sanitizeDashboardSectionOrder(
                  config.section_order,
                  (dash.dashboard_type ?? "awareness"),
                  Boolean(config.show_spend ?? true),
                  false,
                )
              : sanitizeDashboardSectionOrder(
                  config.section_order,
                  (dash.dashboard_type ?? "awareness"),
                  Boolean(config.show_spend ?? true),
                  true,
                ),
            show_spend: Boolean(config.show_spend ?? true),
            show_ai_summary: Boolean(config.show_ai_summary ?? false),
            kpi_cards: Array.isArray(config.kpi_cards)
              ? config.kpi_cards.map((item) => String(item)).slice(0, 5)
              : ["impressions", "clicks", "ctr", "cpm", "spend"],
            custom_kpi_cards: Array.isArray(config.custom_kpi_cards)
              ? config.custom_kpi_cards
                  .map((item) => {
                    const row =
                      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                    const id = String(row.id ?? "").trim();
                    const title = String(row.title ?? "").trim();
                    const value = Number(row.value ?? 0);
                    const trendSource = String(row.trend_source ?? "").trim().toLowerCase();
                    if (!id || !title || !Number.isFinite(value) || !trendSource) return null;
                    return {
                      id,
                      title,
                      value,
                      trend_source: trendSource,
                    } satisfies CustomKpiCardForm;
                  })
                  .filter(Boolean) as CustomKpiCardForm[]
              : [],
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
            multibrand: normalizeMultibrandConfig(config.multibrand) ?? {
              enabled: false,
              executive_title: "",
              executive_subtitle: "",
              brands: [],
            },
          },
          sources: normalizeSources(dash.sources),
          media_plan_bindings: Array.isArray(dash.media_plan_bindings)
            ? dash.media_plan_bindings
                .map((binding: unknown) => {
                  const item =
                    binding && typeof binding === "object" ? (binding as Record<string, unknown>) : {};
                  return {
                    line_key: String(item.line_key ?? item.channel ?? "").trim(),
                    channel: String(item.channel ?? "").trim(),
                    source_key: String(item.source_key ?? "").trim().toLowerCase(),
                    platform_campaign_id: String(item.platform_campaign_id ?? "").trim(),
                  };
                })
                .filter(
                  (binding: {
                    line_key?: string;
                    channel: string;
                    source_key: string;
                    platform_campaign_id: string;
                  }) => (binding.line_key || binding.channel) && binding.channel && binding.source_key && binding.platform_campaign_id,
                )
            : [],
        });
        setDirty(false);
        setSaveMessage(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        isHydratingRef.current = false;
        setLoading(false);
      }
    }

    void loadDashboard();
  }, [dashboardId]);

  const stepValid = useMemo(() => {
    if (step === metricsStepIndex) {
      return (formData.config.kpi_cards ?? []).length >= 5;
    }
    return isStepComplete(step, formData);
  }, [formData, metricsStepIndex, step]);
  const furthestAvailableStep = useMemo(() => {
    let furthest = 0;
    for (let index = 0; index < steps.length - 1; index += 1) {
      const complete =
        index === metricsStepIndex ? (formData.config.kpi_cards ?? []).length >= 5 : isStepComplete(index, formData);
      if (!complete) {
        break;
      }
      furthest = index + 1;
    }
    return furthest;
  }, [formData, metricsStepIndex, steps.length]);

  const canJumpToStep = (targetStep: number) => targetStep <= furthestAvailableStep;

  const prepareFormDataForSave = async (input: DashboardFormData): Promise<DashboardFormData> => {
    const nextSources = [...input.sources];
    let changed = false;

    for (let index = 0; index < nextSources.length; index += 1) {
      const source = nextSources[index];
      if (source.platform !== "leads" || source.role !== "actual") {
        continue;
      }

      const sourceConfig =
        source.source_config && typeof source.source_config === "object"
          ? (source.source_config as Record<string, unknown>)
          : {};
      const review =
        sourceConfig.review && typeof sourceConfig.review === "object"
          ? (sourceConfig.review as Record<string, unknown>)
          : {};
      const status = String(review.status ?? "").trim().toLowerCase();
      const hasInlineRows = Array.isArray(sourceConfig.inline_rows) && sourceConfig.inline_rows.length > 0;

      if (status === "confirmed" && hasInlineRows) {
        continue;
      }

      const response = await fetch("/api/admin/leads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_config: sourceConfig,
          dashboard: {
            ...input,
            sources: nextSources,
          },
        }),
      });
      const json = (await response.json()) as {
        error?: string;
        details?: string;
        reviewed_source_config?: Record<string, unknown>;
      };
      if (!response.ok || !json.reviewed_source_config) {
        throw new Error(
          json.details
            ? `${json.error ?? "Failed to confirm leads source"}: ${json.details}`
            : json.error ?? "Failed to confirm leads source",
        );
      }

      nextSources[index] = {
        ...source,
        source_config: json.reviewed_source_config,
      };
      changed = true;
    }

    if (!changed) {
      return input;
    }

    return {
      ...input,
      sources: nextSources,
    };
  };

  const persistDashboard = async (opts?: { manual?: boolean }): Promise<boolean> => {
    const manual = Boolean(opts?.manual);
    if (saving) return false;

    setSaving(true);
    setError(null);
    if (manual) {
      setSaveMessage(null);
    }

    try {
      const prepared = await prepareFormDataForSave(formData);
      if (prepared !== formData) {
        isHydratingRef.current = true;
        setFormData(prepared);
        isHydratingRef.current = false;
      }

      const endpoint = isEdit ? `/api/admin/dashboards/${dashboardId}` : "/api/admin/dashboards";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepared),
      });

      const json = (await response.json()) as {
        id?: number;
        error?: string;
        details?: string;
        message?: string;
      };
      if (!response.ok) {
        const msg = json.error ?? `HTTP ${response.status}`;
        const details = json.details ?? json.message;
        setError(details ? `${msg}: ${details}` : msg);
        return false;
      }

      setDirty(false);
      dirtyRef.current = false;
      allowNavigationRef.current = false;
      setSaveMessage(manual ? "Changes saved." : null);

      if (!isEdit && json.id) {
        router.replace(`/admin/dashboards/${json.id}/edit`);
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleStepChange = async (targetStep: number) => {
    if (targetStep === step || !canJumpToStep(targetStep)) return;
    setError(null);
    setSaveMessage(null);
    setStep(targetStep);
  };

  const submit = async () => {
    await persistDashboard({ manual: true });
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading dashboard...</p>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {steps.map((label, idx) => (
              <button
                type="button"
                key={label}
                onClick={() => void handleStepChange(idx)}
                disabled={!canJumpToStep(idx) || saving}
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

          <div className="flex items-center gap-2 text-xs">
            {dirty ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-700">
                Unsaved changes
              </span>
            ) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
                All changes saved
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        {step === 0 ? <WizardStep1 data={formData} onChange={handleFormChange} /> : null}
        {step === 1 ? (
          <WizardStep2
            data={formData}
            platforms={platforms}
            onChange={handleFormChange}
            dashboardId={dashboardId}
          />
        ) : null}
        {step === 2 ? <WizardStep3 data={formData} onChange={handleFormChange} /> : null}
        {step === 3 ? <WizardStepBinding data={formData} onChange={handleFormChange} /> : null}
        {utmMatchingStepIndex >= 0 && step === utmMatchingStepIndex ? (
          <DashboardUtmSourceMatching dashboardId={String(dashboardId)} />
        ) : null}
        {step === frequencyStepIndex ? (
          <WizardStepFrequency data={formData} onChange={handleFormChange} />
        ) : null}
        {step === metricsStepIndex ? (
          <div className="space-y-4">
            <WizardStep4 data={formData} onChange={handleFormChange} />
            <DashboardPreview data={formData} />
            {dashboardId ? <DashboardAiSummaryAuthoringPanel dashboardId={dashboardId} /> : null}
          </div>
        ) : null}
      </div>

      {saveMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {saveMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void handleStepChange(Math.max(step - 1, 0))}
          disabled={step === 0 || saving}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex gap-2">
          {isEdit && step < steps.length - 1 ? (
            <button
              type="button"
              onClick={submit}
              disabled={saving || !dirty}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          ) : null}
          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => void handleStepChange(Math.min(step + 1, steps.length - 1))}
              disabled={!stepValid || saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Next"}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!stepValid || saving || (isEdit && !dirty)}
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
