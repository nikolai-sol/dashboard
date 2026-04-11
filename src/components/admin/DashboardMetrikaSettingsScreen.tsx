"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardFormData } from "@/lib/admin-ui-types";
import { normalizeDashboardMetrikaSettings } from "@/lib/dashboard-metrika-settings";
import { normalizeDashboardSectionFieldOverrides } from "@/lib/dashboard-section-fields";
import WizardStepMetrika from "@/components/admin/WizardStepMetrika";

type DashboardMetrikaSettingsScreenProps = {
  dashboardId: string;
};

function buildDefaultForm(): DashboardFormData {
  return {
    client_id: "",
    client_name: "",
    dashboard_name: "",
    dashboard_type: "awareness",
    config: {
      currency: "RUB",
      period_from: "",
      period_to: "",
      visible_metrics: [],
      show_spend: true,
      show_ai_summary: false,
      kpi_cards: [],
      section_order: [],
      metrika_settings: normalizeDashboardMetrikaSettings(undefined),
      section_field_overrides: normalizeDashboardSectionFieldOverrides(undefined),
    },
    sources: [],
    media_plan_bindings: [],
  };
}

export default function DashboardMetrikaSettingsScreen({
  dashboardId,
}: DashboardMetrikaSettingsScreenProps) {
  const [formData, setFormData] = useState<DashboardFormData>(buildDefaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/dashboards/${dashboardId}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load dashboard");
        }

        const dashboard = payload.dashboard as DashboardFormData & {
          config?: DashboardFormData["config"];
        };

        if (!active) return;

        setFormData({
          ...dashboard,
          config: {
            ...dashboard.config,
            metrika_settings: normalizeDashboardMetrikaSettings(dashboard.config?.metrika_settings),
          },
        });
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [dashboardId]);

  const hasMetrikaSource = useMemo(
    () =>
      formData.sources.some(
        (source) =>
          source.role === "actual" &&
          (source.platform === "yandex_metrika" || source.schema_file === "yandex_metrika"),
      ),
    [formData.sources],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/dashboards/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.details ?? "Failed to save settings");
      }
      setNotice("Metrika settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Yandex Metrika Settings</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Choose which website analytics fields we show in the dashboard and which Metrika goals
            should count as dashboard conversions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/dashboards/${dashboardId}/edit`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Edit
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !hasMetrikaSource}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {!loading && !hasMetrikaSource ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This dashboard does not currently have a Yandex Metrika actual source connected.
        </div>
      ) : null}

      <WizardStepMetrika dashboardId={dashboardId} data={formData} onChange={setFormData} />
    </section>
  );
}
