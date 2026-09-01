export type AbbottReturningControlFilters = {
  url?: string;
  direction?: string;
};

const EMPTY_FILTER_COMBINATION_MESSAGE =
  "Для выбранного сочетания URL и направления данных нет.";

export function returningControlEmptyMessage(
  rowCount: number,
  filters: AbbottReturningControlFilters,
): string | null {
  const hasActiveFilter = Boolean(filters.url?.trim() || filters.direction?.trim());
  return hasActiveFilter && rowCount === 0 ? EMPTY_FILTER_COMBINATION_MESSAGE : null;
}
