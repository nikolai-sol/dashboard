export type SourceWeekSelection<T> = {
  requestedWeek: string | null;
  actualWeek: string | null;
  rows: T[];
  fallback: boolean;
};

function uniqueSortedWeeks(weeks: string[]) {
  return [...new Set(weeks.filter(Boolean))].sort();
}

export function selectSourceWeekRows<T extends { week: string }>(
  rows: T[],
  requestedWeek: string | null,
  availableWeeks: string[] = rows.map((row) => row.week),
): SourceWeekSelection<T> {
  const populatedWeeks = uniqueSortedWeeks(rows.map((row) => row.week));
  const knownWeeks = uniqueSortedWeeks(availableWeeks);

  if (requestedWeek && knownWeeks.includes(requestedWeek)) {
    return {
      requestedWeek,
      actualWeek: requestedWeek,
      rows: rows.filter((row) => row.week === requestedWeek),
      fallback: false,
    };
  }

  const actualWeek = populatedWeeks.at(-1) ?? null;
  return {
    requestedWeek,
    actualWeek,
    rows: actualWeek ? rows.filter((row) => row.week === actualWeek) : [],
    fallback: Boolean(requestedWeek && actualWeek && actualWeek !== requestedWeek),
  };
}

function shortWeek(week: string) {
  return week.replace(/^\d{4}-/, "");
}

export function formatSourceWeekFallback(
  selection: Pick<SourceWeekSelection<unknown>, "requestedWeek" | "actualWeek" | "fallback">,
) {
  if (!selection.fallback || !selection.requestedWeek || !selection.actualWeek) return null;
  return `${shortWeek(selection.requestedWeek)} недоступна, показано ${shortWeek(selection.actualWeek)}`;
}

export function hasSourceWeekFallback(
  selections: Array<Pick<SourceWeekSelection<unknown>, "fallback">>,
) {
  return selections.some((selection) => selection.fallback);
}
