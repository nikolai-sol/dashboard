import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createSharedPasswordSettingsState,
  reduceSharedPasswordSettingsState,
  validateSharedPasswordFields,
} from "./SharedPasswordSettings";

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
