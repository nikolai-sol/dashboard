import assert from "node:assert/strict";
import { format } from "node:util";
import test, { mock } from "node:test";
import { verifyViewerSession } from "@/lib/access-auth";
import { buildAbbottDashboardUrl, createAuthorizedViewerExportToken, createAbbottPdfHandler } from "../../../../../lib/abbott-pdf-handler";
import { GET } from "./route";

const context = { id:18, client_id:"abbott", dashboard_type:"abbott_bi", auth_mode:"password_only" as const,
  client_name:"Abbott", dashboard_name:"Abbott BI", is_active:true, access_users_count:0 };
const access = (audience: "manager" | "embed" = "manager") => ({
  context, authorized:true as const, reason:"authorized" as const, audience,
  credentialVersion: audience === "manager" ? 7 : undefined,
  payload: {type: "viewer" as const, dashboard_id: 18, audience, exp: 9999999999},
});

test("route exports GET and PDF URLs preserve alias, dates, comparison, embed and authorized token on Abbott port", () => {
  assert.equal(typeof GET, "function");
  for (const id of ["18", "abbott"]) {
    const request = new Request("https://example.test/api/dashboard/18/pdf?from=2026-09-01&to=2026-09-13");
    assert.equal(buildAbbottDashboardUrl(request,id,"signed-export-token",{}),
      `http://127.0.0.1:3004/dashboard/${id}?pdf=true&from=2026-09-01&to=2026-09-13&access_token=signed-export-token`);
    const url = new URL(buildAbbottDashboardUrl(new Request(request.url+"&compare_from=2026-08-01&compare_to=2026-08-13&embed_key=key%2Bvalue&access_token=untrusted"), id,"signed",{INTERNAL_BASE_URL:"http://127.0.0.1:3001"}));
    assert.equal(url.origin,"http://127.0.0.1:3004");
    assert.equal(url.searchParams.get("embed_key"),"key+value");
    assert.equal(url.searchParams.get("compare_from"),"2026-08-01");
    assert.equal(url.searchParams.get("compare_to"),"2026-08-13");
    assert.equal(url.searchParams.get("access_token"),"signed");
  }
  assert.throws(()=>buildAbbottDashboardUrl(new Request("https://example.test"),"28","token",{}),/Dashboard not found/);
});

test("export token retains validated manager credential version and embed audience", () => {
  for(const audience of ["manager","embed"] as const) {
    const token = createAuthorizedViewerExportToken(access(audience));
    const payload = verifyViewerSession(token,18);
    assert.equal(payload?.audience,audience);
    assert.equal(payload?.credential_version,audience==="manager"?7:undefined);
  }
  assert.equal(createAuthorizedViewerExportToken({...access(),context:{...context,auth_mode:"public"}}),undefined);
});

function browserFixture(failAt?: string, failure: unknown = new Error("private browser failure")) {
  const calls: Array<[string, unknown]> = [];
  const step = (name:string) => async (...args: unknown[]) => {
    calls.push([name,args]);
    if(failAt===name)throw failure;
    return name==="pdf"?new Uint8Array([37,80,68,70]):undefined;
  };
  const page = {setViewport:step("setViewport"),emulateMediaType:step("emulateMediaType"),goto:step("goto"),
    waitForSelector:step("waitForSelector"),evaluate:step("evaluate"),pdf:step("pdf")};
  const browser = {newPage:async()=>{await step("newPage")();return page;},close:step("close")};
  return {calls,launch:async(...args:unknown[])=>{await step("launch")(...args);return browser;}};
}

test("PDF renders isolated page with existing dimensions and headers, then closes its owned browser", async () => {
  for(const audience of ["manager","embed"] as const) for(const id of ["18","abbott"]) {
    const fixture=browserFixture();
    const handler=createAbbottPdfHandler({authorize:async()=>access(audience),launch:fixture.launch as never,wait:async()=>undefined});
    const response=await handler(new Request("https://example.test/pdf?from=2026-09-01&to=2026-09-13&embed_key=fixture"),{params:{id}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get("X-Abbott-PDF-Failure-Stage"),null);
    assert.equal(response.headers.get("content-type"),"application/pdf");
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.match(response.headers.get("content-disposition")!,new RegExp(`dashboard-${id}-\\d{4}-\\d{2}-\\d{2}\\.pdf`));
    assert.equal(await response.text(),"%PDF");
    const launchOptions=(fixture.calls.find(([name])=>name==="launch")![1] as Record<string,unknown>[])[0];
    assert.equal(launchOptions.headless,"shell");
    assert.equal(launchOptions.executablePath,"/var/lib/dashboard-abbott/browser-cache/chrome-headless-shell/linux-146.0.7680.76/chrome-headless-shell-linux64/chrome-headless-shell");
    assert.equal(launchOptions.pipe,true);
    assert.deepEqual(launchOptions.env,{PATH:"/usr/bin:/bin",LANG:"C.UTF-8"});
    const goto=fixture.calls.find(([name])=>name==="goto")![1] as [string,unknown];
    const url=new URL(goto[0]);
    assert.equal(url.origin,"http://127.0.0.1:3004");
    assert.equal(url.pathname,`/dashboard/${id}`);
    assert.equal(verifyViewerSession(url.searchParams.get("access_token"),18)?.audience,audience);
    assert.equal(url.searchParams.get("embed_key"),"fixture");
    assert.deepEqual(fixture.calls.find(([name])=>name==="setViewport")![1],[{width:1440,height:900,deviceScaleFactor:1}]);
    const options=(fixture.calls.find(([name])=>name==="pdf")![1] as Record<string,unknown>[])[0];
    assert.equal(options.format,"A4");assert.equal(options.landscape,true);assert.equal(options.printBackground,true);
    assert.deepEqual(options.margin,{top:"18mm",right:"12mm",bottom:"18mm",left:"12mm"});
    assert.equal(options.displayHeaderFooter,true);
    assert.deepEqual(fixture.calls.at(-1),["close",[]]);
    assert.equal(fixture.calls.filter(([name])=>name==="close").length,1);
  }
});

test("each failure after launch closes Chromium exactly once; launch failure owns no browser", async (t) => {
  t.after(()=>mock.restoreAll());mock.method(console,"error",()=>undefined);
  for(const stage of ["launch","newPage","setViewport","emulateMediaType","goto","waitForSelector","evaluate","pdf"]) {
    const fixture=browserFixture(stage);
    const handler=createAbbottPdfHandler({authorize:async()=>access(),launch:fixture.launch as never,wait:async()=>undefined});
    const response=await handler(new Request("https://example.test/pdf"),{params:{id:"18"}});
    assert.equal(response.status,500);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.deepEqual(await response.json(),{error:"PDF generation failed"});
    assert.equal(fixture.calls.filter(([name])=>name==="close").length,stage==="launch"?0:1,stage);
  }
});

test("foreign alias or identity and unauthorized access reject before Chromium launch", async () => {
  let authCalls=0;
  const handler=createAbbottPdfHandler({authorize:async()=>{authCalls++;return access();},launch:async()=>assert.fail("must not launch")});
  const foreign=await handler(new Request("https://example.test"),{params:{id:"28"}});
  assert.equal(foreign.status,404);
  assert.equal(foreign.headers.get("X-Abbott-PDF-Failure-Stage"),null);
  assert.equal(authCalls,0);
  for(const [result,status] of [
    [{context:null,authorized:false,reason:"not_found"},404],
    [{context,authorized:false,reason:"auth_required"},401],
    [{...access(),context:{...context,id:28}},404],
    [{...access(),context:{...context,dashboard_type:"other"}},404],
  ] as const) {
    const handler=createAbbottPdfHandler({authorize:async()=>result as never,launch:async()=>assert.fail("must not launch")});
    const response=await handler(new Request("https://example.test"),{params:{id:"18"}});
    assert.equal(response.status,status);
    assert.equal(response.headers.get("X-Abbott-PDF-Failure-Stage"),null);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
  }
});

test("overlapping requests keep their own failure stage on the same handler", async (t) => {
  t.after(()=>mock.restoreAll());mock.method(console,"error",()=>undefined);
  let rejectAuthorization!: (error: Error)=>void;
  const pendingAuthorization=new Promise<never>((_,reject)=>{rejectAuthorization=reject;});
  const fixture=browserFixture("pdf");
  const handler=createAbbottPdfHandler({
    authorize:async(request)=>new URL(request.url).pathname==="/blocked"?pendingAuthorization:access(),
    launch:fixture.launch as never,wait:async()=>undefined,
  });
  const first=handler(new Request("https://example.test/blocked"),{params:{id:"18"}});
  const second=await handler(new Request("https://example.test/render"),{params:{id:"abbott"}});
  rejectAuthorization(new Error("private-secret"));
  assert.equal(second.headers.get("X-Abbott-PDF-Failure-Stage"),"render");
  assert.equal((await first).headers.get("X-Abbott-PDF-Failure-Stage"),"authorize");
});

test("every failure stage is request-local and exposes only fixed header/body/log diagnostics", async (t) => {
  const logs: unknown[][] = [];
  const errorLog = mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  t.after(() => errorLog.mock.restore());
  const signedToken = createAuthorizedViewerExportToken(access())!;
  const incomingToken = "incoming-private-access-token";
  const embedKey = "private-embed-credential";
  const credentialUrl = `http://127.0.0.1:3004/dashboard/18?access_token=${signedToken}&embed_key=${embedKey}`;
  const incomingUrl = `https://example.test/pdf?access_token=${incomingToken}&embed_key=${embedKey}`;
  const failure = new Error(`Navigation failed at ${credentialUrl}`);
  failure.stack = `Error: ${credentialUrl}\n    at navigation (${incomingUrl})`;
  // Even normally diagnostic-looking name/code properties are untrusted.
  failure.name = credentialUrl;
  Object.assign(failure, {
    code: incomingUrl,
    cause: new Error(`Nested failure at ${credentialUrl}; request ${incomingUrl}`),
  });

  for (const thrown of [failure, credentialUrl]) for (const [stage, diagnosticStage] of [
    ["authorize", "authorize"], ["launch", "launch"], ["newPage", "prepare"],
    ["goto", "navigate"], ["waitForSelector", "ready"], ["pdf", "render"],
  ] as const) {
    logs.length = 0;
    const fixture = browserFixture(stage, thrown);
    const handler = createAbbottPdfHandler({
      authorize: async () => { if(stage==="authorize")throw thrown;return access(); },
      launch: fixture.launch as never,
      wait: async () => undefined,
    });
    const response = await handler(new Request(incomingUrl, {
      headers: { authorization: "Bearer private-auth-header", cookie: "private-session-cookie" },
    }), { params: { id: "18" } });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("X-Abbott-PDF-Failure-Stage"), diagnosticStage);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body=await response.json();
    assert.deepEqual(body, { error: "PDF generation failed" });
    assert.equal(fixture.calls.filter(([name]) => name === "close").length, ["authorize","launch"].includes(stage)?0:1);
    const output = logs.map((args) => format(...args)).join("\n")+JSON.stringify([...response.headers])+JSON.stringify(body);
    for (const secret of [signedToken, incomingToken, embedKey, "private-auth-header", "private-session-cookie"]) {
      assert.equal(output.includes(secret), false, "console output must not include credentials");
    }
    assert.doesNotMatch(output, /access_token|embed_key|https?:\/\//);
    assert.deepEqual(logs, [["Abbott PDF generation failed", {
      stage: diagnosticStage,
      error_class: thrown instanceof Error ? "Error" : "NonError",
    }]]);
  }
});
