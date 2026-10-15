// Source values belong to Metrica. Keep labels and filter identities identical.
export function abbottTrafficSourceLabel(raw: string): string {
  return raw;
}

export function abbottTrafficSourceOption(raw: string): { value: string; label: string } {
  return { value: raw, label: raw };
}

export function abbottTrafficSourceOptions(rows: readonly { traffic_source: string }[]) {
  return [...new Set(rows.map(row => row.traffic_source).filter(value => value.trim()))]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map(abbottTrafficSourceOption);
}

export function availableAbbottTrafficSource(
  value: string,
  options: readonly { value: string }[],
): string {
  return options.some(option => option.value === value) ? value : "";
}
