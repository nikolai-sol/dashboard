import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardPdfGetHandler } from "./route";

test("combined PDF resolves canonical Zaruku before rendering its constant slug", async () => {
  const calls: unknown[] = [];
  const page = {
    async setViewport() {}, async emulateMediaType() {},
    async goto(url: string) { const target = new URL(url); calls.push([target.origin, target.pathname]); },
    async waitForSelector() {}, async evaluate() {},
    async pdf() { return Buffer.from("pdf fixture"); },
  };
  const handler = createDashboardPdfGetHandler({
    isDashboardAccessAuthorized: (async (_request: Request, id: string) => {
      calls.push(["authorize", id]);
      return { authorized: true, audience: "manager", credentialVersion: 7, context: { id: 28, client_id: "zaruku", dashboard_type: "zaruku_bi", auth_mode: "password_only" } };
    }) as never,
    launch: (async () => ({ async newPage() { return page; }, async close() { calls.push("close"); } })) as never,
    wait: async () => {},
    now: () => new Date("2026-08-01T12:00:00Z"),
  });
  const response = await handler(new Request("https://dash.test/api/dashboard/28/pdf"), { params: { id: "28" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="dashboard-zaruku-2026-08-01.pdf"');
  assert.deepEqual(calls, [["authorize", "28"], ["http://127.0.0.1:3001", "/dashboard/zaruku"], "close"]);
});

test("combined PDF keeps non-Zaruku dashboard rendering", async () => {
  let renderedPath: string | undefined;
  const page = {
    async setViewport() {}, async emulateMediaType() {},
    async goto(url: string) { renderedPath = new URL(url).pathname; },
    async waitForSelector() {}, async evaluate() {}, async pdf() { return Buffer.from("other pdf"); },
  };
  const handler = createDashboardPdfGetHandler({
    isDashboardAccessAuthorized: (async () => ({ authorized: true, audience: "manager", context: { id: 7, client_id: "gidrofuril", dashboard_type: "awareness", auth_mode: "public" } })) as never,
    launch: (async () => ({ async newPage() { return page; }, async close() {} })) as never,
    wait: async () => {},
    now: () => new Date("2026-08-01T12:00:00Z"),
  });
  const response = await handler(new Request("https://dash.test/api/dashboard/7/pdf"), { params: { id: "7" } });
  assert.equal(response.status, 200);
  assert.equal(renderedPath, "/dashboard/7");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="dashboard-7-2026-08-01.pdf"');
});
