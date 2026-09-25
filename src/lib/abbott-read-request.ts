export const ABBOTT_READ_VIEWS = [
  "full", "users_summary", "user_actions", "page_stats", "bitrix_pages",
  "session_journeys", "external_events", "time_buckets", "returning", "general_materials",
] as const;
export type AbbottReadView = typeof ABBOTT_READ_VIEWS[number];
export type AbbottReadRequest = { view: AbbottReadView };

export class InvalidAbbottReadRequestError extends Error {
  constructor() { super("Invalid Abbott read request"); this.name = "InvalidAbbottReadRequestError"; }
}

export function parseAbbottReadRequest(url: string): AbbottReadRequest {
  const values = new URL(url).searchParams.getAll("view");
  if (values.length === 0) return { view: "full" };
  if (values.length !== 1 || !ABBOTT_READ_VIEWS.includes(values[0] as AbbottReadView)) {
    throw new InvalidAbbottReadRequestError();
  }
  return { view: values[0] as AbbottReadView };
}

// Closed internal dependency map; no caller-controlled table, audience or SQL.
export function abbottReadNeeds(view: AbbottReadView = "full") {
  if (!ABBOTT_READ_VIEWS.includes(view)) throw new InvalidAbbottReadRequestError();
  const full = view === "full";
  const pages = full || ["page_stats", "bitrix_pages", "general_materials", "time_buckets"].includes(view);
  return {
    summary: full || view === "users_summary",
    actions: full || view === "user_actions",
    returning: full || view === "returning",
    pages,
    bitrix: pages,
    journeys: full || view === "session_journeys",
    external: full || view === "external_events",
    materials: full || view === "general_materials",
  };
}

export function abbottBaseAvailableViews(audience: "manager" | "embed"): AbbottReadView[] {
  return audience === "manager"
    ? ["users_summary", "user_actions", "page_stats", "returning"]
    : ["users_summary", "page_stats", "returning"];
}
