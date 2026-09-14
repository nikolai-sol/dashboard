import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as dateHelpers from "../../../../src/lib/abbott-date-range";
import { getDashboardI18n } from "../../../../src/lib/dashboard-i18n";

const pageUrl = new URL("./AbbottDashboardPage.tsx", import.meta.url);
const source = () => readFileSync(pageUrl, "utf8");

test("focused page calls only the matching Abbott API alias", () => {
  assert.match(source(), /fetch\(`\/api\/dashboard\/\$\{dashboardId\}/);
  assert.doesNotMatch(source(), /ZarukuSeoDashboard|CampaignDashboard|PerformanceDashboard|MediaPlan|compareRange|selectedBrandId|isDemoMode|generateAiSummary/);
});

test("Abbott header, dashboard, and completed-period handlers retain production markup and bodies", () => {
  const baseline = execFileSync("git", ["show", "8f389a28df1c4b741ec33b7538f0354b74f5a40e:src/app/dashboard/[id]/page.tsx"], { encoding: "utf8" });
  const page = source();
  for (const name of ["resolveInitialAbbottRange", "formatPeriodDate"]) {
    const body = baseline.slice(baseline.indexOf(`function ${name}(`)).split("\n}\n")[0] + "\n}";
    assert.ok(page.includes(body), `${name} must match production`);
  }
  for (const name of ["handleAbbottPresetChange", "applyAbbottCustomRange", "handleAbbottDraftFromChange", "handleAbbottDraftToChange"]) {
    const body = baseline.slice(baseline.indexOf(`  const ${name} =`)).split("\n  };\n")[0] + "\n  };";
    assert.ok(page.includes(body), `${name} must match production`);
  }
  const branch = baseline.slice(baseline.indexOf('if (dashboardType === "abbott_bi" && abbottBiData)'));
  for (const tag of ["DashboardHeader", "AbbottBiDashboard"]) {
    const start = branch.indexOf(`<${tag}`);
    const end = tag === "DashboardHeader" ? branch.indexOf("\n        />", start) + 11 : branch.indexOf("\n          />", start) + 13;
    assert.ok(page.includes(branch.slice(start, end)), `${tag} JSX must match production`);
  }
});

type Element = { type: string; props: Record<string, unknown> };
type ResponseFixture = { status: number; body: unknown };

// Run the real component/effects with controlled React hooks and browser boundaries.
// Child chart rendering is covered by the existing Abbott UI tests.
function harness(id: "18" | "abbott", query: string, replies: ResponseFixture[], now = "2026-08-10T10:00:00Z") {
  const values: unknown[] = [];
  const deps: unknown[][] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  let dirty = true;
  let params = new URLSearchParams(query);
  let root: Element;
  let pending: (() => void)[] = [];
  const requests: string[] = [];
  const urls: string[] = [];
  const router = { replace(url: string) { urls.push(url); params = new URLSearchParams(url.split("?")[1]); dirty = true; } };
  const jsx = (type: string, props: Record<string, unknown>): Element => ({ type, props });
  class FixedDate extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return new Date(now).getTime(); } }
  const datedHelpers = {
    ...dateHelpers,
    defaultAbbottRange: () => dateHelpers.defaultAbbottRange(new Date(now)),
    latestCompletedAbbottDate: () => dateHelpers.latestCompletedAbbottDate(new Date(now)),
    detectAbbottPreset: (range: { from: string; to: string }) => dateHelpers.detectAbbottPreset(range, new Date(now)),
    resolveAbbottPreset: (preset: Parameters<typeof dateHelpers.resolveAbbottPreset>[0]) => dateHelpers.resolveAbbottPreset(preset, new Date(now)),
    normalizeAbbottRequestedRange: (range: { from: string; to: string }) => dateHelpers.normalizeAbbottRequestedRange(range, new Date(now)),
  };
  const react = {
    useState(initial: unknown) {
      const key = cursor++;
      if (!(key in values)) values[key] = typeof initial === "function" ? initial() : initial;
      return [values[key], (next: unknown) => { const value = typeof next === "function" ? next(values[key]) : next; if (!Object.is(value, values[key])) { values[key] = value; dirty = true; } }];
    },
    useMemo(fn: () => unknown) { return fn(); },
    useEffect(fn: () => void | (() => void), next: unknown[]) {
      const key = cursor++;
      if (!deps[key] || next.some((value, i) => !Object.is(value, deps[key][i]))) {
        deps[key] = next;
        pending.push(() => { cleanups[key]?.(); const cleanup = fn(); if (cleanup) cleanups[key] = cleanup; });
      }
    },
  };
  const exports: { default?: (props: { dashboardId: string }) => Element } = {};
  const script = ts.transpileModule(source(), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(script, {
    exports, Date: FixedDate, URLSearchParams, console: { warn() {} },
    fetch: async (url: string) => { requests.push(url); const reply = replies.shift(); assert.ok(reply, `unexpected fetch ${url}`); return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body }; },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return { useRouter: () => router, useSearchParams: () => params };
      if (name === "@/lib/abbott-date-range") return datedHelpers;
      if (name === "@/lib/dashboard-i18n") return { getDashboardI18n };
      if (name === "./AbbottDashboardHeader") return { __esModule: true, default: "DashboardHeader" };
      if (name === "next/link" || name.startsWith("@/components/")) return { __esModule: true, default: name.split("/").pop() };
      throw new Error(`Unexpected client dependency ${name}`);
    },
  });
  return {
    requests, urls,
    async flush() {
      for (let i = 0; i < 30; i++) {
        if (dirty) { dirty = false; cursor = 0; root = exports.default!({ dashboardId: id }); const effects = pending; pending = []; effects.forEach((fn) => fn()); }
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty) return root!;
      }
      throw new Error("Page did not settle");
    },
    find(type: string): Element {
      function visit(value: unknown): Element | undefined {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { for (const child of value) { const match = visit(child); if (match) return match; } return; }
        const element = value as Element;
        if (element.type === type) return element;
        for (const prop of Object.values(element.props ?? {})) { const match = visit(prop); if (match) return match; }
      }
      const result = visit(root!); assert.ok(result, `${type} is rendered`); return result;
    },
  };
}

function validData() {
  return { dashboard: { type: "abbott_bi", language: "ru", client_name: "Abbott", dashboard_name: "Аналитика трафика", period: { from: "2026-08-01", to: "2026-08-09" } }, abbott_bi: { data_quality: { status: "complete" } } };
}

for (const id of ["18", "abbott"] as const) {
  test(`${id} loads matching API and retains PDF, mobile, token, and embed parameters`, async () => {
    const app = harness(id, "from=2026-08-01&to=2026-08-09&access_token=viewer&embed_key=embed&pdf=true&mobile=1", [{ status: 200, body: validData() }]);
    const root = await app.flush();
    assert.equal(root.props["data-dashboard-ready"], "true");
    assert.match(String(root.props.className), /pdf-mode/);
    assert.equal((root.props.style as { maxWidth: string }).maxWidth, "430px");
    assert.equal(app.requests[0], `/api/dashboard/${id}?from=2026-08-01&to=2026-08-09&access_token=viewer&embed_key=embed`);
    assert.equal(app.find("AbbottBiDashboard").props.dashboardId, id);
  });
}

test("401 renders access gate; successful login preserves URL and reloads data", async () => {
  const app = harness("18", "from=2026-08-01&to=2026-08-09&embed_key=embed&pdf=true&mobile=1", [{ status: 401, body: { dashboard: { dashboard_name: "Аналитика трафика", client_name: "Abbott", auth_mode: "password_only" } } }, { status: 200, body: validData() }]);
  assert.equal((await app.flush()).props["data-dashboard-ready"], "false");
  const gate = app.find("DashboardAccessGate");
  assert.equal(gate.props.authMode, "password_only");
  (gate.props.onSuccess as (token: string) => void)("new-viewer");
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  const url = new URL(app.urls.at(-1)!, "http://local");
  for (const [key, expected] of Object.entries({ embed_key: "embed", pdf: "true", mobile: "1", access_token: "new-viewer", from: "2026-08-01", to: "2026-08-09" })) assert.equal(url.searchParams.get(key), expected);
  assert.match(app.requests.at(-1)!, /access_token=new-viewer/);
});

for (const [status, text] of [[404, "Дашборд не найден"], [500, "Извините тех проблемы. мы скоро вернем все на место!"]] as const) {
  test(`${status} uses existing error state and never signals readiness`, async () => {
    const app = harness("abbott", "from=2026-08-01&to=2026-08-09", [{ status, body: {} }]);
    assert.equal((await app.flush()).props["data-dashboard-ready"], "false");
    assert.equal(app.find("h1").props.children, text);
  });
}

test("custom dates preserve URL flags and administrator changes reload the same range", async () => {
  const app = harness("abbott", "from=2026-08-01&to=2026-08-09&access_token=v&embed_key=e&pdf=true&mobile=1", Array.from({ length: 4 }, () => ({ status: 200, body: validData() })));
  await app.flush();
  (app.find("AbbottDatePicker").props.onDraftFromChange as (date: string) => void)("2026-08-02");
  await app.flush();
  (app.find("AbbottDatePicker").props.onApplyCustom as () => void)();
  await app.flush();
  assert.match(app.requests.at(-1)!, /from=2026-08-02&to=2026-08-09/);
  const url = new URL(app.urls.at(-1)!, "http://local");
  for (const key of ["access_token", "embed_key", "pdf", "mobile"]) assert.ok(url.searchParams.has(key));
  (app.find("AbbottBiDashboard").props.onAdminUsersChanged as () => void)();
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  assert.equal(app.requests.length, 4);
  assert.equal(app.requests[0], app.requests[1], "baseline refetches when the preset changes to custom");
  assert.equal(app.requests[2], app.requests[3]);
});

test("non-Abbott successful payload fails closed with technical state", async () => {
  const app = harness("18", "from=2026-08-01&to=2026-08-09", [{ status: 200, body: { dashboard: { type: "awareness" } } }]);
  assert.equal((await app.flush()).props["data-dashboard-ready"], "false");
  assert.equal(app.find("h1").props.children, "Извините тех проблемы. мы скоро вернем все на место!");
});

test("month without completed days retains the empty state without signaling data readiness", async () => {
  const app = harness("abbott", "", [], "2026-08-01T10:00:00Z");
  assert.equal((await app.flush()).props["data-dashboard-ready"], "false");
  assert.equal(app.find("DashboardHeader").props.periodLabel, "Нет завершённых дней");
  assert.equal(app.requests.length, 0);
});

test("loaded historical data followed by an empty current month does not signal readiness", async () => {
  const historical = validData();
  historical.dashboard.period = { from: "2026-07-01", to: "2026-07-31" };
  const app = harness("abbott", "from=2026-07-01&to=2026-07-31", [{ status: 200, body: historical }], "2026-08-01T10:00:00Z");
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  (app.find("AbbottDatePicker").props.onPresetChange as (preset: string) => void)("this_month");
  const root = await app.flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.find("section").props.children, dateHelpers.ABBOTT_NO_COMPLETED_DAYS);
  assert.equal(app.find("section").props.role, "status");
  assert.equal(root.props["data-dashboard-ready"], "false");
});

test("initial future end date normalizes to the latest completed day and preserves URL flags", async () => {
  const app = harness("18", "from=2026-08-01&to=2026-08-15&embed_key=e&pdf=true&mobile=1", Array.from({ length: 2 }, () => ({ status: 200, body: validData() })));
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  assert.ok(app.requests.every((url) => url.includes("to=2026-08-09")));
  const url = new URL(app.urls[0], "http://local");
  assert.equal(url.pathname, "/dashboard/18");
  assert.equal(url.searchParams.get("to"), "2026-08-09");
  for (const key of ["embed_key", "pdf", "mobile"]) assert.ok(url.searchParams.has(key));
});

test("incomplete current preset clamps to contiguous coverage and reloads before rendering", async () => {
  const incomplete = { ...validData(), abbott_bi: { data_quality: { status: "incomplete", blocking_gaps: [{ report_date: "2026-08-08" }] } } };
  const covered = validData();
  covered.dashboard.period.to = "2026-08-07";
  const app = harness("abbott", "from=2026-08-01&to=2026-08-09&access_token=v&embed_key=e&pdf=true&mobile=1", [{ status: 200, body: incomplete }, { status: 200, body: covered }]);
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  assert.equal(app.requests.length, 2);
  assert.match(app.requests[1], /from=2026-08-01&to=2026-08-07/);
  assert.equal(app.find("AbbottBiDashboard").props.periodTo, "2026-08-07");
  assert.equal(app.find("AbbottDatePicker").props.preset, "this_month");
  for (const key of ["access_token", "embed_key", "pdf", "mobile"]) assert.ok(new URL(app.urls[0], "http://local").searchParams.has(key));
});

test("a previous-month preset resolves exact dates and leaves warning rendering to existing Abbott UI", async () => {
  const previous = validData();
  previous.dashboard.period = { from: "2026-07-01", to: "2026-07-31" };
  const app = harness("18", "from=2026-08-01&to=2026-08-09", [{ status: 200, body: validData() }, { status: 200, body: previous }]);
  await app.flush();
  (app.find("AbbottDatePicker").props.onPresetChange as (preset: string) => void)("previous_month");
  assert.equal((await app.flush()).props["data-dashboard-ready"], "true");
  assert.equal(app.requests[1], "/api/dashboard/18?from=2026-07-01&to=2026-07-31");
  assert.equal(app.find("AbbottDatePicker").props.preset, "previous_month");
});
