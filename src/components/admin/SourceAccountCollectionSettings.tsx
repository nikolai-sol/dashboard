"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SourceAccountCollectionRow,
  SourceAccountCollectionSettingInput,
  SourceCollectionMode,
} from "@/lib/admin-ui-types";

const METRIKA_MODE_OPTIONS: Array<{ value: SourceCollectionMode; label: string }> = [
  {
    value: "ads_only",
    label: "1) РК (базовый)",
  },
  {
    value: "ads_plus_seo",
    label: "2) Abbott (расширенный)",
  },
  {
    value: "ads_plus_seo_plus_user_behavior",
    label: "3) SEO full (полный, только по выделенным)",
  },
];

const METRIKA_MODE_HELP: Record<SourceCollectionMode, string> = {
  ads_only:
    "Рекламный уровень: стандартный сбор по кампаниям/источникам без расширенного пользовательского поведения.",
  ads_plus_seo:
    "Abbott-уровень: расширенный SEO-акцент для базового дашборда, без включения полного поведения.",
  ads_plus_seo_plus_user_behavior:
    "Полный SEO-сбор: расширенные сегменты + пользовательское поведение. Доступно только для выделенных счётчиков.",
};

const ZARUKU_SEO_COUNTER_ID = "66624469";

function isZarukuMainCounter(row: SourceAccountCollectionRow): boolean {
  return row.source_key === "yandex_metrika" && row.platform_account_id === ZARUKU_SEO_COUNTER_ID;
}

function isSeoFullMode(mode: SourceCollectionMode | null, row: SourceAccountCollectionRow): boolean {
  return row.source_key === "yandex_metrika" && mode === "ads_plus_seo_plus_user_behavior";
}

function modeHelp(mode: SourceCollectionMode | null): string {
  return mode ? METRIKA_MODE_HELP[mode] : "Режим не выбран. По умолчанию используется РК (базовый).";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

type EditableRow = SourceAccountCollectionRow;

export default function SourceAccountCollectionSettings() {
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadRows() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/source-accounts", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(String(json?.details ?? json?.error ?? "Failed to load collection settings"));
        }
        if (!cancelled) {
          setRows(Array.isArray(json?.rows) ? (json.rows as EditableRow[]) : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load collection settings");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadRows();
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceOptions = useMemo(() => {
    const unique = new Map<string, string>();
    rows.forEach((row) => {
      unique.set(row.source_key, row.source_label);
    });
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (sourceFilter !== "all" && row.source_key !== sourceFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return [row.source_label, row.account_name, row.platform_account_id].some((value) =>
        value.toLowerCase().includes(normalizedSearch),
      );
    });
  }, [rows, search, sourceFilter]);

  function updateRow(
    sourceKey: string,
    platformAccountId: string,
    patch: Partial<Pick<EditableRow, "is_active" | "cron_enabled" | "collection_mode">>,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.source_key === sourceKey && row.platform_account_id === platformAccountId ? { ...row, ...patch } : row,
      ),
    );
  }

  async function saveRows() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload: SourceAccountCollectionSettingInput[] = rows.map((row) => ({
        source_key: row.source_key,
        platform_account_id: row.platform_account_id,
        is_active: row.is_active,
        cron_enabled: row.cron_enabled,
        collection_mode: row.collection_mode_supported ? row.collection_mode ?? "ads_only" : null,
      }));
      const response = await fetch("/api/admin/source-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(String(json?.details ?? json?.error ?? "Failed to save collection settings"));
      }
      setRows(Array.isArray(json?.rows) ? (json.rows as EditableRow[]) : []);
      setMessage("Collection settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save collection settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Collection</h1>
        <p className="mt-2 text-sm text-slate-600">Loading source accounts...</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Collection</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Manage per-account collection behavior. Cron enabled only affects scheduled runs; nothing is enabled
            automatically. Yandex Metrika currently uses collection mode, while other sources only use active and cron
            toggles.
          </p>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            For Yandex Metrika we mark three levels: 1) Ads only, 2) Abbott-level SEO, 3) Full SEO (large
            data). Full SEO is only for selected counters, for Zaruku this is counter <span className="font-semibold">66624469</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={saveRows}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-[220px_1fr]">
        <label className="block text-sm text-slate-700">
          Source
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="all">All sources</option>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-700">
          Search
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search account, counter, or source"
          />
        </label>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Account / Counter</th>
              <th className="px-3 py-3 font-medium">Active</th>
              <th className="px-3 py-3 font-medium">Cron enabled</th>
              <th className="px-3 py-3 font-medium">Collection mode</th>
              <th className="px-3 py-3 font-medium">Last run</th>
              <th className="px-3 py-3 font-medium">Latest data date</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={`${row.source_key}:${row.platform_account_id}`} className="border-b border-slate-100 align-top">
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-900">{row.source_label}</div>
                  <div className="text-xs text-slate-500">{row.source_key}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{row.account_name}</span>
                    {isZarukuMainCounter(row) ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Zaruku SEO
                      </span>
                    ) : null}
                    {isSeoFullMode(row.collection_mode, row) && !isZarukuMainCounter(row) ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                        SEO full
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">{row.platform_account_id}</div>
                </td>
                <td className="px-3 py-3">
                  <label className="inline-flex items-center gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(event) =>
                        updateRow(row.source_key, row.platform_account_id, { is_active: event.target.checked })
                      }
                    />
                    <span>{row.is_active ? "Yes" : "No"}</span>
                  </label>
                </td>
                <td className="px-3 py-3">
                  <label className="inline-flex items-center gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.cron_enabled}
                      onChange={(event) =>
                        updateRow(row.source_key, row.platform_account_id, { cron_enabled: event.target.checked })
                      }
                    />
                    <span>{row.cron_enabled ? "Yes" : "No"}</span>
                  </label>
                </td>
                <td className="px-3 py-3">
                  {row.collection_mode_supported ? (
                    <div className="space-y-2">
                      <select
                        className="w-full min-w-[220px] rounded-lg border border-slate-300 px-3 py-2"
                        value={row.collection_mode ?? "ads_only"}
                        onChange={(event) =>
                          updateRow(row.source_key, row.platform_account_id, {
                            collection_mode: event.target.value as SourceCollectionMode,
                          })
                        }
                      >
                        {METRIKA_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs leading-4 text-slate-500">{modeHelp(row.collection_mode)}</p>
                      {isSeoFullMode(row.collection_mode, row) && !isZarukuMainCounter(row) ? (
                        <p className="text-xs leading-4 text-amber-700">
                          Полный SEO-профиль включён для этого счётчика. Проверьте, что он действительно должен быть
                          выделенным.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="text-slate-900">{formatDateTime(row.last_run_at)}</div>
                  <div className="text-xs text-slate-500">{row.last_run_status ?? "—"}</div>
                </td>
                <td className="px-3 py-3 text-slate-900">{row.latest_data_date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No source accounts matched the current filters.</p>
        ) : null}
      </div>
    </section>
  );
}
