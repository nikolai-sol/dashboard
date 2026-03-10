import { Download } from "lucide-react";

type DashboardHeaderProps = {
  clientName: string;
  title: string;
  periodLabel: string;
};

export default function DashboardHeader({
  clientName,
  title,
  periodLabel,
}: DashboardHeaderProps) {
  return (
    <header className="card-surface mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
          SG
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
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Download className="h-4 w-4" />
        Export PDF
      </button>
    </header>
  );
}
