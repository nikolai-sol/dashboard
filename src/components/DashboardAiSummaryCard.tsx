"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import type { DashboardAiSummary } from "@/lib/types";

type DashboardAiSummaryLabels = {
  title: string;
  subtitle: string;
  watchout: string;
  generate: string;
  generating: string;
  unavailableTitle: string;
  unavailableBody: string;
  errorTitle: string;
  errorBody: string;
};

type DashboardAiSummaryCardProps = {
  summary?: DashboardAiSummary;
  enabled?: boolean;
  labels: DashboardAiSummaryLabels;
  onGenerate?: () => void;
  isGenerating?: boolean;
  generateError?: string | null;
};

function renderFallbackCopy(
  summary: DashboardAiSummary,
  labels: DashboardAiSummaryLabels,
): { title: string; body: string } {
  if (summary.status === "timeout" || summary.status === "error") {
    return {
      title: labels.errorTitle,
      body: labels.errorBody,
    };
  }

  return {
    title: labels.unavailableTitle,
    body: labels.unavailableBody,
  };
}

export default function DashboardAiSummaryCard({
  summary,
  enabled = false,
  labels,
  onGenerate,
  isGenerating = false,
  generateError,
}: DashboardAiSummaryCardProps) {
  if (!summary && !enabled) return null;

  const isReady = summary?.status === "ready";
  const canGenerate = Boolean(enabled && onGenerate);

  if (!summary) {
    return (
      <section className="card-surface mb-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {labels.title}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">{labels.unavailableTitle}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{labels.unavailableBody}</p>
            {generateError ? (
              <p className="mt-2 text-sm text-rose-600">{generateError}</p>
            ) : null}
          </div>
          {canGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? labels.generating : labels.generate}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (!isReady) {
    const fallback = renderFallbackCopy(summary, labels);

    return (
      <section className="card-surface mb-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {labels.title}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">{fallback.title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{fallback.body}</p>
              {generateError ? (
                <p className="mt-2 text-sm text-rose-600">{generateError}</p>
              ) : null}
            </div>
          </div>
          {canGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? labels.generating : labels.generate}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="card-surface mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {labels.title}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{summary.headline}</h2>
              </div>
              <p className="text-sm text-slate-500">{labels.subtitle}</p>
            </div>

            {summary.bullets?.length ? (
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
                {summary.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {summary.watchout ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
                  {labels.watchout}
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-900">{summary.watchout}</p>
              </div>
            ) : null}
            {generateError ? (
              <p className="mt-3 text-sm text-rose-600">{generateError}</p>
            ) : null}
          </div>
        </div>
        {canGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? labels.generating : labels.generate}
          </button>
        ) : null}
      </div>
    </section>
  );
}
