"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, MediaPlanBindingForm } from "@/lib/admin-ui-types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import {
  resolvePlatformIdFromSourceKey,
  resolveSourceKey,
  resolveSourceType,
} from "@/lib/source-mapping";
import {
  resolveMediaPlanRowSourceKeys,
  toggleMediaPlanRowSourceKey,
} from "@/components/admin/media-plan-source-selection";

type ParsedPlanRow = {
  line_key: string;
  instrument: string;
  channel: string;
  format: string;
  buy_type: string;
  budget_plan: number;
  units_plan: number;
  unit_price: number;
  impressions_plan: number;
  reach_plan: number;
  frequency_plan: number;
  views_plan: number;
  clicks_plan: number;
  conversions_plan: number;
  ctr_plan: number;
  cpm_plan: number;
  cpc_plan: number;
  cpv_plan: number;
  cpa_plan: number;
  monthly: Record<string, number>;
  source_keys?: string[];
};

export type CampaignItem = {
  canonical_campaign_id: number;
  source_key: string;
  platform_account_id: string;
  account_name: string;
  platform_campaign_id: string;
  campaign_name: string;
  display_label: string;
};

export type CampaignOption = CampaignItem & {
  value: number;
  label: string;
};

export function buildCampaignOptions(campaigns: CampaignItem[]): CampaignOption[] {
  return campaigns.map((campaign) => ({
    ...campaign,
    value: campaign.canonical_campaign_id,
    label: `${campaign.campaign_name} · ${campaign.platform_campaign_id} · ${campaign.account_name}`,
  }));
}

type WizardStepBindingProps = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
  dashboardId?: string;
};

type BindingDiagnostics = {
  unresolved_legacy_bindings: unknown[];
  unbound_campaigns: unknown[];
  missing_coverage_dates: unknown[];
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function selectedAccountIds(config: Record<string, unknown> | null | undefined): string[] {
  const accountIds = Array.isArray(config?.account_ids)
    ? config.account_ids.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (accountIds.length) return Array.from(new Set(accountIds));
  const singular = String(config?.platform_account_id ?? "").trim();
  return singular ? [singular] : [];
}

export function retainBindingsForRowSources(
  bindings: MediaPlanBindingForm[],
  lineKey: string,
  sourceKeys: string[],
): MediaPlanBindingForm[] {
  const selected = new Set(sourceKeys);
  return bindings.filter((binding) => {
    const bindingLineKey = String(binding.line_key ?? binding.channel).trim();
    return bindingLineKey !== lineKey || selected.has(binding.source_key);
  });
}

function monthSummary(monthly: Record<string, number>): string {
  const parts = Object.entries(monthly)
    .filter(([, value]) => value > 0)
    .slice(0, 6)
    .map(([month, value]) => `${month}: ${compact(value)}`);
  return parts.join(" | ");
}

function parsedRowToInlineRow(row: ParsedPlanRow): Record<string, unknown> {
  return {
    line_key: row.line_key,
    platform: row.instrument,
    channel: row.channel,
    format: row.format,
    buy_type: row.buy_type,
    budget_plan: row.budget_plan,
    units_plan: row.units_plan,
    unit_price: row.unit_price,
    impressions_plan: row.impressions_plan,
    reach_plan: row.reach_plan,
    frequency_plan: row.frequency_plan,
    views_plan: row.views_plan,
    clicks_plan: row.clicks_plan,
    conversions_plan: row.conversions_plan,
    ctr_plan: row.ctr_plan,
    cpm_plan: row.cpm_plan,
    cpc_plan: row.cpc_plan,
    cpv_plan: row.cpv_plan,
    cpa_plan: row.cpa_plan,
    monthly: row.monthly,
    source_keys: Array.isArray(row.source_keys) ? row.source_keys : [],
  };
}

export default function WizardStepBinding({ data, onChange, dashboardId }: WizardStepBindingProps) {
  const [rows, setRows] = useState<ParsedPlanRow[]>([]);
  const [monthsFound, setMonthsFound] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<BindingDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const actualSources = useMemo(
    () => data.sources.filter((source) => source.role === "actual" && source.platform !== "leads"),
    [data.sources],
  );
  const advertisingSources = useMemo(
    () => actualSources.filter((source) => resolveSourceType(resolveSourceKey(source.platform)) === "ads"),
    [actualSources],
  );
  const planSource = useMemo(
    () => data.sources.find((source) => source.role === "plan"),
    [data.sources],
  );
  const bindingCampaignSources = useMemo(
    () =>
      actualSources.filter((source) => {
        if (resolveSourceType(resolveSourceKey(source.platform)) !== "ads") {
          return false;
        }
        return true;
      }),
    [actualSources],
  );
  const bindingSourceOptions = useMemo(() => {
    const seen = new Set<string>();
    return bindingCampaignSources
      .map((source) => {
        const sourceKey = resolveSourceKey(source.platform);
        const platformId = resolvePlatformIdFromSourceKey(sourceKey);
        const meta = PLATFORM_COLORS[platformId];
        return {
          sourceKey,
          label: meta?.label ?? source.platform,
          color: meta?.hex ?? "#94a3b8",
        };
      })
      .filter((option) => {
        if (seen.has(option.sourceKey)) return false;
        seen.add(option.sourceKey);
        return true;
      });
  }, [bindingCampaignSources]);
  const availableSourceKeys = useMemo(
    () => bindingSourceOptions.map((option) => option.sourceKey),
    [bindingSourceOptions],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      if (!planSource?.source_config) {
        setRows([]);
        setMonthsFound([]);
        return;
      }

      const hasPlanInput =
        Boolean(String(planSource.source_config.sheet_url ?? "").trim()) ||
        Boolean(planSource.source_config.upload_file) ||
        Array.isArray(planSource.source_config.inline_rows);
      if (!hasPlanInput) {
        setRows([]);
        setMonthsFound([]);
        return;
      }

      setLoadingRows(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/media-plan/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_config: planSource.source_config }),
        });
        const json = (await response.json()) as { rows?: ParsedPlanRow[]; months_found?: string[]; error?: string };
        if (!response.ok) {
          throw new Error(json.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setRows(Array.isArray(json.rows) ? json.rows : []);
          setMonthsFound(Array.isArray(json.months_found) ? json.months_found : []);
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setMonthsFound([]);
          setError(err instanceof Error ? err.message : "Failed to parse media plan");
        }
      } finally {
        if (!cancelled) {
          setLoadingRows(false);
        }
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [planSource?.source_config]);

  useEffect(() => {
    let cancelled = false;

    async function loadCampaigns() {
      if (!bindingCampaignSources.length) {
        setCampaigns([]);
        return;
      }

      setLoadingCampaigns(true);
      try {
        const sources = bindingCampaignSources.map((source) => {
          return {
            platform: source.platform,
            source_key: resolveSourceKey(source.platform),
            account_ids: selectedAccountIds(source.source_config),
          };
        });
        const response = await fetch("/api/admin/campaigns/all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sources,
            date_from: data.config.period_from,
            date_to: data.config.period_to,
          }),
        });
        const json = (await response.json()) as { campaigns?: CampaignItem[]; error?: string };
        if (!response.ok) {
          throw new Error(json.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
        }
      } catch (err) {
        if (!cancelled) {
          setCampaigns([]);
          setError(err instanceof Error ? err.message : "Failed to load campaigns");
        }
      } finally {
        if (!cancelled) {
          setLoadingCampaigns(false);
        }
      }
    }

    void loadCampaigns();
    return () => {
      cancelled = true;
    };
  }, [bindingCampaignSources, data.config.period_from, data.config.period_to]);

  useEffect(() => {
    let cancelled = false;
    if (!dashboardId || !data.config.period_from || !data.config.period_to) {
      setDiagnostics(null);
      setDiagnosticsError(null);
      return;
    }

    async function loadDiagnostics() {
      try {
        const params = new URLSearchParams({
          from: data.config.period_from,
          to: data.config.period_to,
        });
        const response = await fetch(
          `/api/admin/dashboards/${dashboardId}/binding-diagnostics?${params.toString()}`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as BindingDiagnostics & { error?: string; details?: string };
        if (!response.ok) throw new Error(json.details ?? json.error ?? `HTTP ${response.status}`);
        if (!cancelled) {
          setDiagnostics(json);
          setDiagnosticsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDiagnostics(null);
          setDiagnosticsError(err instanceof Error ? err.message : "Failed to load binding diagnostics");
        }
      }
    }

    void loadDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [dashboardId, data.config.period_from, data.config.period_to]);

  const campaignOptions = useMemo(() => buildCampaignOptions(campaigns), [campaigns]);
  const campaignByCanonicalId = useMemo(
    () => new Map(campaignOptions.map((campaign) => [campaign.canonical_campaign_id, campaign])),
    [campaignOptions],
  );

  const activeRow = useMemo(
    () => rows.find((row) => row.line_key === activeLineKey) ?? null,
    [rows, activeLineKey],
  );

  const activeRowSourceKeys = useMemo(() => {
    if (!activeRow) return null;
    return new Set(resolveMediaPlanRowSourceKeys(activeRow, availableSourceKeys));
  }, [activeRow, availableSourceKeys]);

  const groupedCampaigns = useMemo(() => {
    const filtered = campaignOptions.filter((campaign) => {
      if (activeRowSourceKeys && !activeRowSourceKeys.has(campaign.source_key)) {
        return false;
      }
      const match = search.trim().toLowerCase();
      if (!match) return true;
      return (
        campaign.campaign_name.toLowerCase().includes(match) ||
        campaign.platform_campaign_id.toLowerCase().includes(match) ||
        campaign.account_name.toLowerCase().includes(match)
      );
    });

    const groups = new Map<string, CampaignOption[]>();
    filtered.forEach((campaign) => {
      if (!groups.has(campaign.source_key)) {
        groups.set(campaign.source_key, []);
      }
      groups.get(campaign.source_key)!.push(campaign);
    });
    return groups;
  }, [activeRowSourceKeys, campaignOptions, search]);

  const bindingsByLineKey = useMemo(() => {
    const map = new Map<string, MediaPlanBindingForm[]>();
    data.media_plan_bindings.forEach((binding) => {
      const lineKey = String(binding.line_key ?? binding.channel ?? "").trim();
      if (!lineKey) return;
      if (!map.has(lineKey)) {
        map.set(lineKey, []);
      }
      map.get(lineKey)!.push(binding);
    });
    return map;
  }, [data.media_plan_bindings]);

  const activeBindings = activeLineKey ? bindingsByLineKey.get(activeLineKey) ?? [] : [];
  const activeLabel = activeRow?.channel ?? activeLineKey ?? "";

  const updateRowSourceKeys = (rowIndex: number, sourceKey: string, checked: boolean) => {
    setRows((current) => {
      const nextRows = current.map((row, index) => {
        if (index !== rowIndex) return row;
        const currentKeys = resolveMediaPlanRowSourceKeys(row, availableSourceKeys);
        return {
          ...row,
          source_keys: toggleMediaPlanRowSourceKey(currentKeys, sourceKey, checked, availableSourceKeys),
        };
      });
      const editedRow = nextRows[rowIndex];
      const nextBindings = editedRow
        ? retainBindingsForRowSources(
            data.media_plan_bindings,
            editedRow.line_key,
            resolveMediaPlanRowSourceKeys(editedRow, availableSourceKeys),
          )
        : data.media_plan_bindings;
      onChange({
        ...data,
        media_plan_bindings: nextBindings,
        sources: data.sources.map((source) => {
          if (source.role !== "plan") return source;
          return {
            ...source,
            source_config: {
              ...(source.source_config ?? {}),
              inline_rows: nextRows.map(parsedRowToInlineRow),
            },
          };
        }),
      });
      return nextRows;
    });
  };

  const updateBindings = (nextBindings: MediaPlanBindingForm[]) => {
    onChange({
      ...data,
      media_plan_bindings: nextBindings,
    });
  };

  const toggleBinding = (lineKey: string, channel: string, campaign: CampaignOption, checked: boolean) => {
    const current = data.media_plan_bindings.filter(
      (binding) => String(binding.line_key ?? binding.channel ?? "").trim() !== lineKey,
    );
    const channelBindings = data.media_plan_bindings.filter(
      (binding) => String(binding.line_key ?? binding.channel ?? "").trim() === lineKey,
    );
    const nextChannelBindings = checked
      ? [
          ...channelBindings,
          {
            line_key: lineKey,
            channel,
            canonical_campaign_id: campaign.canonical_campaign_id,
            source_key: campaign.source_key,
            platform_account_id: campaign.platform_account_id,
            platform_campaign_id: campaign.platform_campaign_id,
            effective_from: null,
            effective_to: null,
          },
        ].filter(
          (binding, index, list) =>
            list.findIndex(
              (item) => item.canonical_campaign_id === binding.canonical_campaign_id,
            ) === index,
        )
      : channelBindings.filter(
          (binding) => binding.canonical_campaign_id !== campaign.canonical_campaign_id,
        );

    updateBindings([...current, ...nextChannelBindings]);
  };

  if (!planSource) {
    return (
      <section className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
        Connect a media plan in the previous step to configure row bindings.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Media plan bindings</h4>
            <p className="mt-1 text-xs text-slate-500">
              Bind each media plan row to one or more canonical campaigns across the selected actual sources.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              rows: {rows.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              months: {monthsFound.length ? monthsFound.join(", ") : "none"}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              bindings: {data.media_plan_bindings.length}
            </span>
          </div>
        </div>

        {loadingRows || loadingCampaigns ? (
          <p className="mt-3 text-sm text-slate-500">Loading media plan and campaign catalog...</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        {diagnosticsError ? (
          <p className="mt-3 text-sm text-rose-600">Диагностика bindings: {diagnosticsError}</p>
        ) : null}

        {diagnostics ? (
          <div className="mt-3 grid grid-cols-1 gap-2 border-y border-slate-200 py-3 text-sm sm:grid-cols-3">
            <p>
              <span className="font-semibold text-slate-900">{diagnostics.unresolved_legacy_bindings.length}</span>{" "}
              <span className="text-slate-600">legacy-связей требуют проверки</span>
            </p>
            <p>
              <span className="font-semibold text-slate-900">{diagnostics.unbound_campaigns.length}</span>{" "}
              <span className="text-slate-600">кампаний с фактами без binding</span>
            </p>
            <p>
              <span className="font-semibold text-slate-900">{diagnostics.missing_coverage_dates.length}</span>{" "}
              <span className="text-slate-600">пропусков coverage</span>
            </p>
          </div>
        ) : null}

        {!loadingRows && !rows.length ? (
          <p className="mt-3 text-sm text-slate-500">No parsed media plan rows yet.</p>
        ) : null}

        {!loadingCampaigns && bindingCampaignSources.length < advertisingSources.length ? (
          <p className="mt-3 text-sm text-amber-700">
            {bindingCampaignSources.length
              ? "Для части рекламных источников не выбраны аккаунты на шаге Sources."
              : "На шаге Sources не выбраны аккаунты рекламных платформ."}
          </p>
        ) : null}

        {!loadingCampaigns && !error && bindingCampaignSources.length > 0 && campaignOptions.length === 0 ? (
          <p className="mt-3 text-sm text-amber-700">
            В выбранных аккаунтах пока нет опубликованных и проверенных кампаний.
          </p>
        ) : null}

        {rows.length ? (
          <div className="mt-4 space-y-3">
            {rows.map((row, index) => {
              const bound = bindingsByLineKey.get(row.line_key) ?? [];
              const platformCount = new Set(
                bound
                  .map((item) => campaignByCanonicalId.get(Number(item.canonical_campaign_id))?.source_key ?? item.source_key)
                  .filter(Boolean),
              ).size;
              const rowSourceKeys = resolveMediaPlanRowSourceKeys(row, availableSourceKeys);
              return (
                <div key={row.line_key || `${row.channel}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{row.channel}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                          {row.instrument || "Instrument"}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                          {row.buy_type}
                        </span>
                        {row.format ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                            {row.format}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {formatMoney(row.budget_plan)} | {compact(row.units_plan)} units
                      </p>
                      {monthSummary(row.monthly) ? (
                        <p className="mt-1 text-xs text-slate-500">{monthSummary(row.monthly)}</p>
                      ) : null}
                      {bindingSourceOptions.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {bindingSourceOptions.map((option) => {
                            const checked = rowSourceKeys.includes(option.sourceKey);
                            return (
                              <label
                                key={`${row.line_key}-${option.sourceKey}`}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                                  checked
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-slate-50 text-slate-700"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => updateRowSourceKeys(index, option.sourceKey, event.target.checked)}
                                  className="h-3 w-3"
                                />
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: checked ? "#ffffff" : option.color }}
                                />
                                {option.label}
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                      {!rowSourceKeys.length ? (
                        <p className="mt-2 text-xs text-amber-700">
                          Выберите источник для этой строки, чтобы увидеть кампании в привязке.
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-600">
                        Привязано кампаний: {bound.length}
                        {platformCount ? ` с ${platformCount} платформ` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLineKey(row.line_key);
                          setSearch("");
                        }}
                        disabled={!rowSourceKeys.length}
                        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Привязать
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {activeLineKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-slate-900">
                  {`Привязка кампаний к "${activeLabel}"`}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Показываются кампании только из аккаунтов, выбранных на шаге Sources, и только для платформы строки медиаплана.
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
                placeholder="Поиск по названию, ID или аккаунту"
              />
            </div>

            <div className="mt-4 space-y-4">
              {Array.from(groupedCampaigns.entries()).map(([sourceKey, sourceCampaigns]) => {
                const platformId = resolvePlatformIdFromSourceKey(sourceKey);
                const meta = PLATFORM_COLORS[platformId];
                return (
                  <div key={sourceKey} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: meta?.hex ?? "#94a3b8" }}
                      />
                      <p className="text-sm font-medium text-slate-900">{meta?.label ?? sourceKey}</p>
                    </div>
                    <div className="space-y-2 text-sm">
                      {sourceCampaigns.length ? (
                        sourceCampaigns.map((campaign) => {
                          const checked = activeBindings.some(
                            (binding) => binding.canonical_campaign_id === campaign.canonical_campaign_id,
                          );
                          const boundToAnotherLine = data.media_plan_bindings.some(
                            (binding) =>
                              binding.canonical_campaign_id === campaign.canonical_campaign_id &&
                              String(binding.line_key ?? binding.channel).trim() !== activeLineKey,
                          );
                          return (
                            <label
                              key={campaign.canonical_campaign_id}
                              className={`flex items-start gap-2 rounded border px-3 py-2 ${
                                boundToAnotherLine
                                  ? "border-slate-100 bg-slate-50 text-slate-400"
                                  : "border-slate-200"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={boundToAnotherLine}
                                onChange={(e) =>
                                  toggleBinding(
                                    activeLineKey,
                                    activeLabel,
                                    campaign,
                                    e.target.checked,
                                  )
                                }
                              />
                              <span className="min-w-0">
                                <span className="block text-sm text-slate-900">{campaign.label}</span>
                                {boundToAnotherLine ? (
                                  <span className="mt-0.5 block text-xs text-slate-500">
                                    Уже привязана к другой строке медиаплана
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="text-xs text-slate-500">Нет кампаний для этого источника.</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {!groupedCampaigns.size ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {!bindingCampaignSources.length
                    ? "На шаге Sources не выбраны аккаунты рекламных платформ."
                    : "Для выбранных аккаунтов пока нет опубликованных и проверенных кампаний."}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Выбрано: {activeBindings.length} кампаний с{" "}
                {new Set(
                  activeBindings
                    .map((binding) => campaignByCanonicalId.get(Number(binding.canonical_campaign_id))?.source_key ?? binding.source_key)
                    .filter(Boolean),
                ).size} платформ
              </p>
              <button
                type="button"
                onClick={() => setActiveLineKey(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
