import type { FunnelStep } from "@/lib/types";

type ConversionFunnelProps = {
  data: FunnelStep[];
  pdfMode?: boolean;
  locale?: string;
  labels?: {
    title: string;
    previousRate: string;
    overallRate: string;
  };
};

function compact(value: number, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(Math.round(value));
}

export default function ConversionFunnel({
  data,
  pdfMode = false,
  locale = "en-US",
  labels,
}: ConversionFunnelProps) {
  if (!data.length) return null;

  const maxValue = Math.max(...data.map((step) => step.value), 1);
  const impressions = data.find((step) => step.id === "impressions")?.value ?? 0;
  const conversions = data.find((step) => step.id === "conversions")?.value ?? 0;
  const overallRate = impressions > 0 && conversions > 0 ? (conversions / impressions) * 100 : null;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl text-slate-900">{labels?.title ?? "Conversion Funnel"}</h3>
          {overallRate !== null ? (
            <p className="mt-1 text-sm text-slate-500">
              {labels?.overallRate ?? "Overall"}: {overallRate.toFixed(2)}%
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {data.map((step) => {
          const widthPct = Math.max(14, (step.value / maxValue) * 100);
          return (
            <div key={step.id} className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[170px_minmax(0,1fr)_auto]">
              <div>
                <div className="text-sm font-medium text-slate-900">{step.label}</div>
                {step.conversion_rate !== undefined ? (
                  <div className="text-xs text-slate-500">
                    {labels?.previousRate ?? "From previous"}: {step.conversion_rate.toFixed(2)}%
                  </div>
                ) : null}
              </div>
              <div className="h-12 overflow-hidden rounded-2xl bg-slate-100">
                <div
                  className="flex h-full items-center rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-300 px-4 text-white transition-all duration-500"
                  style={{ width: `${widthPct}%`, minWidth: pdfMode ? "120px" : "88px" }}
                >
                  <span className="truncate text-sm font-semibold">{compact(step.value, locale)}</span>
                </div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-700">{compact(step.value, locale)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
