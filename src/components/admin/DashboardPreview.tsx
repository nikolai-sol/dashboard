"use client";

import type { DashboardFormData } from "@/lib/admin-ui-types";

type DashboardPreviewProps = {
  data: DashboardFormData;
};

export default function DashboardPreview({ data }: DashboardPreviewProps) {
  const actualSources = data.sources.filter((source) => source.role === "actual");
  const planSource = data.sources.find((source) => source.role === "plan");
  const sheetUrl = String(planSource?.source_config?.sheet_url ?? "");

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
            </li>
          ))}
        </ul>
        {planSource ? (
          <p className="mt-2 truncate">
            <span className="font-medium text-slate-900">Sheet URL:</span> {sheetUrl || "(empty)"}
          </p>
        ) : null}
      </div>
    </section>
  );
}
