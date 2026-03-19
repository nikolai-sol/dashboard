"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, DashboardSourceForm, PlatformMeta } from "@/lib/admin-ui-types";

type WizardStep2Props = {
  data: DashboardFormData;
  platforms: PlatformMeta[];
  onChange: (next: DashboardFormData) => void;
};

const TEMPLATE_HEADERS =
  "platform,channel,format,buy_type,units_plan,unit_price,budget_plan,impressions_plan,reach_plan,frequency_plan,views_plan,clicks_plan,conversions_plan,ctr_plan,cpm_plan,cpc_plan,cpv_plan,cpa_plan,январь,февраль,март,апрель,май,июнь,июль,август,сентябрь,октябрь,ноябрь,декабрь";

type AccountItem = {
  id: string;
  name: string;
  latest_report_date: string | null;
  fact_rows: number;
  total_spend: number;
  suggested?: boolean;
};

type MediaPlanAnalysis = {
  status: "ok" | "warn" | "error";
  sheet_url_input: string;
  sheet_url_fetch: string;
  format: string;
  rows_total: number;
  rows_parsed: number;
  channels: number;
  platforms: string[];
  matched_platforms: string[];
  missing_source_platforms: string[];
  actual_without_plan_platforms: string[];
  issues: Array<{
    severity: "error" | "warn" | "info";
    code: string;
    message: string;
    platform?: string;
  }>;
  platform_review: Array<{
    platform: string;
    row_count: number;
    channels: string[];
    status: "matched" | "missing_source";
  }>;
  source_review: Array<{
    platform: string;
    source_key: string;
    selected_account_ids: number;
    active_accounts: number;
    suggested_accounts: number;
    has_plan_rows: boolean;
    status: "matched" | "actual_without_plan" | "inactive_source";
  }>;
  binding_summary: {
    canonical_bound: number;
    plan_only: number;
    unresolved: number;
  };
  row_bindings: Array<{
    row_key: string;
    platform: string;
    channel: string;
    buy_type: string;
    status: "canonical_bound" | "plan_only" | "unresolved";
    bound_campaign_id: string | null;
    bound_campaign_name: string | null;
    match_score: number | null;
    candidates: Array<{
      campaign_id: string;
      campaign_name: string;
      score: number;
    }>;
  }>;
  sample_rows: Array<{
    platform: string;
    channel: string;
    buy_type: string;
    budget_plan: number;
    cpm_plan: number;
    cpc_plan: number;
    cpv_plan: number;
    cpa_plan: number;
  }>;
};

type ResolutionAction = "connect_source" | "plan_only" | "ignore";

type RowOverrideAction = "bind" | "plan_only" | "none";

type RowOverrideState = {
  action: RowOverrideAction;
  campaign_id?: string | null;
  campaign_name?: string | null;
};

type ConfirmResponse = {
  analysis: MediaPlanAnalysis;
  reviewed_source_config: Record<string, unknown>;
  updated_sources: DashboardSourceForm[];
};

function severityClass(severity: "error" | "warn" | "info") {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export default function WizardStep2({ data, platforms, onChange }: WizardStep2Props) {
  const [analysis, setAnalysis] = useState<MediaPlanAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, ResolutionAction>>({});
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Record<string, RowOverrideState>>({});
  const [accountsBySource, setAccountsBySource] = useState<Record<number, AccountItem[]>>({});
  const [accountSearchBySource, setAccountSearchBySource] = useState<Record<number, string>>({});
  const [accountsLoadingBySource, setAccountsLoadingBySource] = useState<Record<number, boolean>>({});
  const [customTablePreview, setCustomTablePreview] = useState<Record<number, { headers: string[]; rows: string[][] } | null>>({});
  const [customTablePreviewLoading, setCustomTablePreviewLoading] = useState<Record<number, boolean>>({});
  const [manualDataPreview, setManualDataPreview] = useState<Record<number, Array<Record<string, unknown>> | null>>({});
  const [manualDataPreviewLoading, setManualDataPreviewLoading] = useState<Record<number, boolean>>({});

  const mysqlPlatforms = useMemo(
    () => platforms.filter((platform) => platform.source === "mysql"),
    [platforms],
  );
  const mediaPlanMeta = useMemo(
    () => platforms.find((platform) => platform.id === "media_plan") ?? null,
    [platforms],
  );

  const actualSources = data.sources.filter(
    (source) => source.role === "actual" && source.platform !== "manual_data",
  );
  const planSource = data.sources.find((source) => source.role === "plan");
  const customTableSources = data.sources.filter((source) => source.role === "custom_table");
  const manualDataSources = data.sources.filter((source) => source.platform === "manual_data");
  const existingReviewResolutions = useMemo(
    () =>
      planSource?.source_config &&
      typeof planSource.source_config.review === "object" &&
      planSource.source_config.review &&
      typeof (planSource.source_config.review as Record<string, unknown>).resolutions === "object"
        ? ((planSource.source_config.review as Record<string, unknown>).resolutions as Record<
            string,
            ResolutionAction
          >)
        : {},
    [planSource],
  );
  const actualSourcePlatformKey = useMemo(
    () => actualSources.map((source) => source.platform).join("|"),
    [actualSources],
  );

  const setSources = (
    nextActual: DashboardSourceForm[],
    nextPlan: DashboardSourceForm | undefined,
    nextCustom: DashboardSourceForm[] = customTableSources,
    nextManual: DashboardSourceForm[] = manualDataSources,
  ) => {
    const parts = [...nextActual, ...(nextPlan ? [nextPlan] : []), ...nextCustom, ...nextManual];
    onChange({ ...data, sources: parts });
  };

  const updateActualSourceConfig = (index: number, patch: Record<string, unknown>) => {
    const source = actualSources[index];
    if (!source) return;
    updateActual(index, {
      source_config: {
        ...(source.source_config ?? {}),
        ...patch,
      },
    });
  };

  const addActualSource = () => {
    const fallback = mysqlPlatforms[0];
    if (!fallback) return;
    setSources(
      [
        ...actualSources,
        {
          platform: fallback.id,
          schema_file: fallback.schema_file,
          role: "actual",
          source_config: null,
          filters: [{ filter_type: "all", filter_value: null }],
        },
      ],
      planSource,
    );
  };

  const updateActual = (index: number, updates: Partial<DashboardSourceForm>) => {
    const next = [...actualSources];
    next[index] = { ...next[index], ...updates };
    setSources(next, planSource);
  };

  const loadAccounts = async (sourceIndex: number, search?: string) => {
    const source = actualSources[sourceIndex];
    if (!source) return;

    setAccountsLoadingBySource((prev) => ({ ...prev, [sourceIndex]: true }));
    try {
      const params = new URLSearchParams({
        platform: source.platform,
        client_name: data.client_name,
      });
      if (search) params.set("search", search);
      if (data.config.period_from) params.set("date_from", data.config.period_from);
      if (data.config.period_to) params.set("date_to", data.config.period_to);
      const response = await fetch(`/api/admin/accounts?${params.toString()}`);
      const json = await response.json();
      const accounts = Array.isArray(json.accounts) ? (json.accounts as AccountItem[]) : [];
      setAccountsBySource((prev) => ({ ...prev, [sourceIndex]: accounts }));

      const selectedIds = parseAccountIds(source.source_config?.account_ids);
      if (!selectedIds.length && accounts.length === 1) {
        updateActualSourceConfig(sourceIndex, { account_ids: [accounts[0].id] });
      }
    } catch {
      setAccountsBySource((prev) => ({ ...prev, [sourceIndex]: [] }));
    } finally {
      setAccountsLoadingBySource((prev) => ({ ...prev, [sourceIndex]: false }));
    }
  };

  useEffect(() => {
    actualSources.forEach((_, idx) => {
      void loadAccounts(idx);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualSourcePlatformKey, data.client_name, data.config.period_from, data.config.period_to]);

  const removeActual = (index: number) => {
    const next = actualSources.filter((_, idx) => idx !== index);
    setSources(next, planSource);
  };

  const togglePlan = (enabled: boolean) => {
    if (!enabled) {
      setSources(actualSources, undefined);
      return;
    }

    const schemaFile = mediaPlanMeta?.schema_file ?? "schemas/media_plan.yaml";
    setSources(actualSources, {
      platform: "media_plan",
      schema_file: schemaFile,
      role: "plan",
      source_config: { sheet_url: "" },
      filters: [{ filter_type: "all", filter_value: null }],
    });
  };

  const updatePlanSheetUrl = (url: string) => {
    if (!planSource) return;
    setAnalysis(null);
    setAnalysisError(null);
    setConfirmError(null);
    setConfirmMessage(null);
    const nextPlan: DashboardSourceForm = {
      ...planSource,
      source_config: {
        ...(planSource.source_config ?? {}),
        sheet_url: url,
      },
    };
    setSources(actualSources, nextPlan);
  };

  const updatePlanUploadFile = async (file: File | null) => {
    if (!planSource) return;
    setAnalysis(null);
    setAnalysisError(null);
    setConfirmError(null);
    setConfirmMessage(null);

    if (!file) {
      const nextPlan: DashboardSourceForm = {
        ...planSource,
        source_config: {
          ...(planSource.source_config ?? {}),
          upload_file: null,
        },
      };
      setSources(actualSources, nextPlan);
      return;
    }

    const contentBase64 = await fileToBase64(file);
    const nextPlan: DashboardSourceForm = {
      ...planSource,
      source_config: {
        ...(planSource.source_config ?? {}),
        upload_file: {
          filename: file.name,
          mime_type: file.type,
          content_base64: contentBase64,
        },
      },
    };
    setSources(actualSources, nextPlan);
  };

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(TEMPLATE_HEADERS);
    } catch {
      // ignore clipboard errors
    }
  };

  const analyzeSheet = async () => {
    const sheetUrl = String(planSource?.source_config?.sheet_url ?? "").trim();
    const hasUpload =
      !!planSource?.source_config &&
      typeof planSource.source_config.upload_file === "object" &&
      planSource.source_config.upload_file;
    const hasInline = !!planSource?.source_config && Array.isArray(planSource.source_config.inline_rows);

    if (!sheetUrl && !hasUpload && !hasInline) {
      setAnalysisError("Sheet URL is empty and no uploaded media plan is attached.");
      return;
    }

    setAnalysisLoading(true);
    setAnalysisError(null);
    setConfirmError(null);
    setConfirmMessage(null);
    try {
      const response = await fetch("/api/admin/media-plan/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard: data,
          row_overrides: Object.fromEntries(
            Object.entries(rowOverrides)
              .filter(([, value]) => value.action !== "none")
              .map(([key, value]) => [
                key,
                value.action === "plan_only"
                  ? { action: "plan_only" }
                  : {
                      action: "bind",
                      campaign_id: value.campaign_id ?? null,
                      campaign_name: value.campaign_name ?? null,
                    },
              ]),
          ),
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? `HTTP ${response.status}`);
      }
      setAnalysis((json.analysis ?? null) as MediaPlanAnalysis | null);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analyze failed");
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    if (!analysis) {
      setResolutions({});
      setRowOverrides({});
      return;
    }

    const next: Record<string, ResolutionAction> = {};
    analysis.missing_source_platforms.forEach((platform) => {
      const saved = existingReviewResolutions[platform];
      next[platform] = saved ?? "plan_only";
    });
    setResolutions(next);
    setRowOverrides((prev) => {
      const nextOverrides: Record<string, RowOverrideState> = {};
      analysis.row_bindings
        .filter((row) => row.status === "unresolved")
        .forEach((row) => {
          nextOverrides[row.row_key] = prev[row.row_key] ?? { action: "none" };
        });
      return nextOverrides;
    });
  }, [analysis, existingReviewResolutions]);

  const confirmReview = async () => {
    if (!analysis) return;
    setConfirmLoading(true);
    setConfirmError(null);
    setConfirmMessage(null);

    try {
      const response = await fetch("/api/admin/media-plan/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard: data,
          resolutions,
          row_overrides: Object.fromEntries(
            Object.entries(rowOverrides)
              .filter(([, value]) => value.action !== "none")
              .map(([key, value]) => [
                key,
                value.action === "plan_only"
                  ? { action: "plan_only" }
                  : {
                      action: "bind",
                      campaign_id: value.campaign_id ?? null,
                      campaign_name: value.campaign_name ?? null,
                    },
              ]),
          ),
        }),
      });
      const json = (await response.json()) as Partial<ConfirmResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? `HTTP ${response.status}`);
      }

      if (!Array.isArray(json.updated_sources)) {
        throw new Error("Confirm endpoint returned no updated sources.");
      }

      onChange({
        ...data,
        sources: json.updated_sources,
      });

      if (json.analysis) {
        setAnalysis(json.analysis as MediaPlanAnalysis);
      }

      const connected = Object.entries(resolutions)
        .filter(([, action]) => action === "connect_source")
        .map(([platform]) => platform);
      const planOnly = Object.entries(resolutions)
        .filter(([, action]) => action === "plan_only")
        .map(([platform]) => platform);

      setConfirmMessage(
        [
          "Media plan review confirmed.",
          connected.length ? `Added actual source drafts: ${connected.join(", ")}.` : "",
          planOnly.length ? `Marked as plan-only: ${planOnly.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "Confirm failed");
    } finally {
      setConfirmLoading(false);
    }
  };

  const addCustomTable = () => {
    setSources(actualSources, planSource, [
      ...customTableSources,
      {
        platform: "custom_table",
        schema_file: "custom_table",
        role: "custom_table",
        source_config: { sheet_url: "", title: "Custom Data" },
        filters: [{ filter_type: "all", filter_value: null }],
      },
    ]);
  };

  const updateCustomTable = (index: number, patch: { title?: string; sheet_url?: string }) => {
    const source = customTableSources[index];
    if (!source) return;
    const next = [...customTableSources];
    next[index] = {
      ...source,
      source_config: {
        ...(source.source_config ?? {}),
        ...patch,
      },
    };
    setSources(actualSources, planSource, next);
    setCustomTablePreview((prev) => ({ ...prev, [index]: null }));
  };

  const removeCustomTable = (index: number) => {
    const next = customTableSources.filter((_, i) => i !== index);
    setSources(actualSources, planSource, next);
    setCustomTablePreview((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  };

  const addManualDataSource = () => {
    setSources(actualSources, planSource, customTableSources, [
      ...manualDataSources,
      {
        platform: "manual_data",
        schema_file: "schemas/manual_data.yaml",
        role: "actual",
        source_config: { sheet_url: "", title: "Additional sources", platform: "", channel: "" },
        filters: [{ filter_type: "all", filter_value: null }],
      },
    ]);
  };

  const updateManualDataSource = (
    index: number,
    patch: { title?: string; sheet_url?: string; platform?: string; channel?: string },
  ) => {
    const source = manualDataSources[index];
    if (!source) return;
    const next = [...manualDataSources];
    next[index] = {
      ...source,
      source_config: { ...(source.source_config ?? {}), ...patch },
    };
    setSources(actualSources, planSource, customTableSources, next);
    setManualDataPreview((prev) => ({ ...prev, [index]: null }));
  };

  const removeManualDataSource = (index: number) => {
    const next = manualDataSources.filter((_, i) => i !== index);
    setSources(actualSources, planSource, customTableSources, next);
    setManualDataPreview((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  };

  const previewManualDataSource = async (index: number) => {
    const source = manualDataSources[index];
    const url = String(source?.source_config?.sheet_url ?? "").trim();
    if (!url) return;
    setManualDataPreviewLoading((prev) => ({ ...prev, [index]: true }));
    setManualDataPreview((prev) => ({ ...prev, [index]: null }));
    try {
      const params = new URLSearchParams({ url });
      const defaultPlatform = String(source?.source_config?.platform ?? "").trim();
      const defaultChannel = String(source?.source_config?.channel ?? "").trim();
      if (defaultPlatform) params.set("platform", defaultPlatform);
      if (defaultChannel) params.set("channel", defaultChannel);
      const response = await fetch(`/api/admin/manual-data/preview?${params.toString()}`);
      const json = await response.json();
      if (response.ok && Array.isArray(json.rows)) {
        setManualDataPreview((prev) => ({ ...prev, [index]: json.rows }));
      } else {
        setManualDataPreview((prev) => ({ ...prev, [index]: [{ error: json.error ?? "Fetch failed" }] }));
      }
    } catch {
      setManualDataPreview((prev) => ({ ...prev, [index]: [{ error: "Network error" }] }));
    } finally {
      setManualDataPreviewLoading((prev) => ({ ...prev, [index]: false }));
    }
  };

  const previewCustomTable = async (index: number) => {
    const source = customTableSources[index];
    const url = String(source?.source_config?.sheet_url ?? "").trim();
    if (!url) return;
    setCustomTablePreviewLoading((prev) => ({ ...prev, [index]: true }));
    setCustomTablePreview((prev) => ({ ...prev, [index]: null }));
    try {
      const response = await fetch(`/api/admin/custom-table/preview?url=${encodeURIComponent(url)}`);
      const json = await response.json();
      if (response.ok && json.headers) {
        setCustomTablePreview((prev) => ({
          ...prev,
          [index]: { headers: json.headers, rows: json.rows ?? [] },
        }));
      } else {
        setCustomTablePreview((prev) => ({
          ...prev,
          [index]: { headers: [], rows: [[json.error ?? "Fetch failed"]] },
        }));
      }
    } catch {
      setCustomTablePreview((prev) => ({
        ...prev,
        [index]: { headers: [], rows: [["Network error"]] },
      }));
    } finally {
      setCustomTablePreviewLoading((prev) => ({ ...prev, [index]: false }));
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Actual Sources</h4>
        <div className="mt-3 space-y-3">
          {actualSources.map((source, index) => (
            <div key={`${source.platform}-${index}`} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Platform</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={source.platform}
                    onChange={(e) => {
                      const selected = mysqlPlatforms.find((platform) => platform.id === e.target.value);
                      updateActual(index, {
                        platform: e.target.value,
                        schema_file: selected?.schema_file ?? source.schema_file,
                        source_config: {
                          ...(source.source_config ?? {}),
                          account_ids: [],
                        },
                      });
                    }}
                  >
                    {mysqlPlatforms.map((platform) => (
                      <option key={platform.id} value={platform.id}>
                        {platform.display_name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => removeActual(index)}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">Client accounts</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const suggested = (accountsBySource[index] ?? [])
                          .filter((account) => account.suggested)
                          .map((account) => account.id);
                        updateActualSourceConfig(index, { account_ids: suggested });
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Use suggested
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateActualSourceConfig(index, {
                          account_ids: (accountsBySource[index] ?? []).map((account) => account.id),
                        })
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Select all active
                    </button>
                    <button
                      type="button"
                      onClick={() => updateActualSourceConfig(index, { account_ids: [] })}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mb-2 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={accountSearchBySource[index] ?? ""}
                    onChange={(e) =>
                      setAccountSearchBySource((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    placeholder="search active accounts"
                  />
                  <button
                    type="button"
                    onClick={() => loadAccounts(index, accountSearchBySource[index] ?? "")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50"
                  >
                    Search
                  </button>
                </div>

                <p className="mb-2 text-xs text-slate-500">
                  Active accounts are taken from canonical facts with recent activity. If nothing is selected, this
                  source uses all active accounts.
                </p>

                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {accountsLoadingBySource[index] ? (
                    <p className="text-xs text-slate-500">Loading accounts...</p>
                  ) : (accountsBySource[index] ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500">No active accounts found for this platform.</p>
                  ) : (
                    (accountsBySource[index] ?? []).map((account) => {
                      const selectedIds = parseAccountIds(source.source_config?.account_ids);
                      const checked = selectedIds.includes(account.id);
                      return (
                        <label key={account.id} className="flex items-start gap-2 py-1 text-xs">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) {
                                next.add(account.id);
                              } else {
                                next.delete(account.id);
                              }
                              updateActualSourceConfig(index, { account_ids: Array.from(next) });
                            }}
                          />
                          <span className="min-w-0">
                            <span className="block text-slate-900">
                              {account.name}
                              {account.suggested ? (
                                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                  suggested
                                </span>
                              ) : null}
                            </span>
                            <span className="block font-mono text-slate-500 text-[11px]">
                              {source.platform?.toLowerCase().includes("yandex") &&
                              account.id.startsWith("campaign::")
                                ? account.id.replace(/^campaign::/, "")
                                : account.id}
                            </span>
                            <span className="block text-slate-400">
                              latest={account.latest_report_date ?? "-"} rows={account.fact_rows}
                              {account.total_spend > 0 ? ` spend=${account.total_spend.toFixed(2)}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addActualSource}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          + Add source
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={Boolean(planSource)}
            onChange={(e) => togglePlan(e.target.checked)}
          />
          Connect media plan source
        </label>

        {planSource ? (
          <div className="mt-3 space-y-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Published Google Sheets URL or CSV URL</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={String(planSource.source_config?.sheet_url ?? "")}
                onChange={(e) => updatePlanSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/.../pub?output=csv"
              />
            </label>

            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Or upload media plan file</p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void updatePlanUploadFile(file);
                  }}
                  className="block text-sm text-slate-600"
                />
                {planSource.source_config?.upload_file &&
                typeof planSource.source_config.upload_file === "object" ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                    uploaded: {String((planSource.source_config.upload_file as Record<string, unknown>).filename ?? "file")}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void updatePlanUploadFile(null)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  Clear upload
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Supported: CSV, XLSX. Uploaded plan is normalized and persisted into dashboard config on confirm.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyTemplate}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Copy CSV template
              </button>
              <button
                type="button"
                onClick={analyzeSheet}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
              >
                {analysisLoading ? "Analyzing..." : "Analyze & review"}
              </button>
            </div>

            {analysisError ? <p className="text-sm text-rose-600">{analysisError}</p> : null}
            {confirmError ? <p className="text-sm text-rose-600">{confirmError}</p> : null}
            {confirmMessage ? <p className="text-sm text-emerald-700">{confirmMessage}</p> : null}

            {analysis ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-1 text-xs font-semibold ${severityClass(
                      analysis.status === "error" ? "error" : analysis.status === "warn" ? "warn" : "info",
                    )}`}
                  >
                    {analysis.status.toUpperCase()}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                    format: {analysis.format}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                    rows: {analysis.rows_parsed}/{analysis.rows_total}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                    channels: {analysis.channels}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                    platforms: {analysis.platforms.length}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Coverage</p>
                    <div className="space-y-2 text-xs text-slate-600">
                      <p>
                        <span className="font-medium text-slate-900">Matched platforms:</span>{" "}
                        {analysis.matched_platforms.length ? analysis.matched_platforms.join(", ") : "none"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Missing actual sources:</span>{" "}
                        {analysis.missing_source_platforms.length
                          ? analysis.missing_source_platforms.join(", ")
                          : "none"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Actual without plan:</span>{" "}
                        {analysis.actual_without_plan_platforms.length
                          ? analysis.actual_without_plan_platforms.join(", ")
                          : "none"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Fetch review</p>
                    <div className="space-y-2 text-xs text-slate-600">
                      <p className="break-all">
                        <span className="font-medium text-slate-900">Input URL:</span> {analysis.sheet_url_input}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-slate-900">Fetch URL:</span> {analysis.sheet_url_fetch}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-sm font-medium text-slate-900">Row-level binding</p>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-700">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1">
                      canonical_bound: {analysis.binding_summary.canonical_bound}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1">
                      unresolved: {analysis.binding_summary.unresolved}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                      plan_only: {analysis.binding_summary.plan_only}
                    </span>
                  </div>
                </div>

                {analysis.issues.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Issues</p>
                    <div className="space-y-2">
                      {analysis.issues.map((issue, idx) => (
                        <div
                          key={`${issue.code}-${idx}`}
                          className={`rounded border px-3 py-2 text-xs ${severityClass(issue.severity)}`}
                        >
                          <span className="font-semibold uppercase">{issue.severity}</span>: {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.row_bindings.some((row) => row.status === "unresolved") ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Unresolved rows</p>
                    <div className="space-y-2 text-xs text-slate-600">
                      {analysis.row_bindings
                        .filter((row) => row.status === "unresolved")
                        .slice(0, 12)
                        .map((row) => (
                          <div key={row.row_key} className="rounded border border-slate-200 px-3 py-2">
                            <p className="font-medium text-slate-900">
                              {row.platform} · {row.channel || "(empty channel)"} · {row.buy_type}
                            </p>
                            <p>
                              best_score={row.match_score ?? 0}
                              {row.candidates.length
                                ? ` · candidates=${row.candidates
                                    .map((candidate) => `${candidate.campaign_name} (${candidate.score})`)
                                    .join("; ")}`
                                : " · no candidates"}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                              <select
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                value={rowOverrides[row.row_key]?.action === "bind" ? rowOverrides[row.row_key]?.campaign_id ?? "" : ""}
                                onChange={(e) => {
                                  const campaignId = e.target.value;
                                  if (!campaignId) {
                                    setRowOverrides((prev) => ({
                                      ...prev,
                                      [row.row_key]: { action: "none" },
                                    }));
                                    return;
                                  }
                                  const candidate = row.candidates.find((item) => item.campaign_id === campaignId);
                                  setRowOverrides((prev) => ({
                                    ...prev,
                                    [row.row_key]: {
                                      action: "bind",
                                      campaign_id: campaignId,
                                      campaign_name: candidate?.campaign_name ?? null,
                                    },
                                  }));
                                }}
                              >
                                <option value="">Leave unresolved</option>
                                {row.candidates.map((candidate) => (
                                  <option key={candidate.campaign_id} value={candidate.campaign_id}>
                                    Bind to {candidate.campaign_name} ({candidate.score})
                                  </option>
                                ))}
                              </select>
                              <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={rowOverrides[row.row_key]?.action === "plan_only"}
                                  onChange={(e) =>
                                    setRowOverrides((prev) => ({
                                      ...prev,
                                      [row.row_key]: e.target.checked
                                        ? { action: "plan_only" }
                                        : { action: "none" },
                                    }))
                                  }
                                />
                                Mark row as plan-only
                              </label>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}

                {analysis.missing_source_platforms.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">Resolve & confirm</p>
                      <button
                        type="button"
                        onClick={confirmReview}
                        disabled={analysis.status === "error" || confirmLoading}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {confirmLoading ? "Applying..." : "Confirm review"}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {analysis.missing_source_platforms.map((platform) => {
                        const canConnect = mysqlPlatforms.some((item) => item.id === platform);
                        const value = resolutions[platform] ?? "plan_only";
                        return (
                          <div key={platform} className="rounded border border-slate-200 px-3 py-2">
                            <p className="mb-2 text-sm font-medium text-slate-900">{platform}</p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="radio"
                                  name={`resolution-${platform}`}
                                  checked={value === "plan_only"}
                                  onChange={() =>
                                    setResolutions((prev) => ({ ...prev, [platform]: "plan_only" }))
                                  }
                                />
                                Mark as plan-only
                              </label>
                              <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                  type="radio"
                                  name={`resolution-${platform}`}
                                  checked={value === "ignore"}
                                  onChange={() =>
                                    setResolutions((prev) => ({ ...prev, [platform]: "ignore" }))
                                  }
                                />
                                Ignore for now
                              </label>
                              <label
                                className={`flex items-center gap-2 text-xs ${
                                  canConnect ? "text-slate-700" : "text-slate-400"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`resolution-${platform}`}
                                  checked={value === "connect_source"}
                                  disabled={!canConnect}
                                  onChange={() =>
                                    setResolutions((prev) => ({ ...prev, [platform]: "connect_source" }))
                                  }
                                />
                                Add actual source draft
                              </label>
                            </div>
                            {!canConnect ? (
                              <p className="mt-2 text-xs text-slate-500">
                                No canonical actual source template is available for automatic attach.
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">Resolve & confirm</p>
                        <p className="text-xs text-slate-500">
                          No missing actual sources were detected. Confirm to persist reviewed media plan metadata.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={confirmReview}
                        disabled={analysis.status === "error" || confirmLoading}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {confirmLoading ? "Applying..." : "Confirm review"}
                      </button>
                    </div>
                  </div>
                )}

                {analysis.platform_review.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Platform review</p>
                    <div className="space-y-2 text-xs text-slate-600">
                      {analysis.platform_review.map((item) => (
                        <div key={item.platform} className="rounded border border-slate-200 px-3 py-2">
                          <p className="font-medium text-slate-900">
                            {item.platform} · {item.status}
                          </p>
                          <p>
                            rows={item.row_count}
                            {item.channels.length ? ` · channels=${item.channels.join(", ")}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.source_review.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium text-slate-900">Actual source review</p>
                    <div className="space-y-2 text-xs text-slate-600">
                      {analysis.source_review.map((item) => (
                        <div key={item.platform} className="rounded border border-slate-200 px-3 py-2">
                          <p className="font-medium text-slate-900">
                            {item.platform} · {item.status}
                          </p>
                          <p>
                            selected_accounts={item.selected_account_ids || 0} · active_accounts={item.active_accounts}
                            {" · "}suggested_accounts={item.suggested_accounts}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.sample_rows.length ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-2 py-1 text-left">Platform</th>
                          <th className="px-2 py-1 text-left">Channel</th>
                          <th className="px-2 py-1 text-left">Buy type</th>
                          <th className="px-2 py-1 text-right">Budget</th>
                          <th className="px-2 py-1 text-right">CPM</th>
                          <th className="px-2 py-1 text-right">CPC</th>
                          <th className="px-2 py-1 text-right">CPV</th>
                          <th className="px-2 py-1 text-right">CPA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.sample_rows.map((row, idx) => (
                          <tr key={`${row.platform}-${row.channel}-${idx}`} className="border-t">
                            <td className="px-2 py-1">{row.platform}</td>
                            <td className="px-2 py-1">{row.channel}</td>
                            <td className="px-2 py-1">{row.buy_type}</td>
                            <td className="px-2 py-1 text-right">{row.budget_plan.toFixed(2)}</td>
                            <td className="px-2 py-1 text-right">{row.cpm_plan.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">{row.cpc_plan.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">{row.cpv_plan.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">{row.cpa_plan.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Дополнительные таблицы</h4>
        <p className="mt-1 text-xs text-slate-500">
          Google Sheets CSV — данные отображаются как есть, без фильтрации и маппинга
        </p>
        <div className="mt-3 space-y-3">
          {customTableSources.map((source, index) => (
            <div key={`custom-${index}`} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Заголовок</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.title ?? "")}
                    onChange={(e) => updateCustomTable(index, { title: e.target.value })}
                    placeholder="Лиды по источникам"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">URL (export?format=csv или pub?output=csv)</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.sheet_url ?? "")}
                    onChange={(e) => updateCustomTable(index, { sheet_url: e.target.value })}
                    placeholder="https://docs.google.com/.../export?format=csv"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => previewCustomTable(index)}
                    disabled={!String(source.source_config?.sheet_url ?? "").trim() || customTablePreviewLoading[index]}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {customTablePreviewLoading[index] ? "..." : "Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCustomTable(index)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    Удалить
                  </button>
                </div>
              </div>
              {customTablePreview[index] ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        {customTablePreview[index]!.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1 text-left text-slate-700">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customTablePreview[index]!.rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-slate-200">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 text-slate-600">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 py-1 text-[10px] text-slate-400">первые 5 строк</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addCustomTable}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          + Добавить таблицу
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-900">Ручные данные (Manual Data Source)</h4>
        <p className="mt-1 text-xs text-slate-500">
          Структурированная таблица с date и метриками. Platform/channel можно брать из колонок файла или задать здесь
          как fallback, чтобы строки попадали в общий platform/channel breakdown дашборда.
        </p>
        <div className="mt-3 space-y-3">
          {manualDataSources.map((source, index) => (
            <div key={`manual-${index}`} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_220px_220px_auto] xl:items-end">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Заголовок</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.title ?? "")}
                    onChange={(e) => updateManualDataSource(index, { title: e.target.value })}
                    placeholder="Дополнительные источники"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Google Sheets CSV URL</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.sheet_url ?? "")}
                    onChange={(e) => updateManualDataSource(index, { sheet_url: e.target.value })}
                    placeholder="https://docs.google.com/.../export?format=csv"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Платформа</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.platform ?? "")}
                    onChange={(e) => updateManualDataSource(index, { platform: e.target.value })}
                    placeholder="linkedin / vk / telegram / brevo"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Channel</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={String(source.source_config?.channel ?? "")}
                    onChange={(e) => updateManualDataSource(index, { channel: e.target.value })}
                    placeholder="Fallback if file has no channel/campaign column"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/manual_data_template.csv"
                    download="manual_data_template.csv"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    📥 Скачать шаблон
                  </a>
                  <button
                    type="button"
                    onClick={() => previewManualDataSource(index)}
                    disabled={
                      !String(source.source_config?.sheet_url ?? "").trim() ||
                      manualDataPreviewLoading[index]
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {manualDataPreviewLoading[index] ? "..." : "🔍 Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeManualDataSource(index)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {manualDataPreview[index] ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        {manualDataPreview[index]!.length > 0 &&
                          Object.keys(manualDataPreview[index]![0] as object).map((h) => (
                            <th key={h} className="px-2 py-1 text-left text-slate-700">
                              {h}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {manualDataPreview[index]!.map((row, ri) => (
                        <tr key={ri} className="border-t border-slate-200">
                          {Object.values(row as Record<string, unknown>).map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 text-slate-600">
                              {String(cell ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 py-1 text-[10px] text-slate-400">первые 5 строк</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addManualDataSource}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          + Добавить ручной источник данных
        </button>
      </div>
    </section>
  );
}
