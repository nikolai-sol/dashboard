"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardUtmMatchingPayload } from "@/lib/admin-ui-types";

type Props = {
  dashboardId: string;
};

type BindingMap = Record<string, string>;

function compact(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
}

export default function DashboardUtmSourceMatching({ dashboardId }: Props) {
  const [payload, setPayload] = useState<DashboardUtmMatchingPayload | null>(null);
  const [bindings, setBindings] = useState<BindingMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const mediaPlanRowByKey = useMemo(() => {
    const map = new Map<string, DashboardUtmMatchingPayload["media_plan_rows"][number]>();
    (payload?.media_plan_rows ?? []).forEach((row) => map.set(row.line_key, row));
    return map;
  }, [payload]);

  const load = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/dashboards/${dashboardId}/utm-source-matching`, { cache: "no-store" });
      const json = (await response.json()) as DashboardUtmMatchingPayload & { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? `HTTP ${response.status}`);
      }
      setPayload(json);
      setActiveLineKey(null);
      setSearch("");
      const nextBindings: BindingMap = {};
      (json.observed_sources ?? []).forEach((row) => {
        nextBindings[row.utm_source] = row.current_line_key ?? row.suggested_line_key ?? "";
      });
      setBindings(nextBindings);
    } catch (err) {
      setPayload(null);
      setBindings({});
      setError(err instanceof Error ? err.message : "Failed to load UTM matching");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [dashboardId]);

  const dirtyCount = useMemo(() => {
    if (!payload) return 0;
    return payload.observed_sources.filter((row) => (bindings[row.utm_source] ?? "") !== (row.current_line_key ?? "")).length;
  }, [bindings, payload]);

  const bindingsByLineKey = useMemo(() => {
    const map = new Map<string, DashboardUtmMatchingPayload["observed_sources"]>();
    for (const row of payload?.observed_sources ?? []) {
      const lineKey = String(bindings[row.utm_source] ?? "").trim();
      if (!lineKey) continue;
      if (!map.has(lineKey)) map.set(lineKey, []);
      map.get(lineKey)!.push(row);
    }
    return map;
  }, [bindings, payload]);

  const activeRow = activeLineKey ? mediaPlanRowByKey.get(activeLineKey) ?? null : null;
  const activeBindings = activeLineKey ? bindingsByLineKey.get(activeLineKey) ?? [] : [];

  const filteredObservedSources = useMemo(() => {
    const match = search.trim().toLowerCase();
    const rows = payload?.observed_sources ?? [];
    if (!match) return rows;
    return rows.filter((row) =>
      row.utm_source.toLowerCase().includes(match) ||
      row.mediums_preview.some((item) => item.toLowerCase().includes(match)) ||
      row.campaigns_preview.some((item) => item.toLowerCase().includes(match)),
    );
  }, [payload, search]);

  const toggleBinding = (utmSource: string, lineKey: string, checked: boolean) => {
    setBindings((prev) => {
      const next = { ...prev };
      if (checked) {
        next[utmSource] = lineKey;
      } else if (next[utmSource] === lineKey) {
        next[utmSource] = "";
      }
      return next;
    });
  };

  const save = async () => {
    if (!payload) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const rows = payload.observed_sources
        .map((row) => {
          const lineKey = String(bindings[row.utm_source] ?? "").trim();
          const target = mediaPlanRowByKey.get(lineKey);
          if (!lineKey || !target) return null;
          return {
            utm_source: row.utm_source,
            line_key: target.line_key,
            channel: target.channel,
            source_key: null,
          };
        })
        .filter(Boolean);

      const response = await fetch(`/api/admin/dashboards/${dashboardId}/utm-source-matching`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindings: rows }),
      });
      const json = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(json.error ?? `HTTP ${response.status}`);
      }
      setMessage(json.message ?? "Saved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save UTM matching");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900">UTM matching to media plan rows</h4>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              For each media plan row, choose the observed
              <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs">utm_source</code>
              values from Yandex Metrika that belong to it. This keeps post-click analytics tied to the same
              primary naming layer as your media plan bindings.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || saving}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={loading || saving || !payload}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Saving..." : `Save UTM bindings${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
            </button>
          </div>
        </div>

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
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">Media plan rows</div>
              <div className="mt-1 font-medium text-slate-900">{payload.media_plan_rows.length}</div>
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-emerald-600">{message}</p> : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading...</div>
      ) : null}

      {!loading && payload && payload.dashboard.metrika_account_ids.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Yandex Metrika is not connected in dashboard sources, so UTM matching is unavailable.
        </div>
      ) : null}

      {!loading && payload && payload.observed_sources.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="space-y-3">
            {payload.media_plan_rows.map((planRow) => {
              const bound = bindingsByLineKey.get(planRow.line_key) ?? [];
              const totalVisits = bound.reduce((sum, item) => sum + item.visits, 0);
              const totalGoals = bound.reduce((sum, item) => sum + item.goal_reaches, 0);
              return (
                <div key={planRow.line_key} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{planRow.channel}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {planRow.instrument ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                            {planRow.instrument}
                          </span>
                        ) : null}
                        {planRow.bound_source_keys.length ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                            {planRow.bound_source_keys.join(", ")}
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                            no source binding yet
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        Bound UTM sources: {bound.length} | visits: {compact(totalVisits)} | goals: {compact(totalGoals)}
                      </p>
                      {bound.length ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {bound.map((item) => item.utm_source).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-600">
                        Suggested from current facts:{" "}
                        {payload.observed_sources.filter((row) => row.suggested_line_key === planRow.line_key).length}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLineKey(planRow.line_key);
                          setSearch("");
                        }}
                        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        Привязать
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeLineKey && activeRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-slate-900">
                  {`Привязка UTM к "${activeRow.channel}"`}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Выберите все observed <code className="rounded bg-slate-100 px-1 py-0.5">utm_source</code>,
                  которые относятся к этой строке медиаплана.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveLineKey(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по utm_source, medium или campaign"
              />
            </div>

            <div className="mt-4 space-y-2">
              {filteredObservedSources.map((row) => {
                const checked = (bindings[row.utm_source] ?? "") === activeLineKey;
                const currentlyBoundElsewhere =
                  row.current_line_key && row.current_line_key !== activeLineKey
                    ? mediaPlanRowByKey.get(row.current_line_key)?.channel ?? row.current_line_key
                    : null;
                return (
                  <label
                    key={row.utm_source}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleBinding(row.utm_source, activeLineKey, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{row.utm_source}</span>
                      <span className="mt-1 block text-xs text-slate-600">
                        visits: {compact(row.visits)} | goals: {compact(row.goal_reaches)} | mediums: {row.medium_count} | campaigns: {row.campaign_count}
                      </span>
                      {row.mediums_preview.length ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          mediums: {row.mediums_preview.join(", ")}
                        </span>
                      ) : null}
                      {row.campaigns_preview.length ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          campaigns: {row.campaigns_preview.join(", ")}
                        </span>
                      ) : null}
                      {row.suggested_line_key === activeLineKey ? (
                        <span className="mt-1 inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          suggested for this row
                        </span>
                      ) : null}
                      {currentlyBoundElsewhere ? (
                        <span className="mt-1 block text-xs text-amber-700">
                          currently bound to: {currentlyBoundElsewhere}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Выбрано для строки: {activeBindings.length} UTM sources
              </p>
              <button
                type="button"
                onClick={() => setActiveLineKey(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
