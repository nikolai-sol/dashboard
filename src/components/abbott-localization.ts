const ABBOTT_TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  "Direct traffic": "Прямые заходы",
  "Link traffic": "Переходы по ссылкам",
  "Search engine traffic": "Переходы из поисковых систем",
  "Internal traffic": "Внутренние переходы",
  "Unknown traffic": "Неизвестный источник",
  "Registered portal behavior": "Зарегистрированное поведение на портале",
};

export function abbottTrafficSourceLabel(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) return "Неизвестный источник";
  return ABBOTT_TRAFFIC_SOURCE_LABELS[normalized] ?? raw;
}

export function abbottTrafficSourceOption(raw: string): { value: string; label: string } {
  return {
    value: raw,
    label: abbottTrafficSourceLabel(raw),
  };
}
