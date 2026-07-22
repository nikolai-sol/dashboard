import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createSharedPasswordSettingsState,
  requestSharedPassword,
  reduceSharedPasswordSettingsState,
  runWithSavingNotification,
  sharedPasswordStatusText,
  validateSharedPasswordFields,
} from "./SharedPasswordSettings";
import {
  createAccessUsersEditorReadiness,
  isAccessUsersEditorReady,
  parseAccessUsersPayload,
  reduceAccessUsersEditorReadiness,
} from "./AdminAccessSettings";

test("shared password form is secret-safe and Russian", () => {
  const source = readFileSync(
    path.resolve("src/components/admin/SharedPasswordSettings.tsx"),
    "utf8",
  );
  assert.match(source, /Пароль доступа/);
  assert.match(source, /Новый пароль/);
  assert.match(source, /Повторите пароль/);
  assert.match(source, /Сменить пароль/);
  assert.match(source, /type="password"/);
  assert.doesNotMatch(source, /current_password|password_hash/);
});

test("settings selects shared form only for Abbott and Zaruku", () => {
  const source = readFileSync(
    path.resolve("src/components/admin/AdminAccessSettings.tsx"),
    "utf8",
  );
  assert.match(source, /isSharedPasswordClient\(selectedDashboard\.client_id\)/);
  assert.match(source, /<SharedPasswordSettings/);
  assert.match(source, /Access users/);
});

test("client validation rejects mismatches and passwords shorter than ten characters", () => {
  assert.equal(
    validateSharedPasswordFields("0123456789", "012345678X"),
    "Пароли не совпадают",
  );
  assert.equal(
    validateSharedPasswordFields("123456789", "123456789"),
    "Пароль должен содержать не менее 10 символов",
  );
  assert.equal(validateSharedPasswordFields("0123456789", "0123456789"), null);
});

test("dashboard changes clear password inputs and stale status cannot overwrite the selection", () => {
  const previous = {
    ...createSharedPasswordSettingsState(28),
    configured: true,
    loading: false,
    newPassword: "old-dashboard-password",
    confirmation: "old-dashboard-password",
  };
  const changed = reduceSharedPasswordSettingsState(previous, {
    type: "dashboard-changed",
    dashboardId: 29,
  });

  assert.equal(changed.dashboardId, 29);
  assert.equal(changed.newPassword, "");
  assert.equal(changed.confirmation, "");
  assert.equal(changed.configured, null);
  assert.equal(changed.loading, true);
  assert.equal(
    reduceSharedPasswordSettingsState(changed, {
      type: "status-loaded",
      dashboardId: 28,
      configured: true,
    }),
    changed,
  );
});

test("successful rotation clears both inputs while a failed rotation preserves them", () => {
  const editing = {
    ...createSharedPasswordSettingsState(28),
    loading: false,
    newPassword: "replacement-password",
    confirmation: "replacement-password",
  };
  const failed = reduceSharedPasswordSettingsState(editing, {
    type: "save-failed",
    dashboardId: 28,
    error: "Не удалось сохранить пароль",
  });

  assert.equal(failed.newPassword, "replacement-password");
  assert.equal(failed.confirmation, "replacement-password");
  assert.equal(failed.error, "Не удалось сохранить пароль");

  const saved = reduceSharedPasswordSettingsState(editing, {
    type: "save-succeeded",
    dashboardId: 28,
  });
  assert.equal(saved.newPassword, "");
  assert.equal(saved.confirmation, "");
  assert.equal(saved.configured, true);
  assert.equal(saved.message, "Пароль изменён. Предыдущие пользовательские сессии закрыты.");
});

test("shared-password status is explicitly unknown after a failed GET", () => {
  assert.equal(
    sharedPasswordStatusText({ loading: false, configured: null }),
    "Статус пароля неизвестен",
  );
  assert.equal(
    sharedPasswordStatusText({ loading: false, configured: false }),
    "Пароль ещё не перенесён в защищённое хранилище",
  );
});

test("shared-password requests hide network and invalid JSON error details", async () => {
  const fallback = "Не удалось загрузить статус пароля";
  const networkFailure = await requestSharedPassword(
    async () => {
      throw new Error("socket failed: password=secret host=internal-db");
    },
    "/shared-password",
    { method: "GET" },
    fallback,
  );
  const invalidJson = await requestSharedPassword(
    async () => new Response("upstream leaked an internal stack", { status: 500 }),
    "/shared-password",
    { method: "GET" },
    fallback,
  );
  const emptyJson = await requestSharedPassword(
    async () => Response.json({}, { status: 200 }),
    "/shared-password",
    { method: "GET" },
    fallback,
  );

  assert.deepEqual(networkFailure, { ok: false, error: fallback });
  assert.deepEqual(invalidJson, { ok: false, error: fallback });
  assert.deepEqual(emptyJson, { ok: false, error: fallback });
});

test("shared-password requests preserve a safe Russian API error", async () => {
  const result = await requestSharedPassword(
    async () =>
      Response.json(
        { error: "Дашборд не найден" },
        { status: 404 },
      ),
    "/shared-password",
    { method: "GET" },
    "Не удалось загрузить статус пароля",
  );

  assert.deepEqual(result, { ok: false, error: "Дашборд не найден" });

  const validationError = await requestSharedPassword(
    async () =>
      Response.json(
        { error: "Пароль слишком длинный" },
        { status: 400 },
      ),
    "/shared-password",
    { method: "PUT" },
    "Не удалось сохранить пароль",
  );
  assert.deepEqual(validationError, {
    ok: false,
    error: "Пароль слишком длинный",
  });

  const unsafeMixedError = await requestSharedPassword(
    async () =>
      Response.json(
        { error: "Дашборд не найден. Секретный пароль внутри" },
        { status: 500 },
      ),
    "/shared-password",
    { method: "GET" },
    "Не удалось загрузить статус пароля",
  );
  assert.deepEqual(unsafeMixedError, {
    ok: false,
    error: "Не удалось загрузить статус пароля",
  });
});

test("ordinary access editor stays disabled until its selected dashboard loads", () => {
  const source = readFileSync(
    path.resolve("src/components/admin/AdminAccessSettings.tsx"),
    "utf8",
  );
  let readiness = createAccessUsersEditorReadiness();
  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-started",
    dashboardId: 41,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 41), false);

  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-failed",
    dashboardId: 41,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 41), false);

  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-started",
    dashboardId: 42,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 42), false);
  assert.equal(
    reduceAccessUsersEditorReadiness(readiness, {
      type: "load-succeeded",
      dashboardId: 41,
    }),
    readiness,
  );

  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-succeeded",
    dashboardId: 42,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 42), true);
  assert.match(
    source,
    /disabled=\{saving \|\| !selectedDashboardId \|\| !accessUsersReady\}/,
  );
});

test("malformed ordinary access-user payloads remain failed and non-destructive", () => {
  const fallback = "Не удалось загрузить пользователей доступа";
  assert.deepEqual(parseAccessUsersPayload({}), {
    ok: false,
    error: fallback,
  });
  assert.deepEqual(parseAccessUsersPayload({ users: null }), {
    ok: false,
    error: fallback,
  });
  for (const email of ["", "   "]) {
    assert.deepEqual(parseAccessUsersPayload({ users: [{ id: 7, email }] }), {
      ok: false,
      error: fallback,
    });
  }
  assert.deepEqual(
    parseAccessUsersPayload({ users: [{ id: 7, email: " Viewer@Example.Test " }] }),
    {
      ok: true,
      users: [{ id: 7, email: "viewer@example.test", password: "" }],
    },
  );

  let readiness = reduceAccessUsersEditorReadiness(
    createAccessUsersEditorReadiness(),
    { type: "load-started", dashboardId: 42 },
  );
  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-failed",
    dashboardId: 42,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 42), false);

  const source = readFileSync(
    path.resolve("src/components/admin/AdminAccessSettings.tsx"),
    "utf8",
  );
  assert.match(source, /accessUsersReady \? users\.map/);
  assert.match(
    source,
    /disabled=\{saving \|\| !selectedDashboardId \|\| !accessUsersReady\}/,
  );
});

test("malformed access-user PUT success fails closed and requires reload", () => {
  const source = readFileSync(
    path.resolve("src/components/admin/AdminAccessSettings.tsx"),
    "utf8",
  );
  const parserCalls = source.match(/parseAccessUsersPayload\(json\)/g) ?? [];

  assert.equal(parserCalls.length, 2);
  assert.match(source, /Перезагрузите страницу перед повторной попыткой/);
  assert.match(
    source,
    /type: "load-failed",[\s\S]*dashboardId: targetDashboardId/,
  );

  let readiness = reduceAccessUsersEditorReadiness(
    createAccessUsersEditorReadiness(),
    { type: "load-started", dashboardId: 42 },
  );
  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-succeeded",
    dashboardId: 42,
  });
  readiness = reduceAccessUsersEditorReadiness(readiness, {
    type: "load-failed",
    dashboardId: 42,
  });
  assert.equal(isAccessUsersEditorReady(readiness, 42), false);
});

test("dashboard selector locks for both write modes and shared notification always resets", async () => {
  const adminSource = readFileSync(
    path.resolve("src/components/admin/AdminAccessSettings.tsx"),
    "utf8",
  );
  const sharedSource = readFileSync(
    path.resolve("src/components/admin/SharedPasswordSettings.tsx"),
    "utf8",
  );
  const resolvedEvents: boolean[] = [];
  const value = await runWithSavingNotification(
    (saving) => resolvedEvents.push(saving),
    async () => "saved",
  );
  assert.equal(value, "saved");
  assert.deepEqual(resolvedEvents, [true, false]);

  const rejectedEvents: boolean[] = [];
  await assert.rejects(
    runWithSavingNotification(
      (saving) => rejectedEvents.push(saving),
      async () => {
        throw new Error("request failed");
      },
    ),
    /request failed/,
  );
  assert.deepEqual(rejectedEvents, [true, false]);

  assert.match(adminSource, /disabled=\{saving \|\| sharedPasswordSaving\}/);
  assert.match(adminSource, /onSavingChange=\{setSharedPasswordSaving\}/);
  assert.match(
    sharedSource,
    /return \(\) => \{[\s\S]*onSavingChangeRef\.current\(false\)/,
  );
});
