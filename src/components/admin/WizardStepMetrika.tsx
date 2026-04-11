"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, DashboardMetrikaSettingsPayload } from "@/lib/admin-ui-types";
import { ALL_METRIKA_TRAFFIC_METRICS, normalizeDashboardMetrikaSettings } from "@/lib/dashboard-metrika-settings";
import { resolveSourceKey } from "@/lib/source-mapping";

type WizardStepMetrikaProps = {
  dashboardId?: string;
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

function compact(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
}

function getMetrikaAccountIds(data: DashboardFormData): string[] {
  return Array.from(
    new Set(
      data.sources
        .filter((source) => source.role === "actual" && resolveSourceKey(source.platform) === "yandex_metrika")
        .flatMap((source) =>
          Array.isArray(source.source_config?.account_ids)
            ? source.source_config.account_ids.map((item) => String(item).trim()).filter(Boolean)
            : [],
        ),
    ),
  );
}

export default function WizardStepMetrika({ dashboardId, data, onChange }: WizardStepMetrikaProps) {
  const [payload, setPayload] = useState<DashboardMetrikaSettingsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const metrikaAccountIds = useMemo(() => getMetrikaAccountIds(data), [data]);
  const settings = useMemo(
    () => normalizeDashboardMetrikaSettings(data.config.metrika_settings),
    [data.config.metrika_settings],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!dashboardId || !metrikaAccountIds.length) {
        setPayload(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (data.config.period_from) params.set("from", data.config.period_from);
        if (data.config.period_to) params.set("to", data.config.period_to);
        if (metrikaAccountIds.length) params.set("account_ids", metrikaAccountIds.join(","));
        const response = await fetch(`/api/admin/dashboards/${dashboardId}/metrika-settings?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as DashboardMetrikaSettingsPayload & { error?: string };
        if (!response.ok) {
          throw new Error(json.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) setPayload(json);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load Metrika settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [dashboardId, data.config.period_from, data.config.period_to, metrikaAccountIds]);

  const filteredGoals = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = payload?.goals ?? [];
    if (!query) return rows;
    return rows.filter((row) => row.goal_name.toLowerCase().includes(query) || row.goal_id.includes(query));
  }, [payload, search]);

  const patchSettings = (patch: Partial<typeof settings>) => {
    onChange({
      ...data,
      config: {
        ...data.config,
        metrika_settings: {
          ...settings,
          ...patch,
        },
      },
    });
  };

  const toggleTrafficMetric = (metric: (typeof ALL_METRIKA_TRAFFIC_METRICS)[number], checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...settings.selected_traffic_metrics, metric]))
      : settings.selected_traffic_metrics.filter((item) => item !== metric);
    patchSettings({
      selected_traffic_metrics: next.length ? next : [metric],
    });
  };

  const toggleGoal = (goalId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...settings.selected_goal_ids, goalId]))
      : settings.selected_goal_ids.filter((item) => item !== goalId);
    patchSettings({
      goal_mode: "selected",
      selected_goal_ids: next,
    });
  };

  const selectAllGoals = () => {
    patchSettings({
      goal_mode: "selected",
      selected_goal_ids: (payload?.goals ?? []).map((item) => item.goal_id),
    });
  };

  const clearGoals = () => {
    patchSettings({
      goal_mode: "selected",
      selected_goal_ids: [],
    });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="text-base font-semibold text-slate-900">Yandex Metrika settings</h4>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Choose which Metrika traffic fields to show in the dashboard and which goals should count as post-click
          conversions. This keeps Landsail focused on tagged post-click analytics instead of summing every goal in
          the counter.
        </p>

        {!dashboardId ? (
          <p className="mt-3 text-sm text-amber-700">Save the dashboard first to inspect available Metrika goals.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-slate-500">Loading Metrika fields and goals…</p> : null}

        {payload ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Dashboard</div>
              <div className="mt-1 font-medium text-slate-900">
                {payload.dashboard.client_id} / {payload.dashboard.dashboard_name}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Period</div>
              <div className="mt-1 font-medium text-slate-900">
                {payload.dashboard.period_from ?? "?"} - {payload.dashboard.period_to ?? "?"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Metrika counters</div>
              <div className="mt-1 font-medium text-slate-900">
                {payload.dashboard.metrika_account_ids.length
                  ? payload.dashboard.metrika_account_ids.join(", ")
                  : "Not connected"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Observed goals</div>
              <div className="mt-1 font-medium text-slate-900">{payload.goals.length}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h5 className="text-sm font-semibold text-slate-900">Traffic fields used in dashboard</h5>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(payload?.traffic_metrics ?? []).map((metric) => (
            <label key={metric.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={settings.selected_traffic_metrics.includes(metric.id)}
                  onChange={(e) => toggleTrafficMetric(metric.id, e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-slate-900">{metric.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{metric.description}</div>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h5 className="text-sm font-semibold text-slate-900">Conversion goals used for post-click analytics</h5>
            <p className="mt-1 text-sm text-slate-600">
              If you leave <span className="font-medium">Use all goals</span> enabled, every Metrika goal in the
              selected period is summed into conversions. Switch to selected mode to count only the goals that matter.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => patchSettings({ goal_mode: "all" })}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                settings.goal_mode === "all"
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Use all goals
            </button>
            <button
              type="button"
              onClick={() => patchSettings({ goal_mode: "selected" })}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                settings.goal_mode === "selected"
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Use selected goals
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search goal name or ID"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:max-w-md"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectAllGoals}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearGoals}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          Selected goals:{" "}
          <span className="font-medium text-slate-700">
            {settings.goal_mode === "all"
              ? `all ${payload?.goals.length ?? 0}`
              : `${settings.selected_goal_ids.length} of ${payload?.goals.length ?? 0}`}
          </span>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-3 py-3">Use</th>
                <th className="px-3 py-3">Goal</th>
                <th className="px-3 py-3">ID</th>
                <th className="px-3 py-3 text-right">Total reaches</th>
                <th className="px-3 py-3">Seen in period</th>
              </tr>
            </thead>
            <tbody>
              {filteredGoals.map((goal, index) => {
                const checked = settings.goal_mode === "all" ? true : settings.selected_goal_ids.includes(goal.goal_id);
                return (
                  <tr key={goal.goal_id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={settings.goal_mode === "all"}
                        onChange={(e) => toggleGoal(goal.goal_id, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-3 align-top font-medium text-slate-900">{goal.goal_name}</td>
                    <td className="px-3 py-3 align-top font-mono text-xs text-slate-600">{goal.goal_id}</td>
                    <td className="px-3 py-3 text-right align-top text-slate-700">{compact(goal.total_goal_reaches)}</td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {goal.min_date ?? "?"} - {goal.max_date ?? "?"}
                    </td>
                  </tr>
                );
              })}
              {filteredGoals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    No goals found for the selected period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
