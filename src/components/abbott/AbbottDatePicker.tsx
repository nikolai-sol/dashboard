"use client";

import type { AbbottDatePreset, AbbottDateRange } from "@/lib/abbott-date-range";

type AbbottDatePickerProps = {
  preset: AbbottDatePreset;
  appliedRange: AbbottDateRange;
  draftRange: AbbottDateRange;
  maxDate: string;
  isLoading?: boolean;
  emptyMessage?: string | null;
  onPresetChange: (preset: AbbottDatePreset) => void;
  onDraftFromChange: (value: string) => void;
  onDraftToChange: (value: string) => void;
  onApplyCustom: () => void;
};

export function validateAbbottCustomRange(range: AbbottDateRange, maxDate: string): string | null {
  if (!range.from || !range.to) return "Укажите обе даты периода";
  if (range.from > range.to) return "Дата начала не может быть позже даты окончания";
  if (range.to > maxDate) return "Дата окончания не может быть позже последнего завершённого дня";
  return null;
}

const PRESET_OPTIONS: Array<{ value: AbbottDatePreset; label: string }> = [
  { value: "this_month", label: "Этот месяц" },
  { value: "previous_month", label: "Прошлый месяц" },
  { value: "this_week", label: "Эта неделя" },
  { value: "previous_week", label: "Прошлая неделя" },
  { value: "custom", label: "Свой период" },
];

export default function AbbottDatePicker({
  preset,
  appliedRange,
  draftRange,
  maxDate,
  isLoading = false,
  emptyMessage,
  onPresetChange,
  onDraftFromChange,
  onDraftToChange,
  onApplyCustom,
}: AbbottDatePickerProps) {
  const customError = preset === "custom" ? validateAbbottCustomRange(draftRange, maxDate) : null;
  const customMessageId = "abbott-custom-range-message";
  const emptyMessageId = "abbott-empty-period-message";
  const activePeriod = appliedRange.from && appliedRange.to
    ? `${appliedRange.from} — ${appliedRange.to}`
    : "Нет завершённых дней";

  return (
    <section className="no-print flex w-full flex-col gap-2 sm:w-auto sm:items-end" aria-label="Период отчёта Abbott">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <label className="sr-only" htmlFor="abbott-date-preset">Период</label>
        <select
          id="abbott-date-preset"
          value={preset}
          disabled={isLoading}
          onChange={(event) => onPresetChange(event.target.value as AbbottDatePreset)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{activePeriod}</span>
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2 sm:justify-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            От
            <input
              type="date"
              value={draftRange.from}
              max={maxDate}
              disabled={isLoading}
              aria-describedby={customError ? customMessageId : undefined}
              onChange={(event) => onDraftFromChange(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            До
            <input
              type="date"
              value={draftRange.to}
              max={maxDate}
              disabled={isLoading}
              aria-describedby={customError ? customMessageId : undefined}
              onChange={(event) => onDraftToChange(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            disabled={isLoading || Boolean(customError)}
            onClick={onApplyCustom}
            className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Применить
          </button>
        </div>
      ) : null}

      {customError ? (
        <p id={customMessageId} role="alert" aria-live="assertive" className="text-xs text-rose-700">
          {customError}
        </p>
      ) : null}
      {emptyMessage ? (
        <p id={emptyMessageId} role="status" aria-live="polite" className="text-xs text-amber-700">
          {emptyMessage}
        </p>
      ) : null}
    </section>
  );
}
