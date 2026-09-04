import assert from "node:assert/strict";
import test from "node:test";
import { verifyViewerSession } from "@/lib/access-auth";
import { createZarukuPdfGetHandler } from "../../../../../lib/zaruku-pdf-handler";

const context = { id: 28, client_id: "zaruku", dashboard_type: "zaruku_bi", auth_mode: "password_only" };

test("isolated PDF rejects foreign identity and unauthenticated access before browser launch", async () => {
  const calls: string[] = [];
  for (const [access, status] of [[{ authorized: true, audience: "manager", context: { ...context, client_id: "abbott" } }, 404], [{ authorized: true, audience: "manager", context: { ...context, dashboard_type: "awareness" } }, 404], [{ authorized: false, context }, 401]] as const) {
    const handler = createZarukuPdfGetHandler({
      authorize: (async () => access) as never,
      launch: (async () => { calls.push("launch"); throw new Error("must not launch"); }) as never,
    });
    const response = await handler(new Request("https://dash.test/api/dashboard/zaruku/pdf"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.deepEqual(calls, []);
});

test("isolated PDF preserves rendering options, query filters, token audience/version, filename, and cleanup", async () => {
  for (const audience of ["manager", "embed"] as const) {
    const calls: [string, ...unknown[]][] = [];
    const page = {
      async setViewport(options: unknown) { calls.push(["viewport", options]); },
      async emulateMediaType(media: string) { calls.push(["media", media]); },
      async goto(url: string, options: unknown) { calls.push(["goto", url, options]); },
      async waitForSelector(selector: string, options: unknown) { calls.push(["ready", selector, options]); },
      async evaluate() { calls.push(["fonts"]); },
      async pdf(options: unknown) { calls.push(["pdf", options]); return Buffer.from("pdf fixture"); },
    };
    const handler = createZarukuPdfGetHandler({
      authorize: (async (_request: Request, id: string) => { calls.push(["authorize", id]); return { authorized: true, audience, context, credentialVersion: audience === "manager" ? 7 : undefined }; }) as never,
      launch: (async (options: unknown) => { calls.push(["launch", options]); return { async newPage() { return page; }, async close() { calls.push(["close"]); } }; }) as never,
      wait: async (milliseconds: number) => { calls.push(["wait", milliseconds]); },
      now: () => new Date("2026-08-01T12:00:00Z"),
    });
    const response = await handler(new Request("https://dash.test/api/dashboard/zaruku/pdf?from=2026-07-01&to=2026-07-31&compare_from=2026-06-01&compare_to=2026-06-30&embed_key=embed-fixture&client_id=abbott"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="dashboard-zaruku-2026-08-01.pdf"');
    assert.equal(await response.text(), "pdf fixture");
    const target = new URL(String(calls.find(([name]) => name === "goto")?.[1]));
    assert.equal(target.origin, "http://127.0.0.1:3002");
    assert.equal(target.pathname, "/dashboard/zaruku");
    assert.deepEqual(Object.fromEntries([...target.searchParams].filter(([key]) => key !== "access_token")), { pdf: "true", from: "2026-07-01", to: "2026-07-31", compare_from: "2026-06-01", compare_to: "2026-06-30", embed_key: "embed-fixture" });
    const token = verifyViewerSession(target.searchParams.get("access_token"), 28);
    assert.equal(token?.audience, audience);
    assert.equal(token?.credential_version, audience === "manager" ? 7 : undefined);
    assert.deepEqual(calls.find(([name]) => name === "viewport")?.[1], { width: 1440, height: 900, deviceScaleFactor: 1 });
    assert.deepEqual(calls.find(([name]) => name === "goto")?.[2], { waitUntil: "networkidle0", timeout: 30000 });
    assert.deepEqual(calls.find(([name]) => name === "ready")?.slice(1), ["[data-dashboard-ready='true']", { timeout: 30000 }]);
    assert.deepEqual(calls.find(([name]) => name === "wait"), ["wait", 1200]);
    const options = calls.find(([name]) => name === "pdf")?.[1] as Record<string, unknown>;
    assert.equal(options.format, "A4");
    assert.equal(options.landscape, true);
    assert.equal(options.printBackground, true);
    assert.equal(options.displayHeaderFooter, true);
    assert.deepEqual(options.margin, { top: "18mm", right: "12mm", bottom: "18mm", left: "12mm" });
    assert.match(String(options.headerTemplate), /ReportingDash/);
    assert.match(String(options.footerTemplate), /01\.08\.2026/);
    assert.deepEqual(calls.at(-1), ["close"]);
  }
});

test("isolated PDF accepts the explicit combined-runtime origin without changing its slug", async () => {
  let target: URL | undefined;
  const page = {
    async setViewport() {}, async emulateMediaType() {}, async waitForSelector() {}, async evaluate() {},
    async goto(url: string) { target = new URL(url); }, async pdf() { return Buffer.from("pdf fixture"); },
  };
  const handler = createZarukuPdfGetHandler({
    authorize: (async () => ({ authorized: true, audience: "manager", context })) as never,
    launch: (async () => ({ async newPage() { return page; }, async close() {} })) as never,
    wait: async () => {},
    baseUrl: "http://127.0.0.1:3001",
  });
  const response = await handler(new Request("https://dash.test/api/dashboard/zaruku/pdf"));
  assert.equal(response.status, 200);
  assert.equal(target?.origin, "http://127.0.0.1:3001");
  assert.equal(target?.pathname, "/dashboard/zaruku");
});

test("isolated PDF sanitizes failures and closes a launched browser", async (t) => {
  t.mock.method(console, "error", () => {});
  let closed = false;
  const handler = createZarukuPdfGetHandler({
    authorize: (async () => ({ authorized: true, audience: "manager", context })) as never,
    launch: (async () => ({ async newPage() { throw new Error("private browser details"); }, async close() { closed = true; } })) as never,
  });
  const response = await handler(new Request("https://dash.test/api/dashboard/zaruku/pdf"));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "PDF generation failed" });
  assert.equal(closed, true);
});
