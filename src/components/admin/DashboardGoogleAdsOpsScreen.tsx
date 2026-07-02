"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

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

type KeywordRow = {
  keyword_text: string;
  match_type: string | null;
  keyword_status: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  first_date: string | null;
  last_date: string | null;
  ad_groups_count: number;
};

type CampaignHealthRow = {
  customer_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  products_total: number;
  products_with_impressions: number;
  pending_recommendations: number;
  last_fact_date: string | null;
  health_score: number;
  health_status: "critical" | "warning" | "ok";
  checks: Array<{
    severity: "critical" | "warning" | "info" | "ok";
    title: string;
    detail: string;
    recommendation: string;
  }>;
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
    health_filter: "active" | "all" | "campaign";
    health_campaign_id: string;
  };
  campaign_health: CampaignHealthRow[];
  summary: SummaryRow[];
  recommendations: RecommendationRow[];
  mutation_log: MutationLogRow[];
  keywords: KeywordRow[];
  keyword_pagination: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
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
const SEARCH_TERM_EXPORT_HEADERS = [
  "Search term",
  "Cost",
  "Clicks",
  "Impressions",
  "Conversions",
  "Conversion value",
  "Ad groups",
  "First date",
  "Last date",
];

function isoDateOffset(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function isoDateTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateStartOfWeekMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const delta = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - delta);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

function csvCell(value: string | number | null): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  const [keywordPage, setKeywordPage] = useState(1);
  const [healthFilter, setHealthFilter] = useState<"active" | "all" | "campaign">("active");
  const [healthCampaignId, setHealthCampaignId] = useState("");
  const [searchTermExportFormat, setSearchTermExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const [searchTermsSort, setSearchTermsSort] = useState<"last_date_desc" | "last_date_asc" | "first_date_desc" | "first_date_asc">("last_date_desc");
  const [searchTermsCopied, setSearchTermsCopied] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Payload["settings"]>(null);
  const [editDrafts, setEditDrafts] = useState<Record<number, { keyword: string; matchType: string; note: string }>>({});

  const apiUrl = useMemo(() => `/api/admin/dashboards/${dashboardId}/google-ads`, [dashboardId]);

  async function load(next?: Partial<{
    customerId: string;
    campaignId: string;
    status: string;
    limit: number;
    keywordPage: number;
    healthFilter: "active" | "all" | "campaign";
    healthCampaignId: string;
    dateFrom: string;
    dateTo: string;
  }>) {
    setError(null);
    const query = new URLSearchParams();
    const nextCustomerId = next?.customerId ?? customerId;
    const nextCampaignId = next?.campaignId ?? campaignId;
    const nextStatus = next?.status ?? status;
    const nextLimit = next?.limit ?? limit;
    const nextKeywordPage = next?.keywordPage ?? keywordPage;
    const nextHealthFilter = next?.healthFilter ?? healthFilter;
    const nextHealthCampaignId = next?.healthCampaignId ?? healthCampaignId;
    const nextDateFrom = next?.dateFrom ?? dateFrom;
    const nextDateTo = next?.dateTo ?? dateTo;
    if (nextCustomerId) query.set("customer_id", nextCustomerId);
    if (nextCampaignId) query.set("campaign_id", nextCampaignId);
    query.set("status", nextStatus);
    query.set("limit", String(nextLimit));
    query.set("keyword_page", String(nextKeywordPage));
    query.set("health_filter", nextHealthFilter);
    if (nextHealthCampaignId) query.set("health_campaign_id", nextHealthCampaignId);
    if (nextDateFrom) query.set("date_from", nextDateFrom);
    if (nextDateTo) query.set("date_to", nextDateTo);
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
    setKeywordPage(nextPayload.keyword_pagination.page);
    setHealthFilter(nextPayload.selected.health_filter ?? "active");
    setHealthCampaignId(nextPayload.selected.health_campaign_id ?? "");
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
          keyword_page: keywordPage,
          health_filter: healthFilter,
          health_campaign_id: healthCampaignId,
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
  const sortedSearchTerms = useMemo(() => {
    const rows = [...(payload?.search_terms ?? [])];
    const dateValue = (value: string | null) => {
      if (!value) return 0;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    rows.sort((a, b) => {
      if (searchTermsSort === "last_date_asc") return dateValue(a.last_date) - dateValue(b.last_date);
      if (searchTermsSort === "first_date_desc") return dateValue(b.first_date) - dateValue(a.first_date);
      if (searchTermsSort === "first_date_asc") return dateValue(a.first_date) - dateValue(b.first_date);
      return dateValue(b.last_date) - dateValue(a.last_date);
    });
    return rows;
  }, [payload?.search_terms, searchTermsSort]);

  const searchTermExportRows = useMemo(
    () => sortedSearchTerms.map((row) => ({
      [SEARCH_TERM_EXPORT_HEADERS[0]]: row.search_term,
      [SEARCH_TERM_EXPORT_HEADERS[1]]: row.cost,
      [SEARCH_TERM_EXPORT_HEADERS[2]]: row.clicks,
      [SEARCH_TERM_EXPORT_HEADERS[3]]: row.impressions,
      [SEARCH_TERM_EXPORT_HEADERS[4]]: row.conversions,
      [SEARCH_TERM_EXPORT_HEADERS[5]]: row.conversion_value,
      [SEARCH_TERM_EXPORT_HEADERS[6]]: row.ad_groups_count,
      [SEARCH_TERM_EXPORT_HEADERS[7]]: row.first_date ?? "",
      [SEARCH_TERM_EXPORT_HEADERS[8]]: row.last_date ?? "",
    })),
    [sortedSearchTerms],
  );

  async function copySearchTermsForAnalysis() {
    const terms = sortedSearchTerms
      .map((row) => row.search_term.trim())
      .filter(Boolean)
      .join("\n");
    if (!terms) return;
    await navigator.clipboard.writeText(terms);
    setSearchTermsCopied(true);
    window.setTimeout(() => setSearchTermsCopied(false), 1600);
  }

  function exportSearchTerms() {
    if (!searchTermExportRows.length) return;
    const safeCampaign = (selectedCampaign?.campaign_name || campaignId || "campaign")
      .replace(/[^a-z0-9а-яё_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    const dateSuffix = `${dateFrom || "from"}_${dateTo || "to"}`;
    if (searchTermExportFormat === "csv") {
      const lines = [
        SEARCH_TERM_EXPORT_HEADERS.map(csvCell).join(","),
        ...searchTermExportRows.map((row) =>
          SEARCH_TERM_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(","),
        ),
      ];
      downloadBlob(
        new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
        `google_ads_search_terms_${safeCampaign}_${dateSuffix}.csv`,
      );
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(searchTermExportRows, { header: SEARCH_TERM_EXPORT_HEADERS });
    worksheet["!cols"] = [
      { wch: 48 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Search terms");
    XLSX.writeFile(workbook, `google_ads_search_terms_${safeCampaign}_${dateSuffix}.xlsx`);
  }

  async function applySearchTermDatePreset(preset: "yesterday" | "this_week" | "since_campaign_start") {
    const yesterday = isoDateOffset(1);
    if (preset === "yesterday") {
      setDateFrom(yesterday);
      setDateTo(yesterday);
      setKeywordPage(1);
      await load({ keywordPage: 1, dateFrom: yesterday, dateTo: yesterday });
      return;
    }
    if (preset === "this_week") {
      const weekStart = isoDateStartOfWeekMonday();
      setDateTo(yesterday);
      setDateFrom(weekStart);
      setKeywordPage(1);
      await load({ keywordPage: 1, dateFrom: weekStart, dateTo: yesterday });
      return;
    }
    const campaignStart =
      sortedSearchTerms
        .map((row) => row.first_date)
        .filter((value): value is string => Boolean(value))
        .sort()[0]
      || isoDateStartOfWeekMonday();
    const dateToValue = isoDateTodayUtc();
    setDateFrom(campaignStart);
    setDateTo(dateToValue);
    setKeywordPage(1);
    await load({ keywordPage: 1, dateFrom: campaignStart, dateTo: dateToValue });
  }

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
        <div className="grid gap-3 md:grid-cols-[180px_180px_1fr_150px_120px]">
          <label className="text-sm text-slate-700">
            Customer
            <select
              value={customerId}
              onChange={(event) => {
                const nextCustomerId = event.target.value;
                const nextCampaign = campaigns.find((campaign) => campaign.customer_id === nextCustomerId);
                setCustomerId(nextCustomerId);
                setCampaignId(nextCampaign?.campaign_id ?? "");
                setKeywordPage(1);
                setHealthCampaignId(nextCampaign?.campaign_id ?? "");
                void load({
                  customerId: nextCustomerId,
                  campaignId: nextCampaign?.campaign_id ?? "",
                  keywordPage: 1,
                  healthCampaignId: nextCampaign?.campaign_id ?? "",
                });
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
            Health filter
            <select
              value={healthFilter}
              onChange={(event) => {
                const nextFilter = (event.target.value === "all" || event.target.value === "campaign")
                  ? event.target.value
                  : "active";
                setHealthFilter(nextFilter);
                const fallbackCampaignId =
                  healthCampaignId
                  || campaigns.find((campaign) => campaign.customer_id === customerId)?.campaign_id
                  || "";
                if (nextFilter === "campaign") {
                  setHealthCampaignId(fallbackCampaignId);
                  void load({
                    healthFilter: nextFilter,
                    healthCampaignId: fallbackCampaignId,
                    keywordPage: 1,
                  });
                  return;
                }
                void load({ healthFilter: nextFilter, keywordPage: 1 });
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="active">Active</option>
              <option value="all">All</option>
              <option value="campaign">Individual campaign</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Campaign
            <select
              value={campaignId}
              onChange={(event) => {
                setCampaignId(event.target.value);
                setKeywordPage(1);
                void load({ campaignId: event.target.value, keywordPage: 1 });
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
          {healthFilter === "campaign" ? (
            <label className="text-sm text-slate-700">
              Campaign for health
              <select
                value={healthCampaignId}
                onChange={(event) => {
                  const nextHealthCampaignId = event.target.value;
                  setHealthCampaignId(nextHealthCampaignId);
                  void load({ healthFilter: "campaign", healthCampaignId: nextHealthCampaignId, keywordPage: 1 });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {(campaigns.filter((campaign) => campaign.customer_id === customerId)).map((campaign) => (
                  <option key={campaign.campaign_id} value={campaign.campaign_id}>
                    {campaign.campaign_name} / {campaign.campaign_id} / {campaign.campaign_status ?? "unknown"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Campaign Health</h2>
            <p className="mt-1 text-sm text-slate-600">
              Account-level checks for serving status, delivery, Shopping product coverage, conversions, CTR, pending
              negatives, and data freshness in the selected period.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load({ keywordPage: 1 })}
            disabled={Boolean(busyAction)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh health
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">Recommendations</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.campaign_health ?? []).map((row) => (
                <tr key={`${row.customer_id}:${row.campaign_id}`} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{row.campaign_name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.customer_id} / {row.campaign_id}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.campaign_status ?? "unknown"} / {row.objective ?? "unknown"}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                        row.health_status === "critical"
                          ? "bg-rose-50 text-rose-700"
                          : row.health_status === "warning"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700",
                      ].join(" ")}
                    >
                      {row.health_status} / {row.health_score}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">latest data {row.last_fact_date ?? "-"}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>cost {formatMoney(row.cost)}</div>
                    <div>impr. {row.impressions} / clicks {row.clicks}</div>
                    <div>conv. {row.conversions} / CTR {formatPercent(row.ctr)}</div>
                    <div>CPC {row.cpc === null ? "-" : formatMoney(row.cpc)} / CPA {row.cpa === null ? "-" : formatMoney(row.cpa)}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {row.products_total ? `${row.products_with_impressions}/${row.products_total} with impressions` : "-"}
                  </td>
                  <td className="max-w-[520px] px-3 py-3">
                    <div className="space-y-2">
                      {row.checks.map((check) => (
                        <div key={`${row.campaign_id}:${check.title}`} className="rounded border border-slate-200 p-2">
                          <div className="text-xs font-semibold uppercase text-slate-500">{check.severity}</div>
                          <div className="mt-1 font-medium text-slate-900">{check.title}</div>
                          <div className="mt-1 text-xs text-slate-600">{check.detail}</div>
                          <div className="mt-1 text-xs text-slate-800">{check.recommendation}</div>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.campaign_health.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No Google Ads campaigns available for health checks.</p>
          ) : null}
        </div>
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

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Current Keywords</h2>
            <p className="mt-1 text-sm text-slate-600">
              Filtered by the selected period. Showing up to 15 keywords per page.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <button
              type="button"
              onClick={() => {
                const nextPage = Math.max((payload?.keyword_pagination.page ?? keywordPage) - 1, 1);
                setKeywordPage(nextPage);
                void load({ keywordPage: nextPage });
              }}
              disabled={Boolean(busyAction) || (payload?.keyword_pagination.page ?? 1) <= 1}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {payload?.keyword_pagination.page ?? 1} of {payload?.keyword_pagination.total_pages ?? 1}
              {" "}({payload?.keyword_pagination.total ?? 0})
            </span>
            <button
              type="button"
              onClick={() => {
                const currentPage = payload?.keyword_pagination.page ?? keywordPage;
                const maxPage = payload?.keyword_pagination.total_pages ?? currentPage;
                const nextPage = Math.min(currentPage + 1, maxPage);
                setKeywordPage(nextPage);
                void load({ keywordPage: nextPage });
              }}
              disabled={
                Boolean(busyAction)
                || (payload?.keyword_pagination.page ?? 1) >= (payload?.keyword_pagination.total_pages ?? 1)
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Keyword</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Clicks</th>
                <th className="px-3 py-2">Impr.</th>
                <th className="px-3 py-2">CTR</th>
                <th className="px-3 py-2">Conv.</th>
                <th className="px-3 py-2">Conv. value</th>
                <th className="px-3 py-2">Dates</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.keywords ?? []).map((row) => (
                <tr
                  key={`${row.keyword_text}-${row.match_type}-${row.keyword_status}-${row.first_date}-${row.last_date}`}
                  className="border-b border-slate-100"
                >
                  <td className="max-w-[360px] px-3 py-2 text-slate-800">{row.keyword_text}</td>
                  <td className="px-3 py-2 text-slate-700">{row.match_type ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{row.keyword_status ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.cost)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.clicks}</td>
                  <td className="px-3 py-2 text-slate-700">{row.impressions}</td>
                  <td className="px-3 py-2 text-slate-700">{formatPercent(row.impressions ? row.clicks / row.impressions : null)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.conversions}</td>
                  <td className="px-3 py-2 text-slate-700">{formatMoney(row.conversion_value)}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.first_date ?? "-"} / {row.last_date ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payload && payload.keywords.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">
              No keyword rows for the selected campaign and date range. Shopping-only campaigns may have search terms
              but no keyword criteria.
            </p>
          ) : null}
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              All Search Terms ({payload?.search_terms.length ?? 0})
            </h2>
            <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <select
                value={searchTermsSort}
                onChange={(event) =>
                  setSearchTermsSort(
                    event.target.value === "last_date_asc"
                      ? "last_date_asc"
                      : event.target.value === "first_date_desc"
                        ? "first_date_desc"
                        : event.target.value === "first_date_asc"
                          ? "first_date_asc"
                          : "last_date_desc",
                  )
                }
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-700"
                title="Sort search terms by date"
              >
                <option value="last_date_desc">Last date (newest)</option>
                <option value="last_date_asc">Last date (oldest)</option>
                <option value="first_date_desc">First date (newest)</option>
                <option value="first_date_asc">First date (oldest)</option>
              </select>
              <button
                type="button"
                onClick={() => void applySearchTermDatePreset("yesterday")}
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={Boolean(busyAction)}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => void applySearchTermDatePreset("this_week")}
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={Boolean(busyAction)}
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => void applySearchTermDatePreset("since_campaign_start")}
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={Boolean(busyAction)}
              >
                Since Campaign Start
              </button>
              <button
                type="button"
                onClick={copySearchTermsForAnalysis}
                disabled={!payload?.search_terms.length}
                title="Copy all search terms"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {searchTermsCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="h-4 w-4" />}
              </button>
              <label className="sr-only" htmlFor="search-term-export-format">
                Export format
              </label>
              <select
                id="search-term-export-format"
                value={searchTermExportFormat}
                onChange={(event) => setSearchTermExportFormat(event.target.value === "csv" ? "csv" : "xlsx")}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-700"
              >
                <option value="xlsx">Excel</option>
                <option value="csv">CSV</option>
              </select>
              <button
                type="button"
                onClick={exportSearchTerms}
                disabled={!payload?.search_terms.length}
                title="Export search terms"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {searchTermExportFormat === "xlsx" ? <FileSpreadsheet className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              </button>
            </div>
          </div>
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
              {sortedSearchTerms.map((row) => (
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
