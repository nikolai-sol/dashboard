type DashboardSourceConfig = Record<string, unknown> | null | undefined;

export function dashboardSourceAccountLabel(sourceConfig: DashboardSourceConfig, accountId: string, fallback: string): string {
  const configuredAccounts = Array.isArray(sourceConfig?.account_ids)
    ? sourceConfig.account_ids.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const label = String(sourceConfig?.account_display_name ?? "").trim();
  return label && configuredAccounts.includes(accountId) ? label : fallback;
}
