"use client";

import type { DashboardFormData } from "@/lib/admin-ui-types";
import { getDefaultKpiCards, getDefaultSectionOrder } from "@/lib/dashboard-presets";

type WizardStep1Props = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

function sameStringArray(a: string[] | undefined, b: string[]) {
  const left = Array.isArray(a) ? a : [];
  return left.length === b.length && left.every((item, index) => item === b[index]);
}

export default function WizardStep1({ data, onChange }: WizardStep1Props) {
  const setField = (key: keyof DashboardFormData, value: string) => {
    onChange({ ...data, [key]: value });
  };

  const setConfig = (key: keyof DashboardFormData["config"], value: string) => {
    onChange({
      ...data,
      config: {
        ...data.config,
        [key]: value,
      },
    });
  };

  const multibrand = data.config.multibrand ?? {
    enabled: false,
    executive_title: "",
    executive_subtitle: "",
    brands: [],
  };

  const patchMultibrand = (patch: Partial<typeof multibrand>) => {
    onChange({
      ...data,
      config: {
        ...data.config,
        multibrand: {
          ...multibrand,
          ...patch,
        },
      },
    });
  };

  const handleLogoFileChange = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return;
    }
    if (file.size > 1024 * 1024) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setConfig("logo_url", reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client ID</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.client_id}
            onChange={(e) => setField("client_id", e.target.value.toLowerCase())}
            placeholder="rag_mp"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client Name</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.client_name}
            onChange={(e) => setField("client_name", e.target.value)}
            placeholder="RAG Market Place"
          />
        </label>
      </div>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-700">Dashboard Name</span>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          value={data.dashboard_name}
          onChange={(e) => setField("dashboard_name", e.target.value)}
          placeholder="Awareness Q1 2025"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-700">Logo URL</span>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          value={data.config.logo_url ?? ""}
          onChange={(e) => setConfig("logo_url", e.target.value)}
          placeholder="https://.../logo.png"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Upload logo from disk</span>
          <input
            type="file"
            accept="image/*"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            onChange={(e) => void handleLogoFileChange(e.target.files?.[0] ?? null)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Image only. Stored as data URL in dashboard config. Max 1 MB.
          </span>
        </label>

        <button
          type="button"
          onClick={() => setConfig("logo_url", "")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          Clear logo
        </button>
      </div>

      {data.config.logo_url ? (
        <div className="w-fit rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.config.logo_url}
              alt="Logo preview"
              className="h-full w-full object-contain object-center p-1.5"
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Type</span>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.dashboard_type}
            onChange={(e) => {
              const nextType = e.target.value as DashboardFormData["dashboard_type"];
              const showSpend = Boolean(data.config.show_spend);
              const currentDefaultSections = getDefaultSectionOrder(data.dashboard_type, showSpend);
              const currentDefaultKpis = getDefaultKpiCards(data.dashboard_type, showSpend);
              const next: DashboardFormData = {
                ...data,
                dashboard_type: nextType,
                config: {
                  ...data.config,
                  section_order:
                    sameStringArray(data.config.section_order, currentDefaultSections)
                      ? getDefaultSectionOrder(nextType, showSpend)
                      : data.config.section_order,
                  kpi_cards:
                    sameStringArray(data.config.kpi_cards, currentDefaultKpis)
                      ? getDefaultKpiCards(nextType, showSpend)
                      : data.config.kpi_cards,
                },
              };
              onChange(next);
            }}
          >
            <option value="awareness">Awareness</option>
            <option value="multibrand">Multibrand</option>
            <option value="performance">Performance</option>
            <option value="overview">Overview</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Dashboard language</span>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.config.language ?? "en"}
            onChange={(e) => setConfig("language", e.target.value)}
          >
            <option value="en">English</option>
            <option value="ru">Russian</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Period From</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.config.period_from}
            onChange={(e) => setConfig("period_from", e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Period To</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.config.period_to}
            onChange={(e) => setConfig("period_to", e.target.value)}
          />
        </label>
      </div>

      <label className="text-sm md:w-56">
        <span className="mb-1 block font-medium text-slate-700">Currency</span>
        <select
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          value={data.config.currency}
          onChange={(e) => setConfig("currency", e.target.value as DashboardFormData["config"]["currency"])}
        >
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
          <option value="RUB">RUB</option>
        </select>
      </label>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={Boolean(multibrand.enabled)}
            onChange={(e) => patchMultibrand({ enabled: e.target.checked })}
          />
          <span className="text-sm text-slate-700">
            <span className="block font-medium text-slate-900">Enable multibrand overlay</span>
            <span className="mt-1 block text-xs text-slate-500">
              Adds an executive layer and brand switcher on top of this dashboard only. Existing dashboards stay unchanged.
            </span>
          </span>
        </label>

        {multibrand.enabled ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Executive panel title</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={multibrand.executive_title ?? ""}
                onChange={(e) => patchMultibrand({ executive_title: e.target.value })}
                placeholder="Леовит · 2026"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Executive subtitle</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={multibrand.executive_subtitle ?? ""}
                onChange={(e) => patchMultibrand({ executive_subtitle: e.target.value })}
                placeholder="Multi-brand · 3 бренда · 17 каналов"
              />
            </label>
          </div>
        ) : null}
      </section>
    </section>
  );
}
