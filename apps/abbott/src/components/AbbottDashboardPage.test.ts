import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

test("scoped client request helpers preserve auth, dates, full PDF and abort stale generations", async () => {
  assert.equal(existsSync(new URL("./abbott-view-request.ts", import.meta.url)), true, "scoped request helper exists");
  const { buildAbbottViewUrl, beginAbbottViewRequest } = await import("./abbott-view-request");
  const request = { dashboardId: "18" as const, from: "2026-09-01", to: "2026-09-13", accessToken: "manager", embedKey: "embed", view: "users_summary" as const };
  const initial = new URL(buildAbbottViewUrl(request), "https://example.test");
  assert.equal(initial.searchParams.get("view"), "users_summary");
  assert.equal(initial.searchParams.get("access_token"), "manager");
  assert.equal(initial.searchParams.get("embed_key"), "embed");
  assert.equal(initial.searchParams.get("from"), request.from);
  assert.equal(new URL(buildAbbottViewUrl({ ...request, view: "page_stats" }), initial).searchParams.get("view"), "page_stats");
  assert.equal(new URL(buildAbbottViewUrl({ ...request, view: "full" }), initial).searchParams.get("view"), "full");
  const state = { generation: 0, controller: null as AbortController | null };
  const first = beginAbbottViewRequest(state);
  const second = beginAbbottViewRequest(state);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  first.cancel();
  assert.equal(second.isCurrent(), true);
  second.cancel();
  assert.equal(second.isCurrent(), false);
});

test("response adoption checks period, view, audience and release before rendering", async () => {
  assert.equal(existsSync(new URL("./abbott-view-request.ts", import.meta.url)), true, "scoped request helper exists");
  const { classifyAbbottViewResponse } = await import("./abbott-view-request");
  const expected = { from: "2026-09-01", to: "2026-09-13", view: "user_actions" as const };
  const response = { dashboard: { type: "abbott_bi", period: { from: expected.from, to: expected.to } }, abbott_bi: { access_level: "manager", session_journeys: { rows: [] }, data_quality: { status: "complete", release_id: 49 }, read_contract: { version: 1, view: expected.view, available_views: ["users_summary", "user_actions"] } } };
  assert.equal(classifyAbbottViewResponse(response, expected, { releaseId: 49, audience: "manager" }).kind, "accept");
  assert.equal(classifyAbbottViewResponse(response, { ...expected, from: "2026-08-01" }).kind, "invalid");
  assert.equal(classifyAbbottViewResponse(response, { ...expected, view: "page_stats" }).kind, "invalid");
  assert.equal(classifyAbbottViewResponse(response, expected, { releaseId: 48, audience: "manager" }).kind, "restart");
  assert.equal(classifyAbbottViewResponse(response, expected, { releaseId: 49, audience: "embed" }).kind, "invalid");
  const incomplete = structuredClone(response); incomplete.abbott_bi.data_quality.status = "incomplete";
  assert.equal(classifyAbbottViewResponse(incomplete, expected).kind, "accept");
  const wrongAudience = structuredClone(response); wrongAudience.abbott_bi.access_level = "embed";
  assert.equal(classifyAbbottViewResponse(wrongAudience, expected).kind, "invalid");
  const missingView = structuredClone(response); missingView.abbott_bi.read_contract.available_views = ["users_summary"];
  assert.equal(classifyAbbottViewResponse(missingView, expected).kind, "restart");
  const invalidTabs = structuredClone(response); invalidTabs.abbott_bi.read_contract.available_views = [];
  assert.equal(classifyAbbottViewResponse(invalidTabs, expected).kind, "invalid");
});

test("rapid view/date generations ignore late completions even when a fetch ignores abort", async () => {
  const { beginAbbottViewRequest } = await import("./abbott-view-request");
  const state = { generation: 0, controller: null as AbortController | null };
  const adopted: string[] = [];
  let resolveOld!: (value: string) => void;
  const oldResponse = new Promise<string>(resolve => { resolveOld = resolve; });
  const first = beginAbbottViewRequest(state);
  const oldCompletion = oldResponse.then(value => { if (first.isCurrent()) adopted.push(value); });
  const second = beginAbbottViewRequest(state);
  await Promise.resolve("new period/view").then(value => { if (second.isCurrent()) adopted.push(value); });
  resolveOld("old period/view");
  await oldCompletion;
  assert.deepEqual(adopted, ["new period/view"]);
  assert.equal(first.signal.aborted, true);
  second.cancel();
  assert.equal(second.signal.aborted, true);
});

test("page effect is cancellation-safe, uses primitive dependencies and keeps pending content unready", () => {
  const source = readFileSync(new URL("./AbbottDashboardPage.tsx", import.meta.url), "utf8");
  assert.match(source, /beginAbbottViewRequest/);
  assert.match(source, /request\.isCurrent\(\)/);
  assert.match(source, /return \(\) => request\.cancel\(\)/);
  assert.doesNotMatch(source, /\}, \[abbottEmptyMessage[^\n]*\bdateRange\b/);
  assert.match(source, /isPdfMode \? "full"/);
  assert.match(source, /activeView=\{activeView\}/);
  assert.match(source, /viewPending=\{viewPending\}/);
  assert.match(source, /data-dashboard-ready=\{[^\n]*viewPending/);
});
