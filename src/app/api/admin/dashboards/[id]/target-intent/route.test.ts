import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  verifyAdminSession,
} from "@/lib/access-auth";
import { TargetIntentServiceError } from "@/lib/site-seo-intent-store";
import { createTargetIntentAdminRouteHandlers } from "./route";

const scope = { siteId: "site-med", clientId: "client-med", dashboardId: 41 } as const;
const context = { params: Promise.resolve({ id: "41" }) };
const OPERATION_ID = "11111111-1111-4111-8111-111111111111";

function request(
  path: string,
  method = "GET",
  body?: unknown,
  authenticated = true,
  origin: string | null = method === "GET" ? null : "http://localhost",
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(authenticated
        ? { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(createAdminSession("ADMIN@example.test"))}` }
        : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin === null ? {} : { origin }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    verifySession: verifyAdminSession,
    resolveScope: async () => ({ status: "ok" as const, scope }),
    readState: async () => ({ activeVersionId: null, history: [], previews: [] }),
    preview: async () => ({ previewId: "7", state: "valid" }),
    publish: async () => ({ publicationId: "8", versionId: "9", kind: "publish" }),
    restorePublication: async () => ({ publicationId: "10", versionId: "11", kind: "restore" }),
    logFailure: () => {},
    ...overrides,
  };
}

test("GET requires a valid administrator cookie and returns private server-scoped history", async () => {
  let receivedScope: unknown = null;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    readState: async (value: unknown) => {
      receivedScope = value;
      return { activeVersionId: "9", history: [{ versionId: "9", active: true }], previews: [] };
    },
  }));

  const denied = await handlers.GET(
    request("/api/admin/dashboards/41/target-intent", "GET", undefined, false),
    context,
  );
  assert.equal(denied.status, 401);

  const response = await handlers.GET(
    request("/api/admin/dashboards/41/target-intent"),
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(receivedScope, scope);
  assert.deepEqual(await response.json(), {
    activeVersionId: "9",
    history: [{ versionId: "9", active: true }],
    previews: [],
  });
});

test("capability GET resolves protected dashboard scope without reading catalogue state", async () => {
  let reads = 0;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    readState: async () => {
      reads += 1;
      return { activeVersionId: null, history: [], previews: [] };
    },
  }));

  const response = await handlers.GET(
    request("/api/admin/dashboards/41/target-intent?view=capability"),
    context,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { supported: true });
  assert.equal(reads, 0);
});

test("management GET omits historical preview rows while direct preview keeps current rows", async () => {
  const historicalRows = Array.from({ length: 10_000 }, (_, index) => ({
    sourceRowOrdinal: index + 2,
    key: `rule-${index}`,
  }));
  const previewReceipt = {
    previewId: "7",
    state: "valid",
    sourceTransport: "upload",
    sourceIdentity: "intent.csv",
    ruleCount: historicalRows.length,
    duplicateCount: 0,
    conflictCount: 0,
    rows: historicalRows,
    errors: [],
  };
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    readState: async () => ({
      activeVersionId: null,
      history: [],
      previews: [previewReceipt],
    }),
    preview: async () => previewReceipt,
  }));

  const stateResponse = await handlers.GET(
    request("/api/admin/dashboards/41/target-intent"),
    context,
  );
  const state = await stateResponse.json() as { previews: Array<Record<string, unknown>> };
  assert.equal(state.previews[0].ruleCount, 10_000);
  assert.equal("rows" in state.previews[0], false);

  const previewResponse = await handlers.preview(
    request("/api/admin/dashboards/41/target-intent/preview", "POST", {
      transport: "upload",
      filename: "intent.csv",
      content_base64: Buffer.from("Ключ,Тип совпадения\nHER2,точное\n").toString("base64"),
    }),
    context,
  );
  const currentPreview = await previewResponse.json() as { rows: unknown[] };
  assert.equal(currentPreview.rows.length, 10_000);
});

test("every handler rejects a non-positive or non-integer dashboard id before scope resolution", async () => {
  let resolutions = 0;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    resolveScope: async () => {
      resolutions += 1;
      return { status: "ok" as const, scope };
    },
  }));
  const invalidContext = { params: { id: "0" } };

  for (const [handler, path, body] of [
    [handlers.GET, "/api/admin/dashboards/0/target-intent", undefined],
    [handlers.preview, "/api/admin/dashboards/0/target-intent/preview", { transport: "google_sheet", source_url: "https://docs.google.com/spreadsheets/d/x" }],
    [handlers.publish, "/api/admin/dashboards/0/target-intent/publish", { preview_id: "7", label: "Целевой интент", operation_id: OPERATION_ID }],
    [handlers.restore, "/api/admin/dashboards/0/target-intent/restore", { publication_id: "8", operation_id: OPERATION_ID }],
  ] as const) {
    const response = await handler(request(path, body === undefined ? "GET" : "POST", body), invalidContext);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Некорректный идентификатор дашборда" });
  }
  assert.equal(resolutions, 0);
});

test("all operations reject non-site_seo dashboards through server scope resolution", async () => {
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    resolveScope: async () => ({ status: "unsupported" as const }),
  }));

  const response = await handlers.preview(
    request("/api/admin/dashboards/41/target-intent/preview", "POST", {
      transport: "upload",
      filename: "intent.csv",
      content_base64: Buffer.from("Ключ,Тип совпадения\nHER2,точное\n").toString("base64"),
    }),
    context,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Целевой интент доступен только для SEO-дашбордов" });
});

test("preview derives scope and actor server-side and rejects supplied source/platform/version/artifact identities", async () => {
  let received: unknown = null;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    preview: async (input: unknown) => {
      received = input;
      return { previewId: "7", state: "valid" };
    },
  }));
  const bytes = Buffer.from("Ключ,Тип совпадения\nHER2,точное\n");

  for (const forbidden of [
    { site_id: "site-other" },
    { dashboard_id: 999 },
    { source_account_id: "secret-source" },
    { platform_account_id: "secret-platform" },
    { version_id: "foreign-version" },
    { protected_artifact_ref: "/private/foreign" },
  ]) {
    const denied = await handlers.preview(
      request("/api/admin/dashboards/41/target-intent/preview", "POST", {
        transport: "upload", filename: "intent.csv", content_base64: bytes.toString("base64"), ...forbidden,
      }),
      context,
    );
    assert.equal(denied.status, 400);
  }

  const response = await handlers.preview(
    request("/api/admin/dashboards/41/target-intent/preview", "POST", {
      transport: "upload",
      filename: "intent.csv",
      content_base64: bytes.toString("base64"),
    }),
    context,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    scope,
    actor: "admin@example.test",
    input: { transport: "upload", filename: "intent.csv", bytes },
  });
});

test("preview rejects non-Google and credential-bearing Sheets URLs before transport", async () => {
  let calls = 0;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    preview: async () => { calls += 1; return { previewId: "7" }; },
  }));
  for (const source_url of [
    "https://example.test/spreadsheets/d/sheet",
    "https://user:secret@docs.google.com/spreadsheets/d/sheet",
  ]) {
    const response = await handlers.preview(
      request("/api/admin/dashboards/41/target-intent/preview", "POST", {
        transport: "google_sheet",
        source_url,
      }),
      context,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("publish rejects browser-selected version identity and restore resolves a scoped version from publication history", async () => {
  let published: unknown = null;
  let restored: unknown = null;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    publish: async (input: unknown) => {
      published = input;
      return { publicationId: "8", versionId: "9", kind: "publish" };
    },
    restorePublication: async (input: unknown) => {
      restored = input;
      return { publicationId: "10", versionId: "11", kind: "restore" };
    },
  }));

  const deniedPublish = await handlers.publish(
    request("/api/admin/dashboards/41/target-intent/publish", "POST", {
      preview_id: "7", label: "Мед. интент", version_id: "foreign-version",
      operation_id: OPERATION_ID,
    }),
    context,
  );
  assert.equal(deniedPublish.status, 400);
  const deniedRestore = await handlers.restore(
    request("/api/admin/dashboards/41/target-intent/restore", "POST", {
      version_id: "4",
      operation_id: OPERATION_ID,
    }),
    context,
  );
  assert.equal(deniedRestore.status, 400);

  const publishResponse = await handlers.publish(
    request("/api/admin/dashboards/41/target-intent/publish", "POST", {
      preview_id: "7", label: "Мед. интент", operation_id: OPERATION_ID,
    }),
    context,
  );
  const restoreResponse = await handlers.restore(
    request("/api/admin/dashboards/41/target-intent/restore", "POST", {
      publication_id: "8", operation_id: OPERATION_ID,
    }),
    context,
  );
  assert.equal(publishResponse.status, 200);
  assert.equal(restoreResponse.status, 200);
  assert.deepEqual(published, {
    scope, actor: "admin@example.test", previewId: "7", label: "Мед. интент", operationId: OPERATION_ID,
  });
  assert.deepEqual(restored, {
    scope, actor: "admin@example.test", publicationId: "8", operationId: OPERATION_ID,
  });
});

test("cookie-authenticated mutations require an exact same-origin Origin header", async () => {
  let mutations = 0;
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    preview: async () => { mutations += 1; return { previewId: "7" }; },
    publish: async () => { mutations += 1; return { publicationId: "8" }; },
    restorePublication: async () => { mutations += 1; return { publicationId: "9" }; },
  }));
  const cases = [
    [handlers.preview, "/api/admin/dashboards/41/target-intent/preview", {
      transport: "upload", filename: "intent.csv", content_base64: Buffer.from("Ключ,Тип совпадения\nHER2,точное\n").toString("base64"),
    }],
    [handlers.publish, "/api/admin/dashboards/41/target-intent/publish", {
      preview_id: "7", label: "Мед. интент", operation_id: OPERATION_ID,
    }],
    [handlers.restore, "/api/admin/dashboards/41/target-intent/restore", {
      publication_id: "8", operation_id: OPERATION_ID,
    }],
  ] as const;

  for (const [handler, path, body] of cases) {
    for (const origin of [null, "https://evil.example"] as const) {
      const response = await handler(request(path, "POST", body, true, origin), context);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "Недопустимый источник запроса" });
    }
    const accepted = await handler(request(path, "POST", body), context);
    assert.equal(accepted.status, 200);
  }
  assert.equal(mutations, 3);
});

test("publish and restore require a valid browser operation UUID", async () => {
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies());

  for (const [handler, path, body] of [
    [handlers.publish, "/api/admin/dashboards/41/target-intent/publish", { preview_id: "7", label: "Мед. интент" }],
    [handlers.publish, "/api/admin/dashboards/41/target-intent/publish", { preview_id: "7", label: "Мед. интент", operation_id: "not-a-uuid" }],
    [handlers.restore, "/api/admin/dashboards/41/target-intent/restore", { publication_id: "8" }],
    [handlers.restore, "/api/admin/dashboards/41/target-intent/restore", { publication_id: "8", operation_id: "not-a-uuid" }],
  ] as const) {
    const response = await handler(request(path, "POST", body), context);
    assert.equal(response.status, 400);
  }
});

test("unexpected failures are logged without returning database, URL, or protected-path details", async () => {
  const logged: unknown[][] = [];
  const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
    readState: async () => {
      throw new Error("password=secret /protected/private docs.google.com/private database row 9");
    },
    logFailure: (...args: unknown[]) => logged.push(args),
  }));

  const response = await handlers.GET(
    request("/api/admin/dashboards/41/target-intent"),
    context,
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Не удалось выполнить операцию с целевым интентом" });
  assert.deepEqual(logged, [["target_intent_get_failed", 41]]);
});

test("expected publish validation errors retain safe 404, 409, and 422 responses", async () => {
  for (const [status, message] of [
    [404, "Предпросмотр не найден"],
    [409, "Область дашборда изменилась"],
    [422, "Предпросмотр содержит ошибки и не может быть опубликован"],
  ] as const) {
    let logged = false;
    const handlers = createTargetIntentAdminRouteHandlers(baseDependencies({
      publish: async () => { throw new TargetIntentServiceError(status, message); },
      logFailure: () => { logged = true; },
    }));
    const response = await handlers.publish(
      request("/api/admin/dashboards/41/target-intent/publish", "POST", {
        preview_id: "7", label: "Мед. интент", operation_id: OPERATION_ID,
      }),
      context,
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(logged, false);
  }
});
