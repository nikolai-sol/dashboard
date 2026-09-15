import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DashboardTargetIntentAdminState,
  DashboardTargetIntentPreview,
} from "@/lib/admin-ui-types";
import {
  DashboardTargetIntentView,
  TargetIntentRequestError,
  TargetIntentEditNavigationView,
  buildTargetIntentPreviewRequest,
  buildTargetIntentMutationRequest,
  createDashboardTargetIntentState,
  reduceDashboardTargetIntentState,
  requestTargetIntentJson,
  retainTargetIntentOperation,
} from "./DashboardTargetIntentScreen";

const validPreview: DashboardTargetIntentPreview = {
  previewId: "14",
  state: "valid",
  sourceTransport: "upload",
  sourceIdentity: "intent.xlsx",
  sourceIdentityHash: "source-hash",
  contentSha256: "content-hash",
  filename: "intent.xlsx",
  worksheet: "Правила",
  ruleCount: 3,
  duplicateCount: 0,
  conflictCount: 0,
  rows: [
    {
      sourceRowOrdinal: 2,
      key: "рак молочной железы",
      normalizedKey: "рак молочной железы",
      group: "Онкология",
      matchType: "phrase",
    },
    {
      sourceRowOrdinal: 3,
      key: "пертузумаб",
      normalizedKey: "пертузумаб",
      group: "Препараты",
      matchType: "exact",
    },
    {
      sourceRowOrdinal: 4,
      key: "онкология",
      normalizedKey: "онкология",
      group: null,
      matchType: "phrase",
    },
  ],
  errors: [],
  importedBy: "admin@example.test",
  createdAt: "2026-09-15T12:00:00.000Z",
};

const invalidPreview: DashboardTargetIntentPreview = {
  ...validPreview,
  previewId: "15",
  state: "invalid",
  duplicateCount: 1,
  conflictCount: 1,
  errors: [
    {
      row: 5,
      column: "Ключ",
      code: "normalized_duplicate",
      message: "Нормализованный ключ повторяется",
    },
  ],
};

const activeState: DashboardTargetIntentAdminState = {
  activeVersionId: "7",
  previews: [
    {
      ...invalidPreview,
      previewId: "16",
      state: "failed",
      sourceTransport: "google_sheet",
      sourceIdentity: "google-sheet-id#gid=0",
      filename: null,
      ruleCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      rows: [],
      errors: [
        {
          row: null,
          code: "source_unavailable",
          message: "Не удалось получить снимок Google Sheets",
        },
      ],
    },
  ],
  history: [
    {
      publicationId: "19",
      versionId: "7",
      previousVersionId: "6",
      kind: "publish",
      label: "Мед. интент",
      ruleCount: 802,
      sourceTransport: "google_sheet",
      sourceIdentity: "google-sheet-id#gid=0",
      sourceIdentityHash: "source-hash",
      contentSha256: "content-hash",
      importId: "14",
      publishedBy: "admin@example.test",
      publishedAt: "2026-09-15T12:30:00.000Z",
      comment: null,
      active: true,
    },
    {
      publicationId: "18",
      versionId: "6",
      previousVersionId: null,
      kind: "publish",
      label: "Мед. интент",
      ruleCount: 790,
      sourceTransport: "upload",
      sourceIdentity: "intent-v1.xlsx",
      sourceIdentityHash: "previous-source-hash",
      contentSha256: "previous-content-hash",
      importId: "13",
      publishedBy: "editor@example.test",
      publishedAt: "2026-09-08T12:30:00.000Z",
      comment: "Первая версия",
      active: false,
    },
  ],
};

function viewHtml(input: {
  state?: ReturnType<typeof createDashboardTargetIntentState>;
  preview?: DashboardTargetIntentPreview | null;
  label?: string;
  confirmation?: string;
}) {
  const base = input.state ?? createDashboardTargetIntentState();
  return renderToStaticMarkup(
    createElement(DashboardTargetIntentView, {
      dashboardId: "41",
      state: { ...base, preview: input.preview ?? base.preview },
      sourceMode: "upload",
      selectedFilename: "intent.xlsx",
      googleSheetsUrl: "",
      label: input.label ?? "Мед. интент",
      confirmation: input.confirmation ?? "",
      onSourceModeChange() {},
      onFileChange() {},
      onGoogleSheetsUrlChange() {},
      onLabelChange() {},
      onConfirmationChange() {},
      onValidate() {},
      onPublish() {},
      onRequestRestore() {},
      onCancelRestore() {},
      onRestore() {},
    }),
  );
}

test("dashboard edit navigation exposes target intent only for SEO dashboards", () => {
  const seo = renderToStaticMarkup(
    createElement(TargetIntentEditNavigationView, {
      dashboardId: "41",
      status: "seo",
    }),
  );
  assert.match(seo, /href="\/admin\/dashboards\/41\/target-intent"/);
  assert.match(seo, /Целевой интент/);

  const unsupported = renderToStaticMarkup(
    createElement(TargetIntentEditNavigationView, {
      dashboardId: "18",
      status: "unsupported",
    }),
  );
  assert.doesNotMatch(unsupported, /href="\/admin\/dashboards\/18\/target-intent"/);
  assert.match(unsupported, /доступен только для SEO-дашбордов/);

  const editPage = readFileSync(
    path.resolve("src/app/admin/dashboards/[id]/edit/page.tsx"),
    "utf8",
  );
  assert.match(editPage, /DashboardTargetIntentNavigation/);
  assert.match(editPage, /dashboardId=\{id\}/);

  const componentSource = readFileSync(
    path.resolve("src/components/admin/DashboardTargetIntentScreen.tsx"),
    "utf8",
  );
  const navigationSource = componentSource.slice(
    componentSource.indexOf("export function DashboardTargetIntentNavigation"),
    componentSource.indexOf("type DashboardTargetIntentViewProps"),
  );
  assert.match(navigationSource, /\/target-intent/);
  assert.doesNotMatch(navigationSource, /`\/api\/admin\/dashboards\/\$\{dashboardId\}`/);
});

test("source selection renders label, upload, Google Sheets and manual validation", () => {
  const html = viewHtml({});
  assert.match(html, /Целевой интент/);
  assert.match(html, /Название целевой категории/);
  assert.match(html, /Загрузить Excel или CSV/);
  assert.match(html, /Google Sheets/);
  assert.match(html, /Проверить источник/);
  assert.doesNotMatch(html, /setInterval|автообнов/iu);

  const source = readFileSync(
    path.resolve("src/components/admin/DashboardTargetIntentScreen.tsx"),
    "utf8",
  );
  assert.match(source, /file\.size > MAX_TARGET_INTENT_UPLOAD_BYTES/);
  assert.match(source, /await file\.arrayBuffer\(\)/);
  assert.match(source, /content_base64: source\.contentBase64/);
});

test("preview renders totals, groups, sample rules and replacement confirmation", () => {
  const previewReady = reduceDashboardTargetIntentState(
    createDashboardTargetIntentState(),
    { type: "preview-succeeded", preview: validPreview },
  );
  const html = viewHtml({ state: previewReady, preview: validPreview });
  assert.match(html, /Предпросмотр готов/);
  assert.match(html, /Правил/);
  assert.match(html, />3</);
  assert.match(html, /Групп/);
  assert.match(html, />2</);
  assert.match(html, /Дубликатов/);
  assert.match(html, /Конфликтов/);
  assert.match(html, /рак молочной железы/);
  assert.match(html, /Онкология/);
  assert.match(html, /Примеры правил из источника/);
  assert.match(html, /полностью заменит текущий активный каталог/);
  assert.match(html, /ЗАМЕНИТЬ КАТАЛОГ/);
});

test("validation errors are visible and disable publication", () => {
  const previewReady = reduceDashboardTargetIntentState(
    createDashboardTargetIntentState(),
    { type: "preview-succeeded", preview: invalidPreview },
  );
  const html = viewHtml({
    state: previewReady,
    preview: invalidPreview,
    confirmation: "ЗАМЕНИТЬ КАТАЛОГ",
  });
  assert.match(html, /Ошибки проверки/);
  assert.match(html, /Строка 5/);
  assert.match(html, /Нормализованный ключ повторяется/);
  assert.match(html, /Опубликовать новую версию/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Опубликовать новую версию<\/button>/);
});

test("validation and publication lock source controls against overlapping operations", () => {
  const publishing = {
    ...createDashboardTargetIntentState(),
    phase: "publishing" as const,
    loading: false,
    preview: validPreview,
  };
  const html = viewHtml({ state: publishing, preview: validPreview });
  assert.match(html, /data-workflow-state="publishing"/);
  assert.match(html, /<input[^>]*placeholder="Целевой интент"[^>]*disabled=""/);
  assert.match(html, /<input[^>]*type="radio"[^>]*disabled=""/);
  assert.match(html, /<input[^>]*type="file"[^>]*disabled=""/);
});

test("active history offers restore as a new version with typed confirmation", () => {
  let state = reduceDashboardTargetIntentState(createDashboardTargetIntentState(), {
    type: "load-succeeded",
    canonical: activeState,
  });
  let html = viewHtml({ state });
  assert.match(html, /Активная версия/);
  assert.match(html, /Версия 7/);
  assert.match(html, /История публикаций/);
  assert.match(html, /Восстановить как новую версию/);
  assert.match(html, /Первая версия/);
  assert.match(html, /previous-content-hash/);
  assert.match(html, /Публикация/);
  assert.match(html, /Последние проверки источника/);
  assert.match(html, /Проверка не выполнена/);
  assert.match(html, /Не удалось получить снимок Google Sheets/);

  state = reduceDashboardTargetIntentState(state, {
    type: "preview-succeeded",
    preview: validPreview,
  });
  state = reduceDashboardTargetIntentState(state, {
    type: "restore-requested",
    publication: activeState.history[1],
  });
  html = viewHtml({ state });
  assert.equal(state.phase, "restore-confirmation");
  assert.match(html, /Восстановление создаст новую версию/);
  assert.match(html, /полностью заменит текущий активный каталог/);
  assert.match(html, /Версия 6/);
  assert.match(html, /Подтвердить восстановление/);

  html = viewHtml({ state, confirmation: "ЗАМЕНИТЬ КАТАЛОГ" });
  const publishButton = html.match(/<button[^>]*>Опубликовать новую версию<\/button>/)?.[0] ?? "";
  const restoreButton = html.match(/<button[^>]*>Подтвердить восстановление<\/button>/)?.[0] ?? "";
  assert.match(publishButton, /disabled=""/);
  assert.doesNotMatch(restoreButton, /disabled=""/);
});

test("state machine names every workflow phase and retains active state on errors", () => {
  let state = reduceDashboardTargetIntentState(createDashboardTargetIntentState(), {
    type: "load-succeeded",
    canonical: activeState,
  });
  assert.equal(state.phase, "active");

  state = reduceDashboardTargetIntentState(state, { type: "preview-started" });
  assert.equal(state.phase, "validating");
  state = reduceDashboardTargetIntentState(state, {
    type: "preview-succeeded",
    preview: validPreview,
  });
  assert.equal(state.phase, "preview-ready");
  state = reduceDashboardTargetIntentState(state, { type: "publish-started" });
  assert.equal(state.phase, "publishing");
  state = reduceDashboardTargetIntentState(state, {
    type: "operation-failed",
    error: "Не удалось опубликовать каталог",
  });
  assert.equal(state.phase, "failed");
  assert.equal(state.canonical?.activeVersionId, "7");
  assert.equal(state.preview?.previewId, "14");

  state = reduceDashboardTargetIntentState(state, {
    type: "restore-requested",
    publication: activeState.history[1],
  });
  assert.equal(state.phase, "restore-confirmation");
  assert.equal(state.canonical?.activeVersionId, "7");

  const source = reduceDashboardTargetIntentState(state, { type: "reset-source" });
  assert.equal(source.phase, "source");
  assert.equal(source.canonical?.activeVersionId, "7");
});

test("editing a source invalidates its immutable preview but preserves loaded active state", () => {
  let state = reduceDashboardTargetIntentState(createDashboardTargetIntentState(), {
    type: "load-succeeded",
    canonical: activeState,
  });
  state = reduceDashboardTargetIntentState(state, {
    type: "preview-succeeded",
    preview: validPreview,
  });
  state = reduceDashboardTargetIntentState(state, { type: "source-edited" });
  assert.equal(state.phase, "source");
  assert.equal(state.preview, null);
  assert.equal(state.canonical?.activeVersionId, "7");

  const source = readFileSync(
    path.resolve("src/components/admin/DashboardTargetIntentScreen.tsx"),
    "utf8",
  );
  const fileHandler = source.slice(source.indexOf("function onFileChange"), source.indexOf("async function validateSource"));
  assert.match(fileHandler, /source-edited/);
  assert.match(source, /onGoogleSheetsUrlChange=\{[\s\S]*?source-edited/);
});

test("a failed initial load does not claim that no active catalogue exists", () => {
  const failed = reduceDashboardTargetIntentState(createDashboardTargetIntentState(), {
    type: "operation-failed",
    error: "Не удалось загрузить состояние целевого интента",
  });
  const html = viewHtml({ state: failed });
  assert.match(html, /Не удалось загрузить состояние целевого интента/);
  assert.doesNotMatch(html, /Активный каталог пока не опубликован/);
});

test("an acknowledged mutation with a failed refresh never shows stale active state as current", () => {
  const loaded = reduceDashboardTargetIntentState(createDashboardTargetIntentState(), {
    type: "load-succeeded",
    canonical: activeState,
  });
  const failedRefresh = reduceDashboardTargetIntentState(loaded, {
    type: "refresh-failed-after-success",
    message: "Новая версия опубликована",
  });
  const html = viewHtml({ state: failedRefresh });
  assert.equal(failedRefresh.canonical, null);
  assert.match(html, /Новая версия опубликована/);
  assert.match(html, /обновите страницу/iu);
  assert.doesNotMatch(html, /Текущая активная версия не изменена/);
});

test("ambiguous retries retain one operation id until the user changes intent", () => {
  let created = 0;
  const createId = () => `operation-${++created}`;
  const first = retainTargetIntentOperation(null, "publish", "preview:14|label:Мед. интент", createId);
  const retry = retainTargetIntentOperation(first, "publish", "preview:14|label:Мед. интент", createId);
  const changedLabel = retainTargetIntentOperation(retry, "publish", "preview:14|label:Другой интент", createId);
  const restore = retainTargetIntentOperation(changedLabel, "restore", "publication:18", createId);

  assert.equal(retry.id, first.id);
  assert.notEqual(changedLabel.id, first.id);
  assert.notEqual(restore.id, changedLabel.id);
  assert.equal(created, 3);
});

test("mutation request builders send only scoped Task 2 identifiers and one operation id", () => {
  const publish = buildTargetIntentMutationRequest("41", {
    kind: "publish",
    previewId: "14",
    label: "Мед. интент",
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(publish.url, "/api/admin/dashboards/41/target-intent/publish");
  assert.deepEqual(JSON.parse(String(publish.init.body)), {
    preview_id: "14",
    label: "Мед. интент",
    operation_id: "11111111-1111-4111-8111-111111111111",
  });

  const restore = buildTargetIntentMutationRequest("41", {
    kind: "restore",
    publicationId: "18",
    operationId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(restore.url, "/api/admin/dashboards/41/target-intent/restore");
  assert.deepEqual(JSON.parse(String(restore.init.body)), {
    publication_id: "18",
    operation_id: "22222222-2222-4222-8222-222222222222",
  });
  assert.doesNotMatch(String(publish.init.body) + String(restore.init.body), /site_id|version_id|artifact/);
});

test("preview request builders match both Task 2 transport contracts", () => {
  const upload = buildTargetIntentPreviewRequest("41", {
    transport: "upload",
    filename: "intent.xlsx",
    contentBase64: "UEsDBA==",
  });
  assert.equal(upload.url, "/api/admin/dashboards/41/target-intent/preview");
  assert.deepEqual(JSON.parse(String(upload.init.body)), {
    transport: "upload",
    filename: "intent.xlsx",
    content_base64: "UEsDBA==",
  });

  const googleSheet = buildTargetIntentPreviewRequest("41", {
    transport: "google_sheet",
    sourceUrl: "https://docs.google.com/spreadsheets/d/example/edit#gid=0",
  });
  assert.deepEqual(JSON.parse(String(googleSheet.init.body)), {
    transport: "google_sheet",
    source_url: "https://docs.google.com/spreadsheets/d/example/edit#gid=0",
  });
  assert.doesNotMatch(String(upload.init.body) + String(googleSheet.init.body), /site_id|version_id|artifact/);
});

test("request helper distinguishes a rejected mutation from an ambiguous network result", async () => {
  await assert.rejects(
    () => requestTargetIntentJson(
      async () => Response.json({ error: "Предпросмотр не найден" }, { status: 404 }),
      "/publish",
      { method: "POST" },
      "Не удалось опубликовать каталог",
    ),
    (error) => error instanceof TargetIntentRequestError && error.outcome === "rejected",
  );
  await assert.rejects(
    () => requestTargetIntentJson(
      async () => { throw new Error("socket closed after write"); },
      "/publish",
      { method: "POST" },
      "Не удалось опубликовать каталог",
    ),
    (error) => error instanceof TargetIntentRequestError && error.outcome === "unknown",
  );
  await assert.rejects(
    () => requestTargetIntentJson(
      async () => Response.json({ error: "Gateway timeout" }, { status: 504 }),
      "/publish",
      { method: "POST" },
      "Не удалось опубликовать каталог",
    ),
    (error) => error instanceof TargetIntentRequestError && error.outcome === "unknown",
  );
});
