import type {
  ZarukuGscBrandSplitRow,
  ZarukuGscSearchAppearanceRow,
  ZarukuGscSearchTypeRow,
  ZarukuGscSummaryRow,
} from "@/lib/types";

type PeriodMeta = {
  label: string;
  fallbackNote: string | null;
};

type Props = {
  summaryRows: ZarukuGscSummaryRow[];
  brandRows: ZarukuGscBrandSplitRow[];
  appearanceRows: ZarukuGscSearchAppearanceRow[];
  resultTypeRows: ZarukuGscSearchTypeRow[];
  periods: {
    summary: PeriodMeta;
    brand: PeriodMeta;
    appearance: PeriodMeta;
    resultType: PeriodMeta;
  };
  locale?: string;
};

type DiagnosticRow = {
  key: string;
  label: string;
  secondary?: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  averagePosition: number | null;
};

function formatNumber(value: number, locale: string): string {
  return Math.round(value).toLocaleString(locale);
}

function formatDecimal(value: number | null, locale: string, digits = 1): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function formatPercent(value: number | null, locale: string): string {
  return value === null || !Number.isFinite(value) ? "—" : `${formatDecimal(value, locale)}%`;
}

function DiagnosticTable({ rows, locale }: { rows: DiagnosticRow[]; locale: string }) {
  return (
    <div className="max-h-[24rem] overflow-auto rounded-lg border border-slate-100">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-400 shadow-[0_1px_0_0_#f1f5f9]">
          <tr>
            <th className="px-3 py-2.5 text-left font-medium">Разрез</th>
            <th className="px-3 py-2.5 text-right font-medium">Показы</th>
            <th className="px-3 py-2.5 text-right font-medium">Клики</th>
            <th className="px-3 py-2.5 text-right font-medium">CTR</th>
            <th className="px-3 py-2.5 text-right font-medium">Позиция</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-slate-50/70">
              <td className="px-3 py-2.5">
                <div className="font-medium text-slate-700">{row.label || "—"}</div>
                {row.secondary ? <div className="mt-0.5 text-xs text-slate-400">{row.secondary}</div> : null}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.impressions, locale)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.clicks, locale)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatPercent(row.ctr, locale)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatDecimal(row.averagePosition, locale)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">Нет данных для выбранной недели.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticPanel({
  title,
  period,
  rows,
  locale,
}: {
  title: string;
  period: PeriodMeta;
  rows: DiagnosticRow[];
  locale: string;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <span className="rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">Google RF · {period.label}</span>
      </div>
      <DiagnosticTable rows={rows} locale={locale} />
      {period.fallbackNote ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {period.fallbackNote}
        </p>
      ) : null}
    </section>
  );
}

export default function ZarukuSeoDiagnostics({
  summaryRows,
  brandRows,
  appearanceRows,
  resultTypeRows,
  periods,
  locale = "ru-RU",
}: Props) {
  const deviceRows: DiagnosticRow[] = summaryRows.map((row) => ({
    key: `${row.week}-${row.device}`,
    label: row.device || "Не указано",
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    averagePosition: row.average_position,
  }));
  const brandDiagnosticRows: DiagnosticRow[] = brandRows.map((row) => ({
    key: `${row.week}-${row.bucket}`,
    label: row.bucket === "brand" ? "Брендовые" : "Небрендовые",
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    averagePosition: row.average_position,
  }));
  const appearanceDiagnosticRows: DiagnosticRow[] = appearanceRows.map((row) => ({
    key: `${row.week}-${row.search_type}-${row.search_appearance}`,
    label: row.search_appearance || "Не указано",
    secondary: row.search_type,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    averagePosition: row.average_position,
  }));
  const resultTypeDiagnosticRows: DiagnosticRow[] = resultTypeRows.map((row) => ({
    key: `${row.week}-${row.search_type}`,
    label: row.search_type || "Не указано",
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    averagePosition: row.average_position,
  }));

  return (
    <details className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
      <summary className="cursor-pointer list-none px-4 py-4 marker:hidden sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Дополнительная диагностика</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Устройства, брендовый спрос и технические разрезы Google Search Console.</p>
          </div>
          <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500">Показать</span>
        </div>
      </summary>
      <div className="grid min-w-0 gap-4 border-t border-slate-200 p-4 xl:grid-cols-2 sm:p-5">
        <DiagnosticPanel title="Устройства" period={periods.summary} rows={deviceRows} locale={locale} />
        <DiagnosticPanel title="Брендовые и небрендовые запросы" period={periods.brand} rows={brandDiagnosticRows} locale={locale} />
        <DiagnosticPanel title="Внешний вид в поиске" period={periods.appearance} rows={appearanceDiagnosticRows} locale={locale} />
        <DiagnosticPanel title="Типы результатов" period={periods.resultType} rows={resultTypeDiagnosticRows} locale={locale} />
      </div>
    </details>
  );
}
