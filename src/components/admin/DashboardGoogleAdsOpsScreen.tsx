"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CampaignOption = {
  customer_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
};

type RecommendationRow = {
  id: number;
  customer_id: string;
  campaign_id: string;
  search_term: string;
  suggested_negative_keyword: string;
  original_suggested_negative_keyword: string | null;
  match_type: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  reason_code: string | null;
  confidence: number;
  status: string;
  created_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  edited_by: string | null;
  edited_at: string | null;
  applied_at: string | null;
};

type SummaryRow = {
  status: string;
  recommendation_count: number;
  total_cost: number;
  total_clicks: number;
  total_impressions: number;
};

type MutationLogRow = {
  id: number;
  recommendation_id: number | null;
  mutation_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string | null;
  applied_at: string | null;
};

type SearchTermRow = {
  search_term: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  first_date: string | null;
  last_date: string | null;
  ad_groups_count: number;
};

type Payload = {
  context: {
    dashboard: {
      id: number;
      client_id: string;
      client_name: string;
      dashboard_name: string;
    };
    customer_ids: string[];
    campaigns: CampaignOption[];
  };
  selected: {
    customer_id: string;
    campaign_id: string;
    status: string;
    limit: number;
    date_from: string;
    date_to: string;
  };
  summary: SummaryRow[];
  recommendations: RecommendationRow[];
  mutation_log: MutationLogRow[];
  search_terms: SearchTermRow[];
  ai_analysis_by_recommendation: Record<number, {
    id: number;
    recommendation_id: number;
    model: string;
    prompt_version: string;
    intent_classification: string;
    recommended_action: string;
    refined_negative_keyword: string | null;
    match_type: string;
    risk_level: string;
    confidence: string;
    reasoning_short: string | null;
    specialist_note: string | null;
    created_at: string | null;
  }>;
  settings: {
    dashboard_id: number;
    customer_id: string;
    campaign_id: string;
    control_enabled: boolean;
    negative_recommendations_enabled: boolean;
    ai_analysis_enabled: boolean;
    apply_enabled: boolean;
    auto_collect_enabled: boolean;
    lookback_days: number;
    min_cost_threshold: number;
    min_clicks_threshold: number;
    max_apply_per_run: number;
    created_at: string | null;
    updated_at: string | null;
  } | null;
  command_output: { stdout: string; stderr: string } | null;
};

type Props = {
  dashboardId: string;
};

const STATUS_OPTIONS = ["pending", "approved", "rejected", "applied", "all"];
const MATCH_TYPES = ["PHRASE", "EXACT", "BROAD"];

function isoDateOffset(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

export default function DashboardGoogleAdsOpsScreen({ dashboardId }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("pending");
  const [limit, setLimit] = useState(50);
  const [applyLimit, setApplyLimit] = useState(20);
  const [dateFrom, setDateFrom] = useState(() => isoDateOffset(14));
  const [dateTo, setDateTo] = useState(() => isoDateOffset(1));
  const [confirmText, setConfirmText] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Payload["settings"]>(null);
  const [editDrafts, setEditDrafts] = useState<Record<number, { keyword: string; matchType: string; note: string }>>({});

  const apiUrl = useMemo(() => `/api/admin/dashboards/${dashboardId}/google-ads`, [dashboardId]);

  async function load(next?: Partial<{ customerId: string; campaignId: string; status: string; limit: number }>) {
    setError(null);
    const query = new URLSearchParams();
    const nextCustomerId = next?.customerId ?? customerId;
    const nextCampaignId = next?.campaignId ?? campaignId;
    const nextStatus = next?.status ?? status;
    const nextLimit = next?.limit ?? limit;
    if (nextCustomerId) query.set("customer_id", nextCustomerId);
    if (nextCampaignId) query.set("campaign_id", nextCampaignId);
    query.set("status", nextStatus);
    query.set("limit", String(nextLimit));
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    const response = await fetch(`${apiUrl}?${query.toString()}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(String(json?.details ?? json?.error ?? "Failed to load Google Ads data"));
    }
    const nextPayload = json as Payload;
    setPayload(nextPayload);
    setCustomerId(nextPayload.selected.customer_id);
    setCampaignId(nextPayload.selected.campaign_id);
    setStatus(nextPayload.selected.status);
    setLimit(nextPayload.selected.limit);
    setSettingsDraft(nextPayload.settings);
    setEditDrafts((current) => {
      const nextDrafts = { ...current };
      for (const row of nextPayload.recommendations) {
        if (!nextDrafts[row.id]) {
          nextDrafts[row.id] = {
            keyword: row.suggested_negative_keyword,
            matchType: row.match_type || "PHRASE",
            note: "",
          };
        }
      }
      return nextDrafts;
    });
  }

  useEffect(() => {
    let active = true;
    setBusyAction("load");
    load()
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load Google Ads data");
      })
      .finally(() => {
        if (active) setBusyAction(null);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  async function postAction(action: string, extra: Record<string, unknown> = {}) {
    setBusyAction(action);
    setError(null);
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          customer_id: customerId,
          campaign_id: campaignId,
          status,
          limit,
          date_from: dateFrom,
          date_to: dateTo,
          apply_limit: applyLimit,
          ...extra,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.details ?? json?.error ?? "Google Ads action failed"));
      }
      setPayload(json as Payload);
      setConfirmText("");
      setRejectingId(null);
      setRejectNote("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Google Ads action failed");
    } finally {
      setBusyAction(null);
    }
  }

  const campaigns = payload?.context.campaigns ?? [];
  const selectedCampaign = campaigns.find(
    (campaign) => campaign.customer_id === customerId && campaign.campaign_id === campaignId,
  );
  const controlEnabled = Boolean(settingsDraft?.control_enabled);
  const recommendationsEnabled = Boolean(settingsDraft?.negative_recommendations_enabled);
  const applyEnabled = Boolean(settingsDraft?.apply_enabled);
  const aiEnabled = Boolean(settingsDraft?.ai_analysis_enabled);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Google Ads Operations</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Review negative keyword recommendations and run validation/recommendation/apply commands for the connected
            Google Ads campaign. Live mutation is only sent after explicit confirmation.
          </p>
        </div>
        <Link
          href={`/admin/dashboards/${dashboardId}/edit`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to Edit
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_150px_120px]">
          <label className="text-sm text-slate-700">
            Customer
            <select
              value={customerId}
              onChange={(event) => {
                const nextCustomerId = event.target.value;
                const nextCampaign = campaigns.find((campaign) => campaign.customer_id === nextCustomerId);
                setCustomerId(nextCustomerId);
                setCampaignId(nextCampaign?.campaign_id ?? "");
                void load({ customerId: nextCustomerId, campaignId: nextCampaign?.campaign_id ?? "" });
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {(payload?.context.customer_ids ?? []).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Campaign
            <select
              value={campaignId}
              onChange={(event) => {
                setCampaignId(event.target.value);
                void load({ campaignId: event.target.value });
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {campaigns
                .filter((campaign) => campaign.customer_id === customerId)
                .map((campaign) => (
                  <option key={campaign.campaign_id} value={campaign.campaign_id}>
                    {campaign.campaign_name} / {campaign.campaign_id}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                void load({ status: event.target.value });
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Limit
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              onBlur={() => void load({ limit })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        {selectedCampaign ? (
          <p className="mt-3 text-xs text-slate-500">
            {selectedCampaign.campaign_status ?? "unknown"} / {selectedCampaign.objective ?? "unknown"}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {(payload?.summary ?? []).map((row) => (
          <div key={row.status} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase text-slate-500">{row.status}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{row.recommendation_count}</div>
            <div className="mt-2 text-sm text-slate-600">
              cost {formatMoney(row.total_cost)} / clicks {row.total_clicks} / impr. {row.total_impressions}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Control Settings</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["control_enabled", "Control enabled"],
            ["negative_recommendations_enabled", "Recommendations enabled"],
            ["ai_analysis_enabled", "AI analysis enabled"],
            ["apply_enabled", "Live apply enabled"],
            ["auto_collect_enabled", "Auto collect enabled"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean((settingsDraft as Record<string, unknown> | null)?.[key])}
                onChange={(event) =>
                  setSettingsDraft((current) =>
                    current ? { ...current, [key]: event.target.checked } as Payload["settings"] : current,
                  )
                }
              />
              {label}
            </label>
          ))}
          <label className="text-sm text-slate-700">
            Lookback days
            <input
              type="number"
              min={1}
              max={90}
              value={settingsDraft?.lookback_days ?? 14}
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, lookback_days: Number(event.target.value) || 14 } : current,
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Min cost threshold
            <input
              type="number"
              min={0}
              step="0.01"
              value={settingsDraft?.min_cost_threshold ?? 0}
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, min_cost_threshold: Number(event.target.value) || 0 } : current,
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Min clicks threshold
            <input
              type="number"
              min={1}
              value={settingsDraft?.min_clicks_threshold ?? 1}
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, min_clicks_threshold: Number(event.target.value) || 1 } : current,
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Max apply per run
            <input
              type="number"
              min={1}
              max={200}
              value={settingsDraft?.max_apply_per_run ?? 20}
              onChange={(event) =>
                setSettingsDraft((current) =>
                  current ? { ...current, max_apply_per_run: Number(event.target.value) || 20 } : current,
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              postAction("update-settings", {
                control_enabled: settingsDraft?.control_enabled ?? false,
                negative_recommendations_enabled: settingsDraft?.negative_recommendations_enabled ?? false,
                ai_analysis_enabled: settingsDraft?.ai_analysis_enabled ?? false,
                apply_enabled: settingsDraft?.apply_enabled ?? false,
                auto_collect_enabled: settingsDraft?.auto_collect_enabled ?? true,
                lookback_days: settingsDraft?.lookback_days ?? 14,
                min_cost_threshold: settingsDraft?.min_cost_threshold ?? 0,
                min_clicks_threshold: settingsDraft?.min_clicks_threshold ?? 1,
                max_apply_per_run: settingsDraft?.max_apply_per_run ?? 20,
              })
            }
            disabled={Boolean(busyAction) || !campaignId}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save settings
          </button>
          <span className="text-xs text-slate-500">
            Updated: {formatDateTime(settingsDraft?.updated_at ?? null)}
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => postAction("validate")}
            disabled={Boolean(busyAction) || !campaignId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Validate totals
          </button>
          <button
            type="button"
            onClick={() => postAction("recommend")}
            disabled={Boolean(busyAction) || !campaignId || !controlEnabled || !recommendationsEnabled}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Generate recommendations
          </button>
          <button
            type="button"
            onClick={() => load()}
            disabled={Boolean(busyAction)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Apply Approved Negatives</h2>
            <p className="mt-1 text-sm text-slate-600">
              Dry-run logs planned actions. Live apply processes only approved rows and skips existing duplicates.
            </p>
          </div>
          <label className="text-sm text-slate-700">
            Apply limit
            <input
              type="number"
              min={1}
              max={200}
              value={applyLimit}
              onChange={(event) => setApplyLimit(Number(event.target.value))}
              className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => postAction("apply-dry-run")}
            disabled={Boolean(busyAction) || !campaignId || !controlEnabled}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Dry-run apply
          </button>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="type APPLY"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => postAction("apply-confirm", { confirm_text: confirmText })}
            disabled={Boolean(busyAction) || confirmText !== "APPLY" || !campaignId || !controlEnabled || !applyEnabled}
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
          >
            Confirm live apply
          </button>
        </div>
      </section>

      {payload?.command_output ? (
        <section className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-sm text-slate-100">
          <h2 className="font-semibold">Command output</h2>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">
            {payload.command_output.stdout}
            {payload.command_output.stderr ? `\nSTDERR:\n${payload.command_output.stderr}` : ""}
          </pre>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Recommendations</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Search term</th>
                <th className="px-3 py-2">Negative</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Clicks</th>
                <th className="px-3 py-2">Impr.</th>
                <th className="px-3 py-2">Conv.</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.recommendations ?? []).map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-500">{row.id}</td>
                  <td className="max-w-[260px] px-3 py-2 text-slate-800">{row.search_term}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{row.suggested_negative_keyword}</div>
                    {row.original_suggested_negative_keyword
                    && row.original_suggested_negative_keyword !== row.suggested_negative_keyword ? (
                      <div className="text-xs text-slate-500">orig: {row.original_suggested_negative_keyword}</div>
                    ) : null}
                    <div className="text-xs text-slate-500">{row.match_type}</div>
                    {row.edited_at ? (
                      <div className="text-xs text-slate-400">
                        edited {formatDateTime(row.edited_at)} by {row.edited_by ?? "admin"}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.cost)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.clicks}</td>
                  <td className="px-3 py-2 text-slate-700">{row.impressions}</td>
                  <td className="px-3 py-2 text-slate-700">{row.conversions}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-700">{row.reason_code}</div>
                    <div className="text-xs text-slate-500">conf. {row.confidence}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{row.status}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "pending" || row.status === "approved" ? (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => postAction("analyze-recommendation-ai", { recommendation_id: row.id })}
                          disabled={Boolean(busyAction) || !controlEnabled || !aiEnabled}
                          className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          Analyze with AI
                        </button>
                        <div className="space-y-2 rounded border border-slate-200 p-2">
                          <input
                            value={editDrafts[row.id]?.keyword ?? row.suggested_negative_keyword}
                            onChange={(event) =>
                              setEditDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  keyword: event.target.value,
                                  matchType: current[row.id]?.matchType ?? row.match_type,
                                  note: current[row.id]?.note ?? "",
                                },
                              }))
                            }
                            disabled={Boolean(busyAction) || !controlEnabled}
                            className="w-52 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
                            placeholder="Negative keyword"
                          />
                          <select
                            value={editDrafts[row.id]?.matchType ?? row.match_type}
                            onChange={(event) =>
                              setEditDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  keyword: current[row.id]?.keyword ?? row.suggested_negative_keyword,
                                  matchType: event.target.value,
                                  note: current[row.id]?.note ?? "",
                                },
                              }))
                            }
                            disabled={Boolean(busyAction) || !controlEnabled}
                            className="w-32 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
                          >
                            {MATCH_TYPES.map((matchType) => (
                              <option key={matchType} value={matchType}>
                                {matchType}
                              </option>
                            ))}
                          </select>
                          <input
                            value={editDrafts[row.id]?.note ?? ""}
                            onChange={(event) =>
                              setEditDrafts((current) => ({
                                ...current,
                                [row.id]: {
                                  keyword: current[row.id]?.keyword ?? row.suggested_negative_keyword,
                                  matchType: current[row.id]?.matchType ?? row.match_type,
                                  note: event.target.value,
                                },
                              }))
                            }
                            disabled={Boolean(busyAction) || !controlEnabled}
                            className="w-52 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
                            placeholder="Optional note"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              postAction("update-recommendation", {
                                recommendation_id: row.id,
                                suggested_negative_keyword: editDrafts[row.id]?.keyword ?? row.suggested_negative_keyword,
                                match_type: editDrafts[row.id]?.matchType ?? row.match_type,
                                review_note: editDrafts[row.id]?.note ?? "",
                              })
                            }
                            disabled={Boolean(busyAction) || !controlEnabled}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Save edit
                          </button>
                          {payload?.ai_analysis_by_recommendation?.[row.id]?.refined_negative_keyword ? (
                            <button
                              type="button"
                              onClick={() =>
                                postAction("update-recommendation", {
                                  recommendation_id: row.id,
                                  suggested_negative_keyword:
                                    payload.ai_analysis_by_recommendation[row.id].refined_negative_keyword,
                                  match_type: payload.ai_analysis_by_recommendation[row.id].match_type || "PHRASE",
                                  review_note:
                                    payload.ai_analysis_by_recommendation[row.id].specialist_note
                                    || editDrafts[row.id]?.note
                                    || "",
                                })
                              }
                              disabled={Boolean(busyAction) || !controlEnabled}
                              className="rounded border border-violet-200 px-2 py-1 text-xs text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                            >
                              Use AI suggestion
                            </button>
                          ) : null}
                        </div>
                        {payload?.ai_analysis_by_recommendation?.[row.id] ? (
                          <div className="rounded border border-indigo-100 bg-indigo-50/40 p-2 text-xs text-slate-700">
                            <div>intent: {payload.ai_analysis_by_recommendation[row.id].intent_classification}</div>
                            <div>action: {payload.ai_analysis_by_recommendation[row.id].recommended_action}</div>
                            <div>
                              keyword: {payload.ai_analysis_by_recommendation[row.id].refined_negative_keyword ?? "-"}
                            </div>
                            <div>match: {payload.ai_analysis_by_recommendation[row.id].match_type}</div>
                            <div>risk: {payload.ai_analysis_by_recommendation[row.id].risk_level}</div>
                            <div>confidence: {payload.ai_analysis_by_recommendation[row.id].confidence}</div>
                            <div>reason: {payload.ai_analysis_by_recommendation[row.id].reasoning_short ?? "-"}</div>
                            <div>note: {payload.ai_analysis_by_recommendation[row.id].specialist_note ?? "-"}</div>
                          </div>
                        ) : null}
                        {row.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => postAction("approve", { recommendation_id: row.id })}
                            disabled={Boolean(busyAction)}
                            className="rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        ) : null}
                        {rejectingId === row.id ? (
                          <div className="space-y-2">
                            <input
                              value={rejectNote}
                              onChange={(event) => setRejectNote(event.target.value)}
                              placeholder="Reject note"
                              className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => postAction("reject", { recommendation_id: row.id, note: rejectNote })}
                              disabled={Boolean(busyAction)}
                              className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              Save reject
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRejectingId(row.id)}
                            disabled={Boolean(busyAction)}
                            className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {row.status === "applied" ? "Applied (editing disabled)" : "No action"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.recommendations.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No recommendations for the selected filters.</p>
          ) : null}
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-lg font-semibold text-slate-900">
          All Search Terms ({payload?.search_terms.length ?? 0})
        </summary>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Search term</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Clicks</th>
                <th className="px-3 py-2">Impr.</th>
                <th className="px-3 py-2">Conv.</th>
                <th className="px-3 py-2">Conv. value</th>
                <th className="px-3 py-2">Ad groups</th>
                <th className="px-3 py-2">Dates</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.search_terms ?? []).map((row) => (
                <tr key={`${row.search_term}-${row.first_date}-${row.last_date}`} className="border-b border-slate-100">
                  <td className="max-w-[420px] px-3 py-2 text-slate-800">{row.search_term}</td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.cost)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.clicks}</td>
                  <td className="px-3 py-2 text-slate-700">{row.impressions}</td>
                  <td className="px-3 py-2 text-slate-700">{row.conversions}</td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.conversion_value)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.ad_groups_count}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.first_date ?? "-"} / {row.last_date ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.search_terms.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No search term rows for the selected date range.</p>
          ) : null}
        </div>
      </details>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Mutation Log</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Rec.</th>
                <th className="px-3 py-2">Mutation</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.mutation_log ?? []).map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2 text-slate-600">{row.recommendation_id ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{row.mutation_type}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{row.status}</td>
                  <td className="px-3 py-2 text-slate-600">{row.entity_id ?? row.entity_type ?? "-"}</td>
                  <td className="max-w-[360px] px-3 py-2 text-rose-700">{row.error_message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.mutation_log.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No mutation log rows yet.</p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
