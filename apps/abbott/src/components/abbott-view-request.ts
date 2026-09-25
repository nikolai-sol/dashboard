import { ABBOTT_READ_VIEWS, type AbbottReadView } from "../../../../src/lib/abbott-read-request";

export type AbbottViewIdentity = { releaseId: number | null; audience: "manager" | "embed" };
export function buildAbbottViewUrl(input: {
  dashboardId: "18" | "abbott"; from: string; to: string; view: AbbottReadView;
  accessToken?: string; embedKey?: string;
}) {
  const params = new URLSearchParams();
  if (input.from && input.to) { params.set("from", input.from); params.set("to", input.to); }
  if (input.accessToken) params.set("access_token", input.accessToken);
  if (input.embedKey) params.set("embed_key", input.embedKey);
  params.set("view", input.view);
  return `/api/dashboard/${input.dashboardId}?${params.toString()}`;
}

export function beginAbbottViewRequest(state: { generation: number; controller: AbortController | null }) {
  state.controller?.abort();
  const controller = new AbortController();
  const generation = ++state.generation;
  state.controller = controller;
  return {
    signal: controller.signal,
    isCurrent: () => state.generation === generation && !controller.signal.aborted,
    cancel: () => controller.abort(),
  };
}

export function classifyAbbottViewResponse(
  value: unknown,
  expected: { from: string; to: string; view: AbbottReadView },
  previous?: AbbottViewIdentity,
): { kind: "invalid" } | ({ kind: "accept" | "restart" } & AbbottViewIdentity) {
  if (!value || typeof value !== "object") return { kind: "invalid" };
  const data = value as { dashboard?: { type?: unknown; period?: { from?: unknown; to?: unknown } }; abbott_bi?: {
    access_level?: unknown; session_journeys?: unknown; data_quality?: { status?: unknown; release_id?: unknown };
    read_contract?: { version?: unknown; view?: unknown; available_views?: unknown };
  } };
  const bi = data.abbott_bi;
  const contract = bi?.read_contract;
  const releaseId = bi?.data_quality?.release_id;
  if (data.dashboard?.type !== "abbott_bi" || data.dashboard.period?.from !== expected.from
      || data.dashboard.period?.to !== expected.to || !bi || contract?.version !== 1 || contract.view !== expected.view
      || !Array.isArray(contract.available_views) || contract.available_views.length > ABBOTT_READ_VIEWS.length
      || new Set(contract.available_views).size !== contract.available_views.length
      || !contract.available_views.includes("users_summary")
      || contract.available_views.some(view => !ABBOTT_READ_VIEWS.includes(view))
      || !["complete", "incomplete"].includes(String(bi.data_quality?.status))
      || !(releaseId === null || (typeof releaseId === "number" && Number.isSafeInteger(releaseId) && releaseId > 0))) {
    return { kind: "invalid" };
  }
  const audience = bi.access_level;
  if (audience !== "manager" && audience !== "embed") return { kind: "invalid" };
  if ((audience === "manager") !== (bi.session_journeys !== undefined)) return { kind: "invalid" };
  if (previous && audience !== previous.audience) return { kind: "invalid" };
  const kind = expected.view !== "full" && ((!contract.available_views.includes(expected.view))
    || (previous && releaseId !== previous.releaseId && expected.view !== "users_summary"))
    ? "restart" : "accept";
  return { kind, releaseId, audience };
}
