"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardAiSummary } from "@/lib/types";

type DashboardAiSummaryAuthoringPanelProps = {
  dashboardId: string;
};

type AiSummaryStateResponse = {
  enabled: boolean;
  source: "disabled" | "none" | "snapshot" | "override";
  override_text: string | null;
  effective_summary: DashboardAiSummary | null;
  snapshot_summary: DashboardAiSummary | null;
  has_snapshot: boolean;
};

type ErrorResponse = {
  error?: string;
  details?: string;
  candidate?: DashboardAiSummary | null;
};

function formatSourceLabel(source: AiSummaryStateResponse["source"]): string {
  if (source === "override") return "Manual override";
  if (source === "snapshot") return "Persisted snapshot";
  if (source === "disabled") return "Disabled";
  return "Not generated";
}

function formatSummaryStatus(summary: DashboardAiSummary): string {
  if (summary.status === "ready") {
    return "Ready";
  }
  if (summary.reason) {
    return `${summary.status} (${summary.reason.replaceAll("_", " ")})`;
  }
  return summary.status;
}

function SummaryPreview({
  title,
  summary,
}: {
  title: string;
  summary: DashboardAiSummary | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {summary ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-600">
            {formatSummaryStatus(summary)}
          </span>
        ) : null}
      </div>

      {!summary ? (
        <p className="mt-3 text-sm text-slate-500">No summary is stored for the current saved context.</p>
      ) : summary.status !== "ready" ? (
        <p className="mt-3 text-sm text-slate-600">
          This summary is not ready.
          {summary.reason ? ` Reason: ${summary.reason.replaceAll("_", " ")}.` : ""}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-base font-semibold text-slate-900">{summary.headline}</p>
            {summary.generated_at ? (
              <p className="mt-1 text-xs text-slate-500">Generated at {summary.generated_at}</p>
            ) : null}
          </div>

          {summary.bullets?.length ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {summary.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {summary.watchout ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-medium">Watchout:</span> {summary.watchout}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function DashboardAiSummaryAuthoringPanel({
  dashboardId,
}: DashboardAiSummaryAuthoringPanelProps) {
  const [state, setState] = useState<AiSummaryStateResponse | null>(null);
  const [overrideText, setOverrideText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"generate" | "save" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/dashboards/${dashboardId}/ai-summary`, {
        cache: "no-store",
      });
      const json = (await response.json()) as AiSummaryStateResponse & ErrorResponse;
      if (!response.ok) {
        throw new Error(json.details ? `${json.error ?? "Request failed"}: ${json.details}` : json.error ?? `HTTP ${response.status}`);
      }
      setState(json);
      setOverrideText(json.override_text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI summary state");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const runAction = async (
    action: "generate" | "save" | "clear",
    request: () => Promise<Response>,
    successMessage: string,
  ) => {
    setBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      const response = await request();
      const json = (await response.json()) as AiSummaryStateResponse & ErrorResponse;
      if (!response.ok) {
        const candidateReason =
          json.candidate?.reason ? ` (${json.candidate.reason.replaceAll("_", " ")})` : "";
        throw new Error(
          json.details
            ? `${json.error ?? "Request failed"}: ${json.details}`
            : `${json.error ?? `HTTP ${response.status}`}${candidateReason}`,
        );
      }
      setState(json);
      setOverrideText(json.override_text ?? "");
      setMessage(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const canSaveOverride = overrideText.trim().length > 0 && busyAction === null;
  const canClearOverride = Boolean(state?.override_text) && busyAction === null;
  const canGenerate = Boolean(state?.enabled) && busyAction === null;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI summary authoring</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Generation only uses the saved dashboard configuration. Save wizard changes first if you
            changed dates, compare settings, or brand setup.
          </p>
        </div>
        {state ? (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            Effective source: {formatSourceLabel(state.source)}
          </span>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading AI summary state...</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {!loading && state?.source === "disabled" ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          AI summary is disabled for this dashboard. Enable it in the wizard and save first.
        </p>
      ) : null}

      {!loading && state?.enabled ? (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                void runAction(
                  "generate",
                  () =>
                    fetch(`/api/admin/dashboards/${dashboardId}/ai-summary/generate`, {
                      method: "POST",
                    }),
                  state.has_snapshot ? "AI summary snapshot regenerated." : "AI summary snapshot generated.",
                )
              }
              disabled={!canGenerate}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === "generate"
                ? "Generating..."
                : state.has_snapshot
                  ? "Regenerate snapshot"
                  : "Generate snapshot"}
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <label className="block text-sm font-semibold text-slate-900" htmlFor="ai-summary-override">
              Manual override
            </label>
            <p className="mt-1 text-sm text-slate-500">
              When override text exists, the public dashboard uses it instead of the generated snapshot.
            </p>
            <textarea
              id="ai-summary-override"
              value={overrideText}
              onChange={(event) => setOverrideText(event.target.value)}
              placeholder={"Headline\nBullet one\nBullet two\nWatchout: optional note"}
              className="mt-3 min-h-40 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    "save",
                    () =>
                      fetch(`/api/admin/dashboards/${dashboardId}/ai-summary`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ override_text: overrideText }),
                      }),
                    "Manual override saved.",
                  )
                }
                disabled={!canSaveOverride}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "save" ? "Saving..." : "Save override"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    "clear",
                    () =>
                      fetch(`/api/admin/dashboards/${dashboardId}/ai-summary`, {
                        method: "DELETE",
                      }),
                    "Manual override cleared.",
                  )
                }
                disabled={!canClearOverride}
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "clear" ? "Clearing..." : "Clear override"}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SummaryPreview title="Effective summary" summary={state.effective_summary} />
            {state.source === "override" ? (
              <SummaryPreview title="Persisted generated snapshot" summary={state.snapshot_summary} />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
