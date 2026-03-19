"use client";

import { useEffect, useState } from "react";
import type { DashboardFormData } from "@/lib/admin-ui-types";

type DashboardPreviewProps = {
  data: DashboardFormData;
};

type PreviewResponse = {
  summary?: {
    actual: Array<{
      platform: string;
      campaigns: number;
      status: "ok" | "empty" | "error";
      message?: string;
    }>;
    plan: {
      status: "connected" | "missing_url" | "error" | "not_configured";
      rows: number;
      channels: number;
      platforms: number;
      message?: string;
    };
    totals: {
      actual_sources: number;
      actual_campaigns: number;
    };
  };
};

export default function DashboardPreview({ data }: DashboardPreviewProps) {
  const [preview, setPreview] = useState<PreviewResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actualSources = data.sources.filter((source) => source.role === "actual");
  const planSource = data.sources.find((source) => source.role === "plan");
  const sheetUrl = String(planSource?.source_config?.sheet_url ?? "");
  const planReview =
    planSource?.source_config &&
    typeof planSource.source_config.review === "object" &&
    planSource.source_config.review
      ? (planSource.source_config.review as Record<string, unknown>)
      : null;

  useEffect(() => {
    let cancelled = false;
    const hasMinimum =
      Boolean(data.client_id && data.client_name && data.dashboard_name) && actualSources.length > 0;
    if (!hasMinimum) {
      setPreview(null);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/dashboard/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = (await response.json()) as PreviewResponse;
        if (!response.ok) {
          throw new Error((json as { error?: string }).error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setPreview(json.summary ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof Error ? err.message : "Failed to load preview");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [actualSources.length, data, sheetUrl]);

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="text-sm font-semibold text-slate-900">Preview</h4>
      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p>
          <span className="font-medium text-slate-900">Client:</span> {data.client_name} ({data.client_id})
        </p>
        <p>
          <span className="font-medium text-slate-900">Type:</span> {data.dashboard_type}
        </p>
        <p>
          <span className="font-medium text-slate-900">Period:</span> {data.config.period_from} - {data.config.period_to}
        </p>
        <p>
          <span className="font-medium text-slate-900">Currency:</span> {data.config.currency}
        </p>
        <p>
          <span className="font-medium text-slate-900">Actual sources:</span> {actualSources.length}
        </p>
        <p>
          <span className="font-medium text-slate-900">Plan source:</span> {planSource ? "Connected" : "Not connected"}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p className="mb-1 font-medium text-slate-900">Sources</p>
        <ul className="space-y-1">
          {data.sources.map((source, idx) => (
            <li key={`${source.platform}-${idx}`}>
              {source.role.toUpperCase()} - {source.platform} ({source.schema_file})
              {source.role === "actual" ? (
                <span>
                  {" "}
                  - accounts:{" "}
                  {Array.isArray(source.source_config?.account_ids) &&
                  source.source_config?.account_ids.length
                    ? source.source_config.account_ids.length
                    : "all active"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {planSource ? (
          <p className="mt-2 truncate">
            <span className="font-medium text-slate-900">Sheet URL:</span> {sheetUrl || "(empty)"}
          </p>
        ) : null}
        {planReview ? (
          <p className="mt-2">
            <span className="font-medium text-slate-900">Media plan review:</span>{" "}
            {String(planReview.status ?? "confirmed")}
            {planReview.confirmed_at ? ` at ${String(planReview.confirmed_at)}` : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p className="mb-1 font-medium text-slate-900">Data check</p>
        {loading ? <p>Loading preview...</p> : null}
        {error ? <p className="text-rose-600">{error}</p> : null}

        {!loading && !error && preview ? (
          <div className="space-y-1">
            {preview.actual.map((item, idx) => (
              <p key={`${item.platform}-${idx}`}>
                {item.platform}: {item.campaigns} campaigns
                {item.message ? ` (${item.message})` : ""}
              </p>
            ))}
            <p>
              Media plan: {preview.plan.rows} rows, {preview.plan.channels} channels, {preview.plan.platforms} platforms
              {preview.plan.message ? ` (${preview.plan.message})` : ""}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
