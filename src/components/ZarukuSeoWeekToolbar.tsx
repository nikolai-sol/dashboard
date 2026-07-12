"use client";

import { History } from "lucide-react";
import { previousAvailableWeek } from "@/components/zaruku-seo-week-selection";

type Props = {
  weeks: string[];
  primaryWeek: string | null;
  comparisonWeek: string | null;
  comparisonEnabled: boolean;
  onComparisonEnabledChange: (enabled: boolean) => void;
  onPrimaryWeekChange: (week: string | null) => void;
  onComparisonWeekChange: (week: string | null) => void;
  onComparePrevious: () => void;
};

export default function ZarukuSeoWeekToolbar({
  weeks,
  primaryWeek,
  comparisonWeek,
  comparisonEnabled,
  onComparisonEnabledChange,
  onPrimaryWeekChange,
  onComparisonWeekChange,
  onComparePrevious,
}: Props) {
  const previousWeek = primaryWeek ? previousAvailableWeek(weeks, primaryWeek) : null;
  const hasWeeks = weeks.length > 0;

  return (
    <div className="grid gap-2 sm:grid-cols-[auto_minmax(10rem,1fr)_minmax(10rem,1fr)_2rem] sm:items-end">
      <div role="group" aria-label="Режим сравнения" className="inline-flex h-9 w-fit rounded-md border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          aria-pressed={!comparisonEnabled}
          onClick={() => onComparisonEnabledChange(false)}
          className={!comparisonEnabled ? "rounded px-2.5 text-xs font-medium text-slate-950 shadow-sm" : "rounded px-2.5 text-xs text-slate-500 hover:text-slate-800"}
        >
          Single
        </button>
        <button
          type="button"
          aria-pressed={comparisonEnabled}
          onClick={() => onComparisonEnabledChange(true)}
          className={comparisonEnabled ? "rounded bg-slate-900 px-2.5 text-xs font-medium text-white shadow-sm" : "rounded px-2.5 text-xs text-slate-500 hover:text-slate-800"}
        >
          Compare
        </button>
      </div>

      <label className="grid min-w-0 gap-1">
        <span className="text-xs font-medium text-slate-500">A · Основная неделя</span>
        <select
          aria-label="Основная ISO неделя"
          value={primaryWeek ?? ""}
          disabled={!hasWeeks}
          onChange={(event) => onPrimaryWeekChange(event.target.value || null)}
          className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-teal-600"
        >
          {!primaryWeek ? <option value="">Нет доступных недель</option> : null}
          {weeks.map((week) => <option key={week} value={week}>{week}</option>)}
        </select>
      </label>

      <label className="grid min-w-0 gap-1">
        <span className="text-xs font-medium text-slate-500">B · Сравнение</span>
        <select
          aria-label="Сравнительная ISO неделя"
          value={comparisonWeek ?? ""}
          disabled={!comparisonEnabled || !hasWeeks}
          onChange={(event) => onComparisonWeekChange(event.target.value || null)}
          className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          <option value="">Выберите неделю</option>
          {weeks.map((week) => <option key={week} value={week}>{week}</option>)}
        </select>
      </label>

      <button
        type="button"
        aria-label="Сравнить с предыдущей доступной неделей"
        title="Сравнить с предыдущей доступной неделей"
        disabled={!previousWeek}
        onClick={onComparePrevious}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        <History className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
