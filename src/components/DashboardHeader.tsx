"use client";

import { Download } from "lucide-react";

type DashboardHeaderProps = {
  clientName: string;
  title: string;
  periodLabel: string;
  logoUrl?: string | null;
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

      <button
        type="button"
        onClick={onExportPdf}
        className="no-print inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Download className="h-4 w-4" />
        Export PDF
      </button>
    </header>
  );
}
