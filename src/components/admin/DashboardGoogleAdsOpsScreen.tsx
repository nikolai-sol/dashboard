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
  };
  summary: SummaryRow[];
  recommendations: RecommendationRow[];
  mutation_log: MutationLogRow[];
  command_output: { stdout: string; stderr: string } | null;
};

type Props = {
  dashboardId: string;
};

const STATUS_OPTIONS = ["pending", "approved", "rejected", "applied", "all"];

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
            disabled={Boolean(busyAction) || !campaignId}
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
            disabled={Boolean(busyAction) || !campaignId}
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
            disabled={Boolean(busyAction) || confirmText !== "APPLY" || !campaignId}
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
                    <div className="text-xs text-slate-500">{row.match_type}</div>
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
                      <span className="text-xs text-slate-400">No action</span>
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
