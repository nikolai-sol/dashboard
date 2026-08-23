export const ABBOTT_WITHOUT_ADMINS = "__abbott_without_admins__";

export type AbbottAdminUserOption = { value: string; label: string };

export function buildAbbottAdminUserOptions(
  exactUserIds: readonly string[],
  adminFilterAvailable: boolean,
): AbbottAdminUserOption[] {
  const exact = [...new Set(exactUserIds)]
    .filter((userId) => userId !== ABBOTT_WITHOUT_ADMINS)
    .sort((left, right) => left.localeCompare(right));
  return [
    ...(adminFilterAvailable
      ? [{ value: ABBOTT_WITHOUT_ADMINS, label: "ВСЕ без админов" }]
      : []),
    ...exact.map((userId) => ({ value: userId, label: userId })),
  ];
}

export function normalizeAbbottAdminUserInput(value: string):
  | { ok: true; userIds: string[] }
  | { ok: false; userIds: [] } {
  const userIds = [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
  if (userIds.length === 0 || userIds.length > 200 || userIds.some((item) => !/^[0-9]{1,32}$/.test(item))) {
    return { ok: false, userIds: [] };
  }
  return { ok: true, userIds };
}

export function abbottAdminUsersApiPath(dashboardId: string, search: string): string {
  const accessToken = new URLSearchParams(search).get("access_token");
  const params = new URLSearchParams();
  if (accessToken) params.set("access_token", accessToken);
  const suffix = params.toString();
  return `/api/dashboard/${encodeURIComponent(dashboardId)}/abbott-admin-users${suffix ? `?${suffix}` : ""}`;
}
