"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardFormData } from "@/lib/admin-ui-types";
import {
  buildAliasMemoryFromRows,
  flattenMediaPlanAliasesForStorage,
  type StoredMediaPlanAlias,
} from "@/lib/media-plan-store";

type Props = {
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
    },
    sources: [],
    media_plan_bindings: [],
  };
}

function buildEmptyAlias(seed: number): StoredMediaPlanAlias {
  return {
    platform: "",
    alias_key: `alias_${seed}`,
    source_key: null,
    campaign_id: "",
    campaign_name: "",
  };
}

export default function DashboardMediaPlanAliasesScreen({ dashboardId }: Props) {
  const [formData, setFormData] = useState<DashboardFormData>(buildDefaultForm);
  const [aliases, setAliases] = useState<StoredMediaPlanAlias[]>([]);
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
        const dashboard = payload.dashboard as DashboardFormData;
        if (!active) return;

        const planSource = dashboard.sources.find((source) => source.role === "plan");
        const review =
          planSource?.source_config?.review && typeof planSource.source_config.review === "object"
            ? (planSource.source_config.review as Record<string, unknown>)
            : {};

        setFormData(dashboard);
        setAliases(flattenMediaPlanAliasesForStorage(review.alias_memory));
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load aliases");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [dashboardId]);

  const planSourceIndex = useMemo(
    () => formData.sources.findIndex((source) => source.role === "plan"),
    [formData.sources],
  );
  const hasPlanSource = planSourceIndex >= 0;

  const updateAlias = (index: number, field: keyof StoredMediaPlanAlias, value: string) => {
    setAliases((current) =>
      current.map((alias, aliasIndex) =>
        aliasIndex === index
          ? {
              ...alias,
              [field]: field === "source_key" ? (value.trim() ? value.trim().toLowerCase() : null) : value,
            }
          : alias,
      ),
    );
  };

  const addAlias = () => {
    setAliases((current) => [...current, buildEmptyAlias(current.length + 1)]);
  };

  const deleteAlias = (index: number) => {
    setAliases((current) => current.filter((_, aliasIndex) => aliasIndex !== index));
  };

  const handleSave = async () => {
    if (!hasPlanSource) {
      setError("This dashboard does not have a media plan source connected.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const filteredAliases = aliases.filter(
        (alias) =>
          alias.platform.trim() &&
          alias.alias_key.trim() &&
          alias.campaign_id.trim() &&
          alias.campaign_name.trim(),
      );

      const nextAliasMemory = buildAliasMemoryFromRows(
        filteredAliases.map((alias) => ({
          ...alias,
          platform: alias.platform.trim(),
          alias_key: alias.alias_key.trim(),
          source_key: alias.source_key?.trim() || null,
          campaign_id: alias.campaign_id.trim(),
          campaign_name: alias.campaign_name.trim(),
        })),
      );

      const nextSources = formData.sources.map((source, index) => {
        if (index !== planSourceIndex) return source;
        const review =
          source.source_config?.review && typeof source.source_config.review === "object"
            ? { ...(source.source_config.review as Record<string, unknown>) }
            : {};
        review.alias_memory = nextAliasMemory;
        return {
          ...source,
          source_config: {
            ...(source.source_config ?? {}),
            review,
          },
        };
      });

      const nextForm: DashboardFormData = {
        ...formData,
        sources: nextSources,
      };

      const response = await fetch(`/api/admin/dashboards/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.details ?? "Failed to save aliases");
      }

      setFormData(nextForm);
      setNotice("Media plan aliases saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save aliases");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Media Plan Aliases</h1>
          <p className="max-w-4xl text-sm text-slate-600">
            Manage reusable plan-to-campaign alias rules. These aliases help media plan rows bind to
            canonical campaigns more predictably when names differ between the plan and source data.
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
            disabled={saving || loading || !hasPlanSource}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save aliases"}
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

      {!loading && !hasPlanSource ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This dashboard does not currently have a media plan source connected.
        </div>
      ) : null}

      {hasPlanSource ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Alias rules</h2>
              <p className="text-sm text-slate-500">
                Use normalized alias keys like channel names or known plan labels that should map to
                canonical campaigns.
              </p>
            </div>
            <button
              type="button"
              onClick={addAlias}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add alias
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-2 py-2">Platform</th>
                  <th className="px-2 py-2">Alias key</th>
                  <th className="px-2 py-2">Source key</th>
                  <th className="px-2 py-2">Campaign ID</th>
                  <th className="px-2 py-2">Campaign name</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {aliases.map((alias, index) => (
                  <tr key={`${alias.platform}::${alias.alias_key}::${index}`} className="border-b border-slate-100">
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={alias.platform}
                        onChange={(event) => updateAlias(index, "platform", event.target.value)}
                        className="min-w-[120px] rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={alias.alias_key}
                        onChange={(event) => updateAlias(index, "alias_key", event.target.value)}
                        className="min-w-[200px] rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={alias.source_key ?? ""}
                        onChange={(event) => updateAlias(index, "source_key", event.target.value)}
                        className="min-w-[140px] rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={alias.campaign_id}
                        onChange={(event) => updateAlias(index, "campaign_id", event.target.value)}
                        className="min-w-[160px] rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={alias.campaign_name}
                        onChange={(event) => updateAlias(index, "campaign_name", event.target.value)}
                        className="min-w-[280px] rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => deleteAlias(index)}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {aliases.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No alias rules yet. Add one when a media plan label should always resolve to a known
              canonical campaign.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
