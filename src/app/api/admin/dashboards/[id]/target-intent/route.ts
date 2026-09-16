import pool from "@/lib/db";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieValue,
  verifyAdminSession,
} from "@/lib/access-auth";
import {
  createFilesystemTargetIntentSnapshotStore,
  createGoogleSheetsSnapshotTransport,
  normalizeGoogleSheetsUrl,
  previewTargetIntent,
  publishTargetIntent,
  readTargetIntentState,
  restorePublishedTargetIntent,
  TargetIntentServiceError,
  type TargetIntentScope,
  type TargetIntentSqlConnection,
  type TargetIntentStoreDependencies,
} from "@/lib/site-seo-intent-store";
import { MAX_TARGET_INTENT_UPLOAD_BYTES } from "@/lib/site-seo-intent-import";
import { readTargetIntentObservedQueries, resolveTargetIntentObservedBindings } from "@/lib/site-seo-intent-observed";
import siteRegistry from "../../../../../../../config/sites/registry.json";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ScopeResolution =
  | { status: "ok"; scope: TargetIntentScope }
  | { status: "not_found" }
  | { status: "unsupported" };

type TargetIntentRouteDependencies = {
  verifySession(token: string | null | undefined): { email: string } | null;
  resolveScope(dashboardId: number): Promise<ScopeResolution>;
  readState(scope: TargetIntentScope): Promise<unknown>;
  preview(input: {
    scope: TargetIntentScope;
    actor: string;
    input:
      | { transport: "upload"; filename: string; bytes: Buffer }
      | { transport: "google_sheet"; sourceUrl: string };
  }): Promise<unknown>;
  publish(input: {
    scope: TargetIntentScope;
    actor: string;
    previewId: string;
    label: string;
    operationId: string;
  }): Promise<unknown>;
  restorePublication(input: {
    scope: TargetIntentScope;
    actor: string;
    publicationId: string;
    operationId: string;
  }): Promise<unknown>;
  logFailure(operation: string, dashboardId: number): void;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function dashboardId(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function projectAdminState(value: unknown): unknown {
  const state = record(value);
  if (!state || !Array.isArray(state.previews)) return value;
  return {
    ...state,
    previews: state.previews.map((value) => {
      const preview = record(value);
      if (!preview) return value;
      const summary = { ...preview };
      delete summary.rows;
      return summary;
    }),
  };
}

function exactFields(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

function positiveBodyId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? text : null;
}

function operationBodyId(value: unknown): string | null {
  const id = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)
    ? id
    : null;
}

function isSameOrigin(request: Request): boolean {
  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  try {
    const parsed = new URL(supplied);
    return supplied === parsed.origin && parsed.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function decodeBoundedBase64(value: unknown): Buffer | null {
  const encoded = String(value ?? "").trim();
  const maxEncodedLength = 4 * Math.ceil(MAX_TARGET_INTENT_UPLOAD_BYTES / 3);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    encoded.length > maxEncodedLength ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
  ) return null;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const expectedLength = (encoded.length / 4) * 3 - padding;
  if (expectedLength <= 0 || expectedLength > MAX_TARGET_INTENT_UPLOAD_BYTES) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== expectedLength || bytes.toString("base64") !== encoded) return null;
  return bytes;
}

export function createTargetIntentAdminRouteHandlers(deps: TargetIntentRouteDependencies) {
  type Authorized = { actor: string; dashboardId: number; scope: TargetIntentScope };

  async function authorizeAndResolve(
    request: Request,
    context: RouteContext,
  ): Promise<Authorized | { response: Response }> {
    let actor: string | null = null;
    try {
      actor = deps.verifySession(parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE))?.email ?? null;
    } catch {
      actor = null;
    }
    if (!actor) return { response: json({ error: "Требуется авторизация" }, 401) } as const;
    const { id } = await Promise.resolve(context.params);
    const parsedDashboardId = dashboardId(id);
    if (parsedDashboardId === null) {
      return { response: json({ error: "Некорректный идентификатор дашборда" }, 400) } as const;
    }
    const resolution = await deps.resolveScope(parsedDashboardId);
    if (resolution.status === "not_found") {
      return { response: json({ error: "Дашборд не найден" }, 404) } as const;
    }
    if (resolution.status === "unsupported") {
      return { response: json({ error: "Целевой интент доступен только для SEO-дашбордов" }, 400) } as const;
    }
    return { actor: actor.trim().toLocaleLowerCase("en-US"), dashboardId: parsedDashboardId, scope: resolution.scope } as const;
  }

  async function execute(
    operation: string,
    request: Request,
    context: RouteContext,
    action: (authorized: { actor: string; dashboardId: number; scope: TargetIntentScope }) => Promise<Response>,
    mutation = false,
  ): Promise<Response> {
    let parsedId = -1;
    try {
      const authorized = await authorizeAndResolve(request, context);
      if ("response" in authorized) return authorized.response;
      parsedId = authorized.dashboardId;
      if (mutation && !isSameOrigin(request)) {
        return json({ error: "Недопустимый источник запроса" }, 403);
      }
      return await action(authorized);
    } catch (error) {
      if (error instanceof TargetIntentServiceError) {
        return json({ error: error.message }, error.status);
      }
      deps.logFailure(operation, parsedId);
      return json({ error: "Не удалось выполнить операцию с целевым интентом" }, 500);
    }
  }

  const GET = (request: Request, context: RouteContext) => execute(
    "target_intent_get_failed",
    request,
    context,
    async ({ scope }) => {
      if (new URL(request.url).searchParams.get("view") === "capability") {
        return json({ supported: true }, 200);
      }
      return json(projectAdminState(await deps.readState(scope)), 200);
    },
  );

  const preview = (request: Request, context: RouteContext) => execute(
    "target_intent_preview_failed",
    request,
    context,
    async ({ actor, scope }) => {
      const body = record(await request.json().catch(() => null));
      if (!body) return json({ error: "Некорректное тело запроса" }, 400);
      if (body.transport === "upload") {
        if (!exactFields(body, ["transport", "filename", "content_base64"])) {
          return json({ error: "Запрос содержит недопустимые поля" }, 400);
        }
        const filename = String(body.filename ?? "").trim();
        const bytes = decodeBoundedBase64(body.content_base64);
        if (!filename || filename.length > 255 || !bytes) {
          return json({ error: "Некорректный файл" }, 400);
        }
        return json(await deps.preview({ scope, actor, input: { transport: "upload", filename, bytes } }), 200);
      }
      if (body.transport === "google_sheet") {
        if (!exactFields(body, ["transport", "source_url"])) {
          return json({ error: "Запрос содержит недопустимые поля" }, 400);
        }
        let sourceUrl: string;
        try {
          sourceUrl = normalizeGoogleSheetsUrl(String(body.source_url ?? "").trim());
        } catch {
          return json({ error: "Некорректная ссылка Google Sheets" }, 400);
        }
        return json(await deps.preview({ scope, actor, input: { transport: "google_sheet", sourceUrl } }), 200);
      }
      return json({ error: "Неизвестный способ загрузки" }, 400);
    },
    true,
  );

  const publish = (request: Request, context: RouteContext) => execute(
    "target_intent_publish_failed",
    request,
    context,
    async ({ actor, scope }) => {
      const body = record(await request.json().catch(() => null));
      if (!body || !exactFields(body, ["preview_id", "label", "operation_id"])) {
        return json({ error: "Запрос содержит недопустимые поля" }, 400);
      }
      const previewId = positiveBodyId(body.preview_id);
      const label = String(body.label ?? "").trim();
      const operationId = operationBodyId(body.operation_id);
      if (!previewId || !label || label.length > 191 || !operationId) {
        return json({ error: "Некорректные параметры публикации" }, 400);
      }
      return json(await deps.publish({ scope, actor, previewId, label, operationId }), 200);
    },
    true,
  );

  const restore = (request: Request, context: RouteContext) => execute(
    "target_intent_restore_failed",
    request,
    context,
    async ({ actor, scope }) => {
      const body = record(await request.json().catch(() => null));
      if (!body || !exactFields(body, ["publication_id", "operation_id"])) {
        return json({ error: "Запрос содержит недопустимые поля" }, 400);
      }
      const publicationId = positiveBodyId(body.publication_id);
      const operationId = operationBodyId(body.operation_id);
      if (!publicationId || !operationId) return json({ error: "Некорректная публикация" }, 400);
      return json(await deps.restorePublication({ scope, actor, publicationId, operationId }), 200);
    },
    true,
  );

  return { GET, preview, publish, restore };
}

type RegistryEntry = {
  profile?: { siteId?: unknown; clientId?: unknown; dashboardId?: unknown };
};

async function resolveProductionScope(id: number): Promise<ScopeResolution> {
  const [rows] = await pool.execute(
    `SELECT client_id, dashboard_type
       FROM dashboards
      WHERE id = ? AND is_active = TRUE
      LIMIT 1`,
    [id],
  );
  const row = Array.isArray(rows) ? rows[0] as { client_id?: unknown; dashboard_type?: unknown } | undefined : undefined;
  if (!row) return { status: "not_found" };
  if (row.dashboard_type !== "site_seo") return { status: "unsupported" };
  const registration = (siteRegistry as readonly RegistryEntry[]).find(({ profile }) =>
    profile?.dashboardId === id && profile?.clientId === row.client_id,
  );
  const siteId = String(registration?.profile?.siteId ?? "").trim();
  const clientId = String(row.client_id ?? "").trim();
  if (!siteId || !clientId) return { status: "unsupported" };
  return { status: "ok", scope: { siteId, clientId, dashboardId: id } };
}

function storeDependencies(scope: TargetIntentScope): TargetIntentStoreDependencies {
  const directory = String(process.env.SITE_SEO_INTENT_SPOOL_DIR ?? "").trim();
  return {
    scope,
    database: {
      getConnection: async () => await pool.getConnection() as unknown as TargetIntentSqlConnection,
    },
    snapshots: {
      save: (bytes, evidence) =>
        createFilesystemTargetIntentSnapshotStore(directory).save(bytes, evidence),
    },
    googleSheets: createGoogleSheetsSnapshotTransport(),
    observedQueries: (rows) => readTargetIntentObservedQueries({
      execute: (sql, params) => pool.execute(sql, params as never[]),
    }, scope, rows, resolveTargetIntentObservedBindings(siteRegistry, scope)),
  };
}

export const targetIntentAdminHandlers = createTargetIntentAdminRouteHandlers({
  verifySession: verifyAdminSession,
  resolveScope: resolveProductionScope,
  readState: (scope) => readTargetIntentState(storeDependencies(scope)),
  preview: ({ scope, actor, input }) => previewTargetIntent({ ...input, actor }, storeDependencies(scope)),
  publish: ({ scope, actor, previewId, label, operationId }) =>
    publishTargetIntent(previewId, label, actor, storeDependencies(scope), operationId),
  restorePublication: ({ scope, actor, publicationId, operationId }) =>
    restorePublishedTargetIntent(publicationId, actor, storeDependencies(scope), operationId),
  logFailure: (operation, id) => console.error(operation, id),
});

export const GET = targetIntentAdminHandlers.GET;
