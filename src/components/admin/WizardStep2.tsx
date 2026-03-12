"use client";

import { useMemo, useState } from "react";
import type { DashboardFormData, DashboardSourceForm, PlatformMeta } from "@/lib/admin-ui-types";

type WizardStep2Props = {
  data: DashboardFormData;
  platforms: PlatformMeta[];
  onChange: (next: DashboardFormData) => void;
};

const TEMPLATE_HEADERS =
  "platform,channel,format,buy_type,units_plan,unit_price,budget_plan,impressions_plan,reach_plan,frequency_plan,views_plan,clicks_plan,conversions_plan,ctr_plan,cpm_plan,cpc_plan,cpv_plan,cpa_plan";

function parsePreview(csv: string): string[][] {
  const lines = csv
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 6);
  return lines.map((line) => line.split(",").map((cell) => cell.trim()));
}

export default function WizardStep2({ data, platforms, onChange }: WizardStep2Props) {
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const mysqlPlatforms = useMemo(
    () => platforms.filter((platform) => platform.source === "mysql"),
    [platforms],
  );
  const mediaPlanMeta = useMemo(
    () => platforms.find((platform) => platform.id === "media_plan") ?? null,
    [platforms],
  );

  const actualSources = data.sources.filter((source) => source.role === "actual");
  const planSource = data.sources.find((source) => source.role === "plan");

  const setSources = (nextActual: DashboardSourceForm[], nextPlan: DashboardSourceForm | undefined) => {
    onChange({
      ...data,
      sources: nextPlan ? [...nextActual, nextPlan] : nextActual,
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
    const nextPlan: DashboardSourceForm = {
      ...planSource,
      source_config: { ...(planSource.source_config ?? {}), sheet_url: url },
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

  const previewSheet = async () => {
    const sheetUrl = String(planSource?.source_config?.sheet_url ?? "").trim();
    if (!sheetUrl) {
      setPreviewError("Sheet URL is empty");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await fetch(sheetUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setPreviewRows(parsePreview(text));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Preview failed");
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
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
              <span className="mb-1 block font-medium text-slate-700">Google Sheets CSV URL</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={String(planSource.source_config?.sheet_url ?? "")}
                onChange={(e) => updatePlanSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/.../pub?output=csv"
              />
            </label>

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
                onClick={previewSheet}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
              >
                {previewLoading ? "Loading..." : "Preview"}
              </button>
            </div>

            {previewError ? <p className="text-sm text-rose-600">{previewError}</p> : null}
            {previewRows.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className={idx === 0 ? "bg-slate-100 font-semibold" : "border-t"}>
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx} className="whitespace-nowrap px-2 py-1">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
