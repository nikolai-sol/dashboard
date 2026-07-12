export type WeekSelection = {
  primaryWeek: string | null;
  comparisonWeek: string | null;
};

export type WeekSelectionField = keyof WeekSelection;

export function createWeekSelection(latestWeek: string | null): WeekSelection {
  return { primaryWeek: latestWeek, comparisonWeek: null };
}

function sortIsoWeeks(weeks: string[]) {
  return [...weeks].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function previousAvailableWeek(weeks: string[], selectedWeek: string) {
  const sortedWeeks = sortIsoWeeks(weeks);
  const selectedIndex = sortedWeeks.indexOf(selectedWeek);
  return selectedIndex > 0 ? sortedWeeks[selectedIndex - 1] : null;
}

function nearestAvailableAlternative(weeks: string[], selectedWeek: string) {
  const previousWeek = previousAvailableWeek(weeks, selectedWeek);
  if (previousWeek) return previousWeek;

  const sortedWeeks = sortIsoWeeks(weeks);
  const selectedIndex = sortedWeeks.indexOf(selectedWeek);
  return selectedIndex >= 0 ? sortedWeeks[selectedIndex + 1] ?? null : sortedWeeks[0] ?? null;
}

export function updateWeekSelection(
  selection: WeekSelection,
  field: WeekSelectionField,
  selectedWeek: string | null,
  weeks: string[],
): WeekSelection {
  const nextSelection = { ...selection, [field]: selectedWeek };
  const otherField = field === "primaryWeek" ? "comparisonWeek" : "primaryWeek";

  if (!selectedWeek || selectedWeek !== nextSelection[otherField]) return nextSelection;

  const alternativeWeek = nearestAvailableAlternative(weeks, selectedWeek);
  if (!alternativeWeek) {
    return field === "primaryWeek"
      ? { ...nextSelection, comparisonWeek: null }
      : { ...selection, comparisonWeek: null };
  }

  return field === "primaryWeek"
    ? { ...nextSelection, comparisonWeek: alternativeWeek }
    : { ...nextSelection, primaryWeek: alternativeWeek };
}
