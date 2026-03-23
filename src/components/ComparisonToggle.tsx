"use client";

import { useMemo } from "react";
import type { DashboardLanguage } from "@/lib/dashboard-i18n";

export type ComparisonPreset = "previous" | "month" | "week" | "year" | "custom";

type ComparisonToggleProps = {
  open: boolean;
  currentFrom: string;
  currentTo: string;
  compareFrom: string;
  compareTo: string;
  preset: ComparisonPreset;
  language: DashboardLanguage;
  labels: {
    compare: string;
    compareApply: string;
    compareClose: string;
    compareTitle: string;
    compareCurrent: string;
    comparePrevious: string;
    compareMonth: string;
    compareWeek: string;
    compareYear: string;
    compareCustom: string;
    compareFrom: string;
    compareTo: string;
  };
  onToggleOpen: () => void;
  onPresetChange: (preset: ComparisonPreset) => void;
  onCompareFromChange: (value: string) => void;
  onCompareToChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
};

function formatDateLabel(value: string, language: DashboardLanguage) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function ComparisonToggle({
  open,
  currentFrom,
  currentTo,
  compareFrom,
  compareTo,
  preset,
  language,
  labels,
  onToggleOpen,
  onPresetChange,
  onCompareFromChange,
  onCompareToChange,
  onApply,
  onClear,
}: ComparisonToggleProps) {
  const currentLabel = useMemo(
    () => `${formatDateLabel(currentFrom, language)} — ${formatDateLabel(currentTo, language)}`,
    [currentFrom, currentTo, language],
  );
  const compareLabel = useMemo(
    () => `${formatDateLabel(compareFrom, language)} — ${formatDateLabel(compareTo, language)}`,
    [compareFrom, compareTo, language],
  );

  return (
    <div className="relative z-[70]">
      <button
        type="button"
        onClick={onToggleOpen}
        className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
          open || (compareFrom && compareTo)
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        {labels.compare}
      </button>

      {open ? (
        <div className="absolute right-0 z-[80] mt-2 w-[min(92vw,560px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">{labels.compareTitle}</h4>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {labels.compareClose}
            </button>
          </div>

          <div className="mt-4 space-y-4 text-sm text-slate-700">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                {labels.compareCurrent}
              </div>
              <div className="mt-1 font-medium text-slate-900">{currentLabel}</div>
            </div>

            <div className="space-y-2">
              {[
                { id: "previous", label: labels.comparePrevious },
                { id: "month", label: labels.compareMonth },
                { id: "week", label: labels.compareWeek },
                { id: "year", label: labels.compareYear },
                { id: "custom", label: labels.compareCustom },
              ].map((option) => (
                <label key={option.id} className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="comparison-preset"
                    checked={preset === option.id}
                    onChange={() => onPresetChange(option.id as ComparisonPreset)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-slate-900">{option.label}</div>
                    {preset === option.id ? (
                      <div className="text-xs text-slate-500">{compareLabel}</div>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>

            {preset === "custom" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="rounded-lg border border-slate-200 px-3 py-2">
                  <span className="mb-1 block text-xs text-slate-500">{labels.compareFrom}</span>
                  <input
                    type="date"
                    value={compareFrom}
                    onChange={(event) => onCompareFromChange(event.target.value)}
                    className="w-full bg-transparent outline-none"
                  />
                </label>
                <label className="rounded-lg border border-slate-200 px-3 py-2">
                  <span className="mb-1 block text-xs text-slate-500">{labels.compareTo}</span>
                  <input
                    type="date"
                    value={compareTo}
                    onChange={(event) => onCompareToChange(event.target.value)}
                    className="w-full bg-transparent outline-none"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onApply}
              disabled={!compareFrom || !compareTo}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.compareApply}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
