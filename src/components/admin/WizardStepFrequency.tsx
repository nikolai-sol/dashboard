"use client";

import { useEffect, useMemo, useState } from "react";
import type { CampaignFrequencyOverrideForm, DashboardFormData } from "@/lib/admin-ui-types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import { resolvePlatformIdFromSourceKey, resolveSourceKey } from "@/lib/source-mapping";

type CampaignItem = {
  source_key: string;
  platform_campaign_id: string;
  campaign_name: string;
};

type WizardStepFrequencyProps = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

function buildMonths(from: string, to: string) {
  if (!from || !to) return [];
  const months: Array<{ key: string; label: string }> = [];
  let cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 7);
    const label = cursor.toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    months.push({
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

function normalizeFrequency(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(4));
}

function uniqueBindings(data: DashboardFormData) {
  const seen = new Set<string>();
  return data.media_plan_bindings.filter((binding) => {
    const key = `${binding.source_key}:${binding.platform_campaign_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function WizardStepFrequency({ data, onChange }: WizardStepFrequencyProps) {
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actualSources = useMemo(
    () => data.sources.filter((source) => source.role === "actual"),
    [data.sources],
  );
  const selectedBindings = useMemo(() => uniqueBindings(data), [data]);
  const months = useMemo(
    () => buildMonths(data.config.period_from, data.config.period_to),
    [data.config.period_from, data.config.period_to],
  );
  const overrides = useMemo(
    () => Array.isArray(data.config.campaign_frequency_overrides) ? data.config.campaign_frequency_overrides : [],
    [data.config.campaign_frequency_overrides],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCampaigns() {
      if (!actualSources.length) {
        setCampaigns([]);
        return;
      }

      setLoadingCampaigns(true);
      setError(null);
      try {
        const sources = actualSources.map((source) => ({
          platform: source.platform,
          source_key: resolveSourceKey(source.platform),
          account_ids: Array.isArray(source.source_config?.account_ids)
            ? source.source_config.account_ids.map((item) => String(item).trim()).filter(Boolean)
            : [],
        }));
        const params = new URLSearchParams({
          sources: JSON.stringify(sources),
        });
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
  }, [actualSources]);

  useEffect(() => {
    const allowedCampaignKeys = new Set(
      selectedBindings.map((binding) => `${binding.source_key}:${binding.platform_campaign_id}`),
    );
    const allowedMonths = new Set(months.map((month) => month.key));
    const sanitized = overrides.filter(
      (item) =>
        allowedCampaignKeys.has(`${item.source_key}:${item.platform_campaign_id}`) &&
        allowedMonths.has(item.month_key) &&
        Number.isFinite(item.frequency) &&
        item.frequency > 0,
    );
    if (sanitized.length !== overrides.length) {
      onChange({
        ...data,
        config: {
          ...data.config,
          campaign_frequency_overrides: sanitized,
        },
      });
    }
  }, [data, months, onChange, overrides, selectedBindings]);

  const campaignMeta = useMemo(() => {
    const map = new Map<string, CampaignItem>();
    campaigns.forEach((campaign) => {
      map.set(`${campaign.source_key}:${campaign.platform_campaign_id}`, campaign);
    });
    return map;
  }, [campaigns]);

  const rows = useMemo(
    () =>
      selectedBindings.map((binding) => {
        const key = `${binding.source_key}:${binding.platform_campaign_id}`;
        return {
          ...binding,
          campaign_name: campaignMeta.get(key)?.campaign_name ?? "Campaign name unavailable",
        };
      }),
    [campaignMeta, selectedBindings],
  );

  const updateOverride = (
    sourceKey: string,
    campaignId: string,
    monthKey: string,
    nextFrequency: number | null,
  ) => {
    const nextOverrides = overrides.filter(
      (item) =>
        !(
          item.source_key === sourceKey &&
          item.platform_campaign_id === campaignId &&
          item.month_key === monthKey
        ),
    );

    if (nextFrequency !== null) {
      nextOverrides.push({
        source_key: sourceKey,
        platform_campaign_id: campaignId,
        month_key: monthKey,
        frequency: nextFrequency,
      });
    }

    onChange({
      ...data,
      config: {
        ...data.config,
        campaign_frequency_overrides: nextOverrides.sort((a, b) =>
          `${a.source_key}:${a.platform_campaign_id}:${a.month_key}`.localeCompare(
            `${b.source_key}:${b.platform_campaign_id}:${b.month_key}`,
          ),
        ),
      },
    });
  };

  const getFrequencyValue = (sourceKey: string, campaignId: string, monthKey: string) =>
    overrides.find(
      (item) =>
        item.source_key === sourceKey &&
        item.platform_campaign_id === campaignId &&
        item.month_key === monthKey,
    )?.frequency;

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Monthly frequency overrides</h4>
            <p className="mt-1 text-xs text-slate-500">
              For bound campaigns you can set a manual monthly frequency. When it is set, dashboard
              reach is calculated as impressions / frequency for that campaign-month.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              campaigns: {rows.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              months: {months.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              overrides: {overrides.length}
            </span>
          </div>
        </div>

        {loadingCampaigns ? <p className="mt-3 text-sm text-slate-500">Loading bound campaign names...</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

        {!rows.length ? (
          <p className="mt-3 text-sm text-slate-500">
            Bind campaigns in the previous step to configure monthly frequency overrides.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-3 py-2 text-left">Campaign</th>
                  {months.map((month) => (
                    <th key={month.key} className="px-3 py-2 text-left">
                      {month.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const platformId = resolvePlatformIdFromSourceKey(row.source_key);
                  const meta = PLATFORM_COLORS[platformId];
                  return (
                    <tr key={`${row.source_key}:${row.platform_campaign_id}`} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1 h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: meta?.hex ?? "#94a3b8" }}
                          />
                          <div>
                            <div className="text-sm font-medium text-slate-900">{row.campaign_name}</div>
                            <div className="font-mono text-xs text-slate-500">
                              {row.source_key} / {row.platform_campaign_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      {months.map((month) => {
                        const value = getFrequencyValue(row.source_key, row.platform_campaign_id, month.key);
                        return (
                          <td key={`${row.source_key}:${row.platform_campaign_id}:${month.key}`} className="px-3 py-3">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={value ?? ""}
                              onChange={(event) =>
                                updateOverride(
                                  row.source_key,
                                  row.platform_campaign_id,
                                  month.key,
                                  normalizeFrequency(event.target.value),
                                )
                              }
                              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              placeholder="-"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
