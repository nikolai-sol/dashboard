export function filterAndPaginate<T>(
  rows: T[],
  query: string,
  requestedPage: number,
  pageSize: number,
  searchableText: (row: T) => string,
) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = normalized
    ? rows.filter((row) => searchableText(row).toLocaleLowerCase("ru-RU").includes(normalized))
    : rows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    page,
    totalPages,
    totalRows: filtered.length,
  };
}
