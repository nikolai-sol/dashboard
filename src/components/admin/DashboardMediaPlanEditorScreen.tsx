"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardFormData } from "@/lib/admin-ui-types";

type DashboardMediaPlanEditorScreenProps = {
  dashboardId: string;
};

type MediaPlanRowForm = Record<string, string | number>;

const MONTH_COLUMNS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

const BASE_COLUMNS = [
  "line_key",
  "platform",
  "channel",
  "format",
  "buy_type",
  "units_plan",
  "unit_price",
  "budget_plan",
  "impressions_plan",
  "reach_plan",
  "frequency_plan",
  "views_plan",
  "clicks_plan",
  "conversions_plan",
  "ctr_plan",
  "cpm_plan",
  "cpc_plan",
  "cpv_plan",
  "cpa_plan",
] as const;

const NUMERIC_COLUMNS = new Set<string>([
  "units_plan",
  "unit_price",
  "budget_plan",
  "impressions_plan",
  "reach_plan",
  "frequency_plan",
  "views_plan",
  "clicks_plan",
  "conversions_plan",
  "ctr_plan",
  "cpm_plan",
  "cpc_plan",
  "cpv_plan",
  "cpa_plan",
  ...MONTH_COLUMNS,
]);

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

function toEditableRow(row: Record<string, unknown>, index: number): MediaPlanRowForm {
  const next: MediaPlanRowForm = {};

  for (const column of BASE_COLUMNS) {
    const raw = row[column];
    next[column] = typeof raw === "number" ? raw : String(raw ?? "");
  }

  const monthly =
    row.monthly && typeof row.monthly === "object" ? (row.monthly as Record<string, unknown>) : {};
  for (const month of MONTH_COLUMNS) {
    const raw = monthly[month];
    next[month] = typeof raw === "number" ? raw : Number(raw ?? 0) || 0;
  }

  if (!String(next.line_key ?? "").trim()) {
    next.line_key = `manual::${index + 1}`;
  }
  if (!String(next.buy_type ?? "").trim()) {
    next.buy_type = "CPM";
  }

  return next;
}

function fromEditableRow(row: MediaPlanRowForm): Record<string, unknown> {
  const monthly: Record<string, number> = {};
  for (const month of MONTH_COLUMNS) {
    const raw = row[month];
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim() || 0);
    monthly[month] = Number.isFinite(value) ? value : 0;
  }

  const next: Record<string, unknown> = {
    line_key: String(row.line_key ?? "").trim(),
    platform: String(row.platform ?? "").trim(),
    channel: String(row.channel ?? "").trim(),
    format: String(row.format ?? "").trim(),
    buy_type: String(row.buy_type ?? "CPM").trim().toUpperCase() || "CPM",
    monthly,
  };

  for (const column of BASE_COLUMNS) {
    if (["line_key", "platform", "channel", "format", "buy_type"].includes(column)) continue;
    const raw = row[column];
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim() || 0);
    next[column] = Number.isFinite(value) ? value : 0;
  }

  return next;
}

function buildNewRow(seed: number): MediaPlanRowForm {
  const row: MediaPlanRowForm = {
    line_key: `manual::new::${seed}`,
    platform: "",
    channel: "",
    format: "",
    buy_type: "CPM",
    units_plan: 0,
    unit_price: 0,
    budget_plan: 0,
    impressions_plan: 0,
    reach_plan: 0,
    frequency_plan: 0,
    views_plan: 0,
    clicks_plan: 0,
    conversions_plan: 0,
    ctr_plan: 0,
    cpm_plan: 0,
    cpc_plan: 0,
    cpv_plan: 0,
    cpa_plan: 0,
  };
  for (const month of MONTH_COLUMNS) {
    row[month] = 0;
  }
  return row;
}

export default function DashboardMediaPlanEditorScreen({
  dashboardId,
}: DashboardMediaPlanEditorScreenProps) {
  const [formData, setFormData] = useState<DashboardFormData>(buildDefaultForm);
  const [rows, setRows] = useState<MediaPlanRowForm[]>([]);
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
        let inlineRows = Array.isArray(planSource?.source_config?.inline_rows)
          ? (planSource?.source_config?.inline_rows as Array<Record<string, unknown>>)
          : [];

        if (
          inlineRows.length === 0 &&
          planSource?.source_config &&
          (planSource.source_config.upload_file || String(planSource.source_config.sheet_url ?? "").trim())
        ) {
          try {
            const parseResponse = await fetch("/api/admin/media-plan/parse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source_config: planSource.source_config }),
            });
            const parsePayload = await parseResponse.json().catch(() => ({}));
            if (parseResponse.ok && Array.isArray(parsePayload?.rows)) {
              inlineRows = parsePayload.rows as Array<Record<string, unknown>>;
            }
          } catch {
            // keep fallback to empty state if parsing fails
          }
        }

        setFormData(dashboard);
        setRows(inlineRows.map((row, index) => toEditableRow(row, index)));
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load media plan");
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
  const bindingsCount = formData.media_plan_bindings.length;

  const updateCell = (rowIndex: number, column: string, value: string) => {
    setRows((current) =>
      current.map((row, index) => {
        if (index !== rowIndex) return row;
        if (NUMERIC_COLUMNS.has(column)) {
          const parsed = Number(value);
          return {
            ...row,
            [column]: value === "" ? 0 : Number.isFinite(parsed) ? parsed : 0,
          };
        }
        return {
          ...row,
          [column]: value,
        };
      }),
    );
  };

  const addRow = () => {
    setRows((current) => [...current, buildNewRow(current.length + 1)]);
  };

  const deleteRow = (rowIndex: number) => {
    setRows((current) => current.filter((_, index) => index !== rowIndex));
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
      const trimmedRows = rows
        .map((row) => fromEditableRow(row))
        .filter((row) => String(row.platform ?? "").trim() || String(row.channel ?? "").trim());

      const nextSources = formData.sources.map((source, index) => {
        if (index !== planSourceIndex) return source;
        return {
          ...source,
          source_config: {
            ...(source.source_config ?? {}),
            inline_rows: trimmedRows,
            upload_file: undefined,
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
        throw new Error(payload?.error ?? payload?.details ?? "Failed to save media plan");
      }

      setFormData(nextForm);
      setNotice("Media plan rows saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save media plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Media Plan Editor</h1>
          <p className="max-w-4xl text-sm text-slate-600">
            Edit the normalized media plan rows stored in this dashboard. This is useful after a
            manual upload when you want to correct channels, pricing, or planned metrics without
            re-uploading the whole file.
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
            {saving ? "Saving..." : "Save media plan"}
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
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Rows</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Bindings</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{bindingsCount}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">Important</div>
            <p className="mt-1">
              Changing <code>line_key</code> can break existing media plan bindings and UTM match
              links. Keep it stable unless you intentionally want to remap that row.
            </p>
          </div>
        </div>
      ) : null}

      {hasPlanSource ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Plan rows</h2>
              <p className="text-sm text-slate-500">
                Save here first, then revisit Bindings or UTM Match if you changed structure.
              </p>
            </div>
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add row
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-slate-500">
                  {[...BASE_COLUMNS, ...MONTH_COLUMNS].map((column) => (
                    <th
                      key={column}
                      className="sticky top-0 border-b border-slate-200 bg-white px-2 py-2 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                  <th className="sticky right-0 top-0 border-b border-slate-200 bg-white px-2 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${String(row.line_key)}::${rowIndex}`} className="border-b border-slate-100">
                    {[...BASE_COLUMNS, ...MONTH_COLUMNS].map((column) => {
                      const raw = row[column];
                      const isNumeric = NUMERIC_COLUMNS.has(column);
                      return (
                        <td key={column} className="border-b border-slate-100 px-2 py-2 align-top">
                          <input
                            type={isNumeric ? "number" : "text"}
                            step={isNumeric ? "any" : undefined}
                            value={typeof raw === "number" ? String(raw) : String(raw ?? "")}
                            onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                            className="min-w-[120px] rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                      );
                    })}
                    <td className="sticky right-0 border-b border-slate-100 bg-white px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => deleteRow(rowIndex)}
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

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No inline media plan rows yet. Add a row manually or go back and connect a media plan
              source first.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
