import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ExcelJS from "exceljs";
import ts from "typescript";
import { createZarukuExcelGetHandler } from "../../../../../lib/zaruku-excel-handler";

const access = { authorized: true, audience: "manager", context: { id: 28, client_id: "zaruku", dashboard_type: "zaruku_bi", auth_mode: "password_only" } };
const data = {
  dashboard: { type: "zaruku_bi", client_name: "Заруку Demo", currency: "RUB", language: "ru", show_spend: false, section_order: [], period: { from: "2026-07-01", to: "2026-07-31" } },
  platforms: [], timeseries: [], plan_vs_fact: [], zaruku_seo: { alice_visibility: { snapshots: [{ period_month: "2026-07" }] } },
};

function legacyHandler(canonicalIdentity = false, calls: unknown[] = []) {
  const source = readFileSync(new URL("../../../../../../../../src/app/api/dashboard/[id]/excel/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const routeModule = { exports: {} as { GET?: (request: Request, context: unknown) => Promise<Response> } };
  const require = createRequire(import.meta.url);
  runInNewContext(compiled, {
    module: routeModule, exports: routeModule.exports, Buffer, console,
    require: (name: string) => {
      if (name === "@/lib/dashboard-access") return { isDashboardAccessAuthorized: async (_request: Request, id: string) => {
        calls.push(["authorize", id]);
        return { ...access, context: { ...access.context, dashboard_type: canonicalIdentity ? "zaruku_bi" : undefined } };
      } };
      if (name === "@/lib/dashboard-data-loader") return { loadDashboardData: async () => { calls.push("legacy-load"); return { data, leads_rows: [] }; } };
      if (name === "@zaruku/compat/api") return {
        ...require(name),
        createZarukuExcelGetHandler: (dependencies: Parameters<typeof createZarukuExcelGetHandler>[0]) => createZarukuExcelGetHandler({
          ...dependencies,
          load: (async (_request: Request, id: string, audience: string) => { calls.push(["zaruku-load", id, audience]); return { data }; }) as never,
        }),
      };
      return require(name);
    },
  });
  return routeModule.exports.GET!;
}

test("combined Excel dispatches a canonical numeric Zaruku alias to its owning loader", async () => {
  const calls: unknown[] = [];
  const response = await legacyHandler(true, calls)(new Request("https://dash.test/api/dashboard/28/excel"), { params: { id: "28" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="Demo_2026-07-01_2026-07-31.xlsx"');
  assert.deepEqual(calls, [["authorize", "28"], ["zaruku-load", "zaruku", "manager"]]);
});

test("the isolated Excel preserves the legacy Zaruku workbook, attachment filename and cache policy", async () => {
  const { createZarukuExcelGetHandler } = await import("../../../../../lib/zaruku-excel-handler");
  const calls: unknown[] = [];
  const request = new Request("https://dash.test/api/dashboard/zaruku/excel?from=2026-07-01&to=2026-07-31");
  const isolated = createZarukuExcelGetHandler({
    authorize: (async () => access) as never,
    load: (async (_request: Request, id: string, audience: string) => { calls.push([id, audience]); return { data }; }) as never,
  });
  const [before, after] = await Promise.all([legacyHandler()(request, { params: { id: "zaruku" } }), isolated(request)]);
  assert.equal(before.status, 200);
  assert.equal(after.status, before.status);
  assert.deepEqual([...after.headers], [...before.headers]);
  assert.equal(after.headers.get("Cache-Control"), "private, no-store");
  assert.equal(after.headers.get("Content-Disposition"), 'attachment; filename="Demo_2026-07-01_2026-07-31.xlsx"');
  const readWorkbook = async (response: Response) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    return { creator: workbook.creator, date1904: workbook.properties.date1904, worksheets: workbook.worksheets.map(sheet => sheet.model) };
  };
  assert.deepEqual(await readWorkbook(after), await readWorkbook(before));
  assert.deepEqual(calls, [["zaruku", "manager"]]);
});

test("Excel fails closed for foreign identities and preserves private authorization/errors", async (t) => {
  t.mock.method(console, "error", () => {});
  const { createZarukuExcelGetHandler } = await import("../../../../../lib/zaruku-excel-handler");
  for (const [identity, authorized, error, status] of [
    [{ ...access.context, client_id: "abbott" }, true, null, 404],
    [{ ...access.context, dashboard_type: "awareness" }, true, null, 404],
    [access.context, false, null, 401],
    [access.context, true, new Error("Dashboard not found"), 404],
    [access.context, true, new Error("private SQL error"), 500],
  ] as const) {
    let loads = 0;
    const handler = createZarukuExcelGetHandler({
      authorize: (async () => ({ ...access, context: identity, authorized })) as never,
      load: (async () => { loads += 1; if (error) throw error; return { data }; }) as never,
    });
    const response = await handler(new Request("https://dash.test/api/dashboard/zaruku/excel"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(loads, error ? 1 : 0);
    assert.doesNotMatch(await response.text(), /private SQL error/);
  }
});
