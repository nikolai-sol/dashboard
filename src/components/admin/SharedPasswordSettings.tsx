"use client";

import { useEffect, useReducer, useRef, type FormEvent } from "react";

type SharedPasswordSettingsProps = {
  dashboardId: number;
  dashboardName: string;
};

type SharedPasswordSettingsState = {
  dashboardId: number;
  configured: boolean | null;
  loading: boolean;
  saving: boolean;
  newPassword: string;
  confirmation: string;
  error: string | null;
  message: string | null;
};

type SharedPasswordSettingsAction =
  | { type: "dashboard-changed"; dashboardId: number }
  | {
      type: "field-changed";
      dashboardId: number;
      field: "newPassword" | "confirmation";
      value: string;
    }
  | { type: "status-loaded"; dashboardId: number; configured: boolean }
  | { type: "load-failed"; dashboardId: number; error: string }
  | { type: "validation-failed"; dashboardId: number; error: string }
  | { type: "save-started"; dashboardId: number }
  | { type: "save-failed"; dashboardId: number; error: string }
  | { type: "save-succeeded"; dashboardId: number };

type SharedPasswordResponse = {
  configured?: boolean;
  error?: string;
};

export function createSharedPasswordSettingsState(
  dashboardId: number,
): SharedPasswordSettingsState {
  return {
    dashboardId,
    configured: null,
    loading: true,
    saving: false,
    newPassword: "",
    confirmation: "",
    error: null,
    message: null,
  };
}

export function reduceSharedPasswordSettingsState(
  state: SharedPasswordSettingsState,
  action: SharedPasswordSettingsAction,
): SharedPasswordSettingsState {
  if (action.type === "dashboard-changed") {
    return createSharedPasswordSettingsState(action.dashboardId);
  }
  if (action.dashboardId !== state.dashboardId) {
    return state;
  }

  switch (action.type) {
    case "field-changed":
      return {
        ...state,
        [action.field]: action.value,
        error: null,
        message: null,
      };
    case "status-loaded":
      return {
        ...state,
        configured: action.configured,
        loading: false,
      };
    case "load-failed":
      return { ...state, loading: false, error: action.error };
    case "validation-failed":
      return { ...state, error: action.error, message: null };
    case "save-started":
      return { ...state, saving: true, error: null, message: null };
    case "save-failed":
      return { ...state, saving: false, error: action.error };
    case "save-succeeded":
      return {
        ...state,
        configured: true,
        saving: false,
        newPassword: "",
        confirmation: "",
        error: null,
        message: "Пароль изменён. Предыдущие пользовательские сессии закрыты.",
      };
  }
}

export function validateSharedPasswordFields(
  newPassword: string,
  confirmation: string,
) {
  if (newPassword !== confirmation) {
    return "Пароли не совпадают";
  }
  if (newPassword.length < 10) {
    return "Пароль должен содержать не менее 10 символов";
  }
  return null;
}

function responseError(json: SharedPasswordResponse, fallback: string) {
  return typeof json.error === "string" && json.error ? json.error : fallback;
}

export default function SharedPasswordSettings({
  dashboardId,
  dashboardName,
}: SharedPasswordSettingsProps) {
  const [state, dispatch] = useReducer(
    reduceSharedPasswordSettingsState,
    dashboardId,
    createSharedPasswordSettingsState,
  );
  const currentDashboardId = useRef(dashboardId);
  currentDashboardId.current = dashboardId;

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "dashboard-changed", dashboardId });

    async function loadStatus() {
      try {
        const response = await fetch(
          `/api/admin/dashboards/${dashboardId}/shared-password`,
          { cache: "no-store", signal: controller.signal },
        );
        const json = (await response.json()) as SharedPasswordResponse;
        if (!response.ok) {
          throw new Error(responseError(json, "Не удалось загрузить статус пароля"));
        }
        if (currentDashboardId.current !== dashboardId) return;
        dispatch({
          type: "status-loaded",
          dashboardId,
          configured: json.configured === true,
        });
      } catch (loadError) {
        if (
          controller.signal.aborted ||
          currentDashboardId.current !== dashboardId
        ) {
          return;
        }
        dispatch({
          type: "load-failed",
          dashboardId,
          error:
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить статус пароля",
        });
      }
    }

    void loadStatus();
    return () => controller.abort();
  }, [dashboardId]);

  const belongsToSelectedDashboard = state.dashboardId === dashboardId;
  const configured = belongsToSelectedDashboard ? state.configured : null;
  const loading = !belongsToSelectedDashboard || state.loading;
  const saving = belongsToSelectedDashboard && state.saving;
  const newPassword = belongsToSelectedDashboard ? state.newPassword : "";
  const confirmation = belongsToSelectedDashboard ? state.confirmation : "";
  const error = belongsToSelectedDashboard ? state.error : null;
  const message = belongsToSelectedDashboard ? state.message : null;

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateSharedPasswordFields(
      newPassword,
      confirmation,
    );
    if (validationError) {
      dispatch({
        type: "validation-failed",
        dashboardId,
        error: validationError,
      });
      return;
    }

    dispatch({ type: "save-started", dashboardId });
    let succeeded = false;
    try {
      const response = await fetch(
        `/api/admin/dashboards/${dashboardId}/shared-password`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            new_password: newPassword,
            confirm_password: confirmation,
          }),
        },
      );
      const json = (await response.json()) as SharedPasswordResponse;
      if (!response.ok) {
        throw new Error(responseError(json, "Не удалось сохранить пароль"));
      }
      succeeded = true;
    } catch (saveError) {
      if (currentDashboardId.current !== dashboardId) return;
      dispatch({
        type: "save-failed",
        dashboardId,
        error:
          saveError instanceof Error
            ? saveError.message
            : "Не удалось сохранить пароль",
      });
    } finally {
      if (succeeded && currentDashboardId.current === dashboardId) {
        dispatch({ type: "save-succeeded", dashboardId });
      }
    }
  }

  return (
    <section
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-busy={loading || saving}
    >
      <h2 className="text-base font-semibold text-slate-900">Пароль доступа</h2>
      <p className="mt-1 text-sm text-slate-600">
        Дашборд: {dashboardName}
      </p>
      <p className="mt-1 text-sm text-slate-600" aria-live="polite">
        {loading
          ? "Загрузка статуса..."
          : configured
            ? "Пароль установлен"
            : "Пароль ещё не перенесён в защищённое хранилище"}
      </p>
      <p className="mt-1 text-sm text-amber-700">
        После смены пароля ранее открытые пользовательские сессии будут закрыты.
      </p>

      <form onSubmit={savePassword}>
        <label className="mt-4 block text-sm text-slate-700">
          Новый пароль
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) =>
              dispatch({
                type: "field-changed",
                dashboardId,
                field: "newPassword",
                value: event.target.value,
              })
            }
            disabled={loading || saving}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Повторите пароль
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) =>
              dispatch({
                type: "field-changed",
                dashboardId,
                field: "confirmation",
                value: event.target.value,
              })
            }
            disabled={loading || saving}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {error ? (
          <p className="mt-3 text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-emerald-600" role="status">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={
            loading ||
            saving ||
            newPassword.length < 10 ||
            newPassword !== confirmation
          }
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Сохранение..." : "Сменить пароль"}
        </button>
      </form>
    </section>
  );
}
