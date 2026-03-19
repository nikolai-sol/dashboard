"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, MediaPlanBindingForm } from "@/lib/admin-ui-types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import { resolvePlatformIdFromSourceKey, resolveSourceKey } from "@/lib/source-mapping";

type ParsedPlanRow = {
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
};

type CampaignItem = {
  source_key: string;
  platform_campaign_id: string;
  campaign_name: string;
};

type WizardStepBindingProps = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
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

function monthSummary(monthly: Record<string, number>): string {
  const parts = Object.entries(monthly)
    .filter(([, value]) => value > 0)
    .slice(0, 6)
    .map(([month, value]) => `${month}: ${compact(value)}`);
  return parts.join(" | ");
}

export default function WizardStepBinding({ data, onChange }: WizardStepBindingProps) {
  const [rows, setRows] = useState<ParsedPlanRow[]>([]);
  const [monthsFound, setMonthsFound] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const actualSources = useMemo(
    () => data.sources.filter((source) => source.role === "actual"),
    [data.sources],
  );
  const planSource = useMemo(
    () => data.sources.find((source) => source.role === "plan"),
    [data.sources],
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
      if (!actualSources.length) {
        setCampaigns([]);
        return;
      }

      setLoadingCampaigns(true);
      try {
        const sources = actualSources.map((source) => {
          const base = {
            platform: source.platform,
            source_key: resolveSourceKey(source.platform),
            account_ids: Array.isArray(source.source_config?.account_ids)
              ? source.source_config.account_ids.map((item) => String(item).trim()).filter(Boolean)
              : [],
          };
          if (source.platform === "manual_data") {
            return {
              ...base,
              source_key: "manual_data",
              sheet_url: String(source.source_config?.sheet_url ?? "").trim(),
            };
          }
          return base;
        });
        const params = new URLSearchParams({
          sources: JSON.stringify(sources),
        });
        if (data.config.period_from) params.set("date_from", data.config.period_from);
        if (data.config.period_to) params.set("date_to", data.config.period_to);
        const response = await fetch(`/api/admin/campaigns/all?${params.toString()}`);
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
  }, [actualSources, data.config.period_from, data.config.period_to]);

  const groupedCampaigns = useMemo(() => {
    const filtered = campaigns.filter((campaign) => {
      const match = search.trim().toLowerCase();
      if (!match) return true;
      return (
        campaign.campaign_name.toLowerCase().includes(match) ||
        campaign.platform_campaign_id.toLowerCase().includes(match)
      );
    });

    const groups = new Map<string, CampaignItem[]>();
    filtered.forEach((campaign) => {
      if (!groups.has(campaign.source_key)) {
        groups.set(campaign.source_key, []);
      }
      groups.get(campaign.source_key)!.push(campaign);
    });
    return groups;
  }, [campaigns, search]);

  const bindingsByChannel = useMemo(() => {
    const map = new Map<string, MediaPlanBindingForm[]>();
    data.media_plan_bindings.forEach((binding) => {
      if (!map.has(binding.channel)) {
        map.set(binding.channel, []);
      }
      map.get(binding.channel)!.push(binding);
    });
    return map;
  }, [data.media_plan_bindings]);

  const activeBindings = activeChannel ? bindingsByChannel.get(activeChannel) ?? [] : [];

  const updateBindings = (nextBindings: MediaPlanBindingForm[]) => {
    onChange({
      ...data,
      media_plan_bindings: nextBindings,
    });
  };

  const toggleBinding = (channel: string, sourceKey: string, campaignId: string, checked: boolean) => {
    const current = data.media_plan_bindings.filter((binding) => binding.channel !== channel);
    const channelBindings = data.media_plan_bindings.filter((binding) => binding.channel === channel);
    const key = `${channel}:${sourceKey}:${campaignId}`;
    const nextChannelBindings = checked
      ? [
          ...channelBindings,
          { channel, source_key: sourceKey, platform_campaign_id: campaignId },
        ].filter(
          (binding, index, list) =>
            list.findIndex(
              (item) =>
                `${item.channel}:${item.source_key}:${item.platform_campaign_id}` ===
                `${binding.channel}:${binding.source_key}:${binding.platform_campaign_id}`,
            ) === index,
        )
      : channelBindings.filter(
          (binding) => `${binding.channel}:${binding.source_key}:${binding.platform_campaign_id}` !== key,
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

        {!loadingRows && !rows.length ? (
          <p className="mt-3 text-sm text-slate-500">No parsed media plan rows yet.</p>
        ) : null}

        {rows.length ? (
          <div className="mt-4 space-y-3">
            {rows.map((row, index) => {
              const bound = bindingsByChannel.get(row.channel) ?? [];
              const platformCount = new Set(bound.map((item) => item.source_key)).size;
              return (
                <div key={`${row.channel}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
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
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-600">
                        Привязано кампаний: {bound.length}
                        {platformCount ? ` с ${platformCount} платформ` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannel(row.channel);
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
        ) : null}
      </div>

      {activeChannel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-slate-900">
                  {`Привязка кампаний к "${activeChannel}"`}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Можно выбрать кампании с нескольких платформ одновременно.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveChannel(null)}
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
                placeholder="Поиск кампаний по названию или ID"
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
                            (binding) =>
                              binding.source_key === sourceKey &&
                              binding.platform_campaign_id === campaign.platform_campaign_id,
                          );
                          return (
                            <label
                              key={`${sourceKey}-${campaign.platform_campaign_id}`}
                              className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  toggleBinding(
                                    activeChannel,
                                    sourceKey,
                                    campaign.platform_campaign_id,
                                    e.target.checked,
                                  )
                                }
                              />
                              <span className="min-w-0">
                                <span className="block font-mono text-xs text-slate-500">
                                  {campaign.platform_campaign_id}
                                </span>
                                <span className="block text-sm text-slate-900">{campaign.campaign_name}</span>
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
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Выбрано: {activeBindings.length} кампаний с{" "}
                {new Set(activeBindings.map((binding) => binding.source_key)).size} платформ
              </p>
              <button
                type="button"
                onClick={() => setActiveChannel(null)}
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
