"use client";

import type { ReactNode } from "react";
import type { DashboardLanguage, getDashboardI18n } from "@/lib/dashboard-i18n";

export type DashboardQuickRangePreset = "this_month" | "this_week" | "yesterday" | "custom";

type AbbottDashboardHeaderProps = {
  clientName: string;
  title: string;
  periodLabel: string;
  logoUrl?: string | null;
  pdfMode?: boolean;
  dateControlsSlot: ReactNode;
  language?: DashboardLanguage;
  labels?: ReturnType<typeof getDashboardI18n>["header"];
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onApplyDateRange?: () => void;
  quickRangePreset?: DashboardQuickRangePreset;
  onQuickRangePresetChange?: (preset: DashboardQuickRangePreset) => void;
  isUpdatingRange?: boolean;
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

export default function AbbottDashboardHeader({
  clientName,
  title,
  periodLabel,
  logoUrl,
  pdfMode = false,
  dateControlsSlot,
}: AbbottDashboardHeaderProps) {
  const initials = getInitials(clientName);

  return (
    <header className="card-surface relative z-[60] mb-6 flex flex-col gap-4 overflow-visible p-5 sm:flex-row sm:items-center sm:justify-between">
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

      {!pdfMode ? dateControlsSlot : null}
    </header>
  );
}
