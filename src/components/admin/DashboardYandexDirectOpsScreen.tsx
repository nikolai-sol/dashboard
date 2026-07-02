"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Play, RefreshCw, Save, Send, X } from "lucide-react";

type CampaignOption = {
  account_id: string;
  client_login: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
};

type CampaignHealthRow = CampaignOption & {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  keywords_total: number;
  keywords_with_clicks: number;
  pending_mutations: number;
  approved_mutations: number;
  last_fact_date: string | null;
  health_status: "critical" | "warning" | "ok";
};

type KeywordRow = {
  criterion_id: string;
  criterion_text: string;
  criterion_type: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  avg_cpc: number | null;
  conversion_rate: number | null;
  first_date: string | null;
  last_date: string | null;
  ad_groups_count: number;
};

type MutationRow = {
  id: number;
  mutation_type: string;
  entity_type: string;
  entity_id: string;
  payload_json: Record<string, unknown>;
  status: string;
  error_message: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  applied_at: string | null;
};

type Settings = {
  dashboard_id: number;
  client_login: string;
  account_id: string;
  campaign_id: string;
  control_enabled: boolean;
  campaign_mutations_enabled: boolean;
  bid_mutations_enabled: boolean;
  apply_enabled: boolean;
  auto_collect_enabled: boolean;
  lookback_days: number;
  max_apply_per_run: number;
  created_at: string | null;
  updated_at: string | null;
};

type Payload = {
  context: {
    dashboard: {
      id: number;
      client_id: string;
      client_name: string;
      dashboard_name: string;
    };
    campaigns: CampaignOption[];
  };
  selected: {
    client_login: string;
    account_id: string;
    campaign_id: string;
    status: string;
    limit: number;
    date_from: string;
    date_to: string;
  };
  campaign_health: CampaignHealthRow[];
  mutation_log: MutationRow[];
  keywords: KeywordRow[];
  keyword_pagination: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
  settings: Settings | null;
  command_output: { stdout: string; stderr: string } | null;
};

type Props = {
  dashboardId: string;
};

const STATUS_OPTIONS = ["planned", "approved", "rejected", "applied", "failed", "all"];
const MUTATION_TYPES = [
  { value: "SUSPEND_CAMPAIGN", label: "Suspend campaign" },
  { value: "RESUME_CAMPAIGN", label: "Resume campaign" },
  { value: "ARCHIVE_CAMPAIGN", label: "Archive campaign" },
  { value: "UNARCHIVE_CAMPAIGN", label: "Unarchive campaign" },
];

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

function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10);
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

function commandText(output: Payload["command_output"]) {
  if (!output) return "";
  return [output.stdout?.trim(), output.stderr?.trim()].filter(Boolean).join("\n");
}

export default function DashboardYandexDirectOpsScreen({ dashboardId }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [clientLogin, setClientLogin] = useState("");
  const [accountId, setAccountId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("planned");
  const [limit, setLimit] = useState(50);
  const [keywordPage, setKeywordPage] = useState(1);
  const [dateFrom, setDateFrom] = useState(() => isoDateOffset(14));
  const [dateTo, setDateTo] = useState(() => isoDateOffset(1));
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [mutationType, setMutationType] = useState("SUSPEND_CAMPAIGN");
  const [criterionId, setCriterionId] = useState("");
  const [bidUnits, setBidUnits] = useState("");
  const [applyLimit, setApplyLimit] = useState(10);
  const [confirmText, setConfirmText] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = useMemo(() => `/api/admin/dashboards/${dashboardId}/yandex-direct`, [dashboardId]);
  const campaigns = payload?.context.campaigns ?? [];
  const selectedCampaign = campaigns.find(
    (campaign) => campaign.campaign_id === campaignId && campaign.client_login === clientLogin,
  ) ?? campaigns.find((campaign) => campaign.campaign_id === campaignId);
  const outputText = commandText(payload?.command_output ?? null);

  async function load(next?: Partial<{
    clientLogin: string;
    campaignId: string;
    status: string;
    limit: number;
    keywordPage: number;
    dateFrom: string;
    dateTo: string;
  }>) {
    setError(null);
    const query = new URLSearchParams();
    const nextClientLogin = next?.clientLogin ?? clientLogin;
    const nextCampaignId = next?.campaignId ?? campaignId;
    const nextStatus = next?.status ?? status;
    const nextLimit = next?.limit ?? limit;
    const nextKeywordPage = next?.keywordPage ?? keywordPage;
    const nextDateFrom = next?.dateFrom ?? dateFrom;
    const nextDateTo = next?.dateTo ?? dateTo;
    if (nextClientLogin) query.set("client_login", nextClientLogin);
    if (nextCampaignId) query.set("campaign_id", nextCampaignId);
    query.set("status", nextStatus);
    query.set("limit", String(nextLimit));
    query.set("keyword_page", String(nextKeywordPage));
    query.set("date_from", nextDateFrom);
    query.set("date_to", nextDateTo);
    const response = await fetch(`${apiUrl}?${query.toString()}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(String(json?.details ?? json?.error ?? "Failed to load Yandex Direct data"));
    }
    const nextPayload = json as Payload;
    setPayload(nextPayload);
    setClientLogin(nextPayload.selected.client_login);
    setAccountId(nextPayload.selected.account_id);
    setCampaignId(nextPayload.selected.campaign_id);
    setStatus(nextPayload.selected.status);
    setLimit(nextPayload.selected.limit);
    setDateFrom(nextPayload.selected.date_from);
    setDateTo(nextPayload.selected.date_to);
    setKeywordPage(nextPayload.keyword_pagination.page);
    setSettingsDraft(nextPayload.settings);
    setApplyLimit(nextPayload.settings?.max_apply_per_run ?? 10);
  }

  useEffect(() => {
    let active = true;
    setBusyAction("load");
    load()
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load Yandex Direct data");
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
          client_login: clientLogin,
          account_id: accountId,
          campaign_id: campaignId,
          status,
          limit,
          keyword_page: keywordPage,
          date_from: dateFrom,
          date_to: dateTo,
          apply_limit: applyLimit,
          ...extra,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.details ?? json?.error ?? "Yandex Direct action failed"));
      }
      const nextPayload = json as Payload;
      setPayload(nextPayload);
      setSettingsDraft(nextPayload.settings);
      setConfirmText("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Yandex Direct action failed");
    } finally {
      setBusyAction(null);
    }
  }

  function selectCampaign(campaign: CampaignOption) {
    setClientLogin(campaign.client_login);
    setAccountId(campaign.account_id);
    setCampaignId(campaign.campaign_id);
    setKeywordPage(1);
    void load({
      clientLogin: campaign.client_login,
      campaignId: campaign.campaign_id,
      keywordPage: 1,
    });
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Yandex Direct Operations</h1>
          <div className="mt-1 text-sm text-slate-600">
            {payload?.context.dashboard.client_name ?? ""} / {payload?.context.dashboard.dashboard_name ?? ""}
          </div>
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

      {outputText ? (
        <pre className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">
          {outputText}
        </pre>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_150px_150px_140px_90px_110px]">
          <label className="text-sm text-slate-700">
            Campaign
            <select
              value={`${clientLogin}|${campaignId}`}
              onChange={(event) => {
                const [nextLogin, nextCampaignId] = event.target.value.split("|");
                const campaign = campaigns.find((item) => item.client_login === nextLogin && item.campaign_id === nextCampaignId)
                  ?? campaigns.find((item) => item.campaign_id === nextCampaignId);
                if (campaign) selectCampaign(campaign);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {campaigns.map((campaign) => (
                <option key={`${campaign.client_login}:${campaign.campaign_id}`} value={`${campaign.client_login}|${campaign.campaign_id}`}>
                  {campaign.campaign_name} / {campaign.campaign_id} / {campaign.client_login || "no login"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Date from
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Date to
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
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
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => load({ keywordPage: 1 })}
              disabled={Boolean(busyAction)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Load
            </button>
          </div>
        </div>
        {selectedCampaign ? (
          <div className="mt-3 text-xs text-slate-500">
            {selectedCampaign.account_id} / {selectedCampaign.campaign_status ?? "unknown"} / {selectedCampaign.objective ?? "unknown"}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft?.control_enabled)}
              onChange={(event) => setSettingsDraft((current) => current ? { ...current, control_enabled: event.target.checked } : current)}
            />
            Control
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft?.campaign_mutations_enabled)}
              onChange={(event) => setSettingsDraft((current) => current ? { ...current, campaign_mutations_enabled: event.target.checked } : current)}
            />
            Campaigns
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft?.bid_mutations_enabled)}
              onChange={(event) => setSettingsDraft((current) => current ? { ...current, bid_mutations_enabled: event.target.checked } : current)}
            />
            Bids
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft?.apply_enabled)}
              onChange={(event) => setSettingsDraft((current) => current ? { ...current, apply_enabled: event.target.checked } : current)}
            />
            Apply
          </label>
          <label className="text-sm text-slate-700">
            Lookback
            <input
              type="number"
              min={1}
              max={90}
              value={settingsDraft?.lookback_days ?? 14}
              onChange={(event) => setSettingsDraft((current) => current ? { ...current, lookback_days: Number(event.target.value) } : current)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Max apply
            <input
              type="number"
              min={1}
              max={100}
              value={settingsDraft?.max_apply_per_run ?? 10}
              onChange={(event) => {
                setSettingsDraft((current) => current ? { ...current, max_apply_per_run: Number(event.target.value) } : current);
                setApplyLimit(Number(event.target.value));
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={Boolean(busyAction) || !settingsDraft}
              onClick={() => postAction("update-settings", settingsDraft ?? {})}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Plan Campaign Mutation</h2>
              <div className="mt-1 text-xs text-slate-500">{campaignId || "-"}</div>
            </div>
            <button
              type="button"
              disabled={Boolean(busyAction) || !campaignId}
              onClick={() => postAction("plan-mutation", { mutation_type: mutationType })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Plan
            </button>
          </div>
          <select
            value={mutationType}
            onChange={(event) => setMutationType(event.target.value)}
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {MUTATION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Plan Keyword Bid</h2>
              <div className="mt-1 text-xs text-slate-500">{clientLogin || "-"}</div>
            </div>
            <button
              type="button"
              disabled={Boolean(busyAction) || !criterionId || !bidUnits}
              onClick={() => postAction("plan-mutation", {
                mutation_type: "SET_KEYWORD_BID",
                entity_id: criterionId,
                payload: { criterion_id: criterionId, bid_units: Number(bidUnits) },
              })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Plan
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px]">
            <input
              value={criterionId}
              onChange={(event) => setCriterionId(event.target.value)}
              placeholder="Criterion ID"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={bidUnits}
              onChange={(event) => setBidUnits(event.target.value)}
              placeholder="Bid"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Apply Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={applyLimit}
              onChange={(event) => setApplyLimit(Number(event.target.value))}
              className="h-10 w-24 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => postAction("apply-dry-run")}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Dry run
            </button>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="APPLY"
              className="h-10 w-28 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <button
              type="button"
              disabled={Boolean(busyAction) || confirmText !== "APPLY"}
              onClick={() => postAction("apply-confirm", { confirm_text: confirmText })}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Apply
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Mutation</th>
                <th className="px-3 py-2">Payload</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.mutation_log ?? []).map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-600">{row.id}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{row.mutation_type}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.entity_type} / {row.entity_id}</div>
                  </td>
                  <td className="max-w-[360px] px-3 py-2 text-xs text-slate-600">
                    {JSON.stringify(row.payload_json)}
                    {row.error_message ? <div className="mt-1 text-rose-600">{row.error_message}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.status}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    <div>created {formatDateTime(row.created_at)}</div>
                    <div>reviewed {formatDateTime(row.reviewed_at)}</div>
                    <div>applied {formatDateTime(row.applied_at)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(busyAction) || !(row.status === "planned" || row.status === "approved")}
                        onClick={() => postAction("approve", { mutation_id: row.id })}
                        className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyAction) || !(row.status === "planned" || row.status === "approved")}
                        onClick={() => postAction("reject", { mutation_id: row.id })}
                        className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.mutation_log.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No mutation rows for the selected filters.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Campaign Health</h2>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => postAction("collect")}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            Collect
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2">Keywords</th>
                <th className="px-3 py-2">Queue</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.campaign_health ?? []).map((row) => (
                <tr key={`${row.client_login}:${row.campaign_id}`} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => selectCampaign(row)}
                      className="text-left font-medium text-slate-900 hover:text-slate-600"
                    >
                      {row.campaign_name}
                    </button>
                    <div className="mt-1 text-xs text-slate-500">{row.campaign_id} / {row.client_login || "no login"}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                        row.health_status === "critical"
                          ? "bg-rose-50 text-rose-700"
                          : row.health_status === "warning"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700",
                      ].join(" ")}
                    >
                      {row.health_status}
                    </span>
                    <div className="mt-2 text-xs text-slate-500">latest {formatDate(row.last_fact_date)}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>cost {formatMoney(row.cost)}</div>
                    <div>impr. {row.impressions} / clicks {row.clicks}</div>
                    <div>conv. {row.conversions} / CTR {formatRate(row.ctr)}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {row.keywords_with_clicks}/{row.keywords_total}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    planned {row.pending_mutations} / approved {row.approved_mutations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.campaign_health.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No Yandex Direct campaigns connected.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Keywords</h2>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <button
              type="button"
              disabled={Boolean(busyAction) || keywordPage <= 1}
              onClick={() => {
                const nextPage = Math.max(keywordPage - 1, 1);
                setKeywordPage(nextPage);
                void load({ keywordPage: nextPage });
              }}
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            >
              Prev
            </button>
            <span>
              {payload?.keyword_pagination.page ?? 1}/{payload?.keyword_pagination.total_pages ?? 1}
            </span>
            <button
              type="button"
              disabled={Boolean(busyAction) || keywordPage >= (payload?.keyword_pagination.total_pages ?? 1)}
              onClick={() => {
                const nextPage = Math.min(keywordPage + 1, payload?.keyword_pagination.total_pages ?? keywordPage + 1);
                setKeywordPage(nextPage);
                void load({ keywordPage: nextPage });
              }}
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Criterion</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Clicks</th>
                <th className="px-3 py-2">Impressions</th>
                <th className="px-3 py-2">Conv.</th>
                <th className="px-3 py-2">Rates</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.keywords ?? []).map((row) => (
                <tr key={`${row.criterion_id}:${row.criterion_text}`} className="border-b border-slate-100 align-top">
                  <td className="max-w-[420px] px-3 py-2">
                    <div className="font-medium text-slate-900">{row.criterion_text || "-"}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.criterion_id} / groups {row.ad_groups_count}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.criterion_type ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.cost)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.clicks}</td>
                  <td className="px-3 py-2 text-slate-700">{row.impressions}</td>
                  <td className="px-3 py-2 text-slate-700">{row.conversions}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    <div>CTR {formatRate(row.ctr)}</div>
                    <div>CPC {row.avg_cpc === null ? "-" : formatMoney(row.avg_cpc)}</div>
                    <div>CR {formatRate(row.conversion_rate)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setCriterionId(row.criterion_id)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Use ID
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.keywords.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No keyword rows for the selected period.</p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
