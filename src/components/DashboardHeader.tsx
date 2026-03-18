"use client";

import { CalendarRange, Download } from "lucide-react";

type DashboardHeaderProps = {
  clientName: string;
  title: string;
  periodLabel: string;
  logoUrl?: string | null;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onApplyDateRange?: () => void;
  isUpdatingRange?: boolean;
  onExportPdf?: () => void;
};

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "SG";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "SG";
}

export default function DashboardHeader({
  clientName,
  title,
  periodLabel,
  logoUrl,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onApplyDateRange,
  isUpdatingRange = false,
  onExportPdf,
}: DashboardHeaderProps) {
  const initials = getInitials(clientName);

  return (
    <header className="card-surface mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-900 shadow-sm">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${clientName} logo`}
              className="h-full w-full object-contain object-center p-1.5"
            />
          ) : (
            initials
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            {clientName} - {title}
          </h1>
          <p className="text-sm text-slate-500">{periodLabel}</p>
        </div>
      </div>

      <div className="no-print flex flex-col gap-2 sm:items-end">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <CalendarRange className="h-4 w-4 text-slate-500" />
            <input
              type="date"
              value={dateFrom ?? ""}
              onChange={(e) => onDateFromChange?.(e.target.value)}
              className="bg-transparent outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <span className="text-slate-500">to</span>
            <input
              type="date"
              value={dateTo ?? ""}
              onChange={(e) => onDateToChange?.(e.target.value)}
              className="bg-transparent outline-none"
            />
          </label>
          <button
            type="button"
            onClick={onApplyDateRange}
            disabled={!dateFrom || !dateTo || isUpdatingRange}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUpdatingRange ? "Updating..." : "Apply"}
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      </div>
    </header>
  );
}
