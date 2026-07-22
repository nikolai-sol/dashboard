"use client";

import { useEffect, useReducer, useRef, type FormEvent } from "react";

type SharedPasswordSettingsProps = {
  dashboardId: number;
  dashboardName: string;
  onSavingChange: (saving: boolean) => void;
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

type SharedPasswordRequestResult =
  | { ok: true; body: SharedPasswordResponse }
  | { ok: false; error: string };

type SharedPasswordFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const ALLOWED_SHARED_PASSWORD_API_ERRORS = new Set([
  "Требуется авторизация",
  "Некорректный идентификатор дашборда",
  "Не удалось сохранить пароль",
  "Дашборд не найден",
  "Смена пароля недоступна для этого дашборда",
  "Пароль должен быть строкой",
  "Пароли не совпадают",
  "Пароль должен содержать не менее 10 символов",
  "Пароль слишком длинный",
]);

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

export function sharedPasswordStatusText(input: {
  loading: boolean;
  configured: boolean | null;
}) {
  if (input.loading) return "Загрузка статуса...";
  if (input.configured === true) return "Пароль установлен";
  if (input.configured === false) {
    return "Пароль ещё не перенесён в защищённое хранилище";
  }
  return "Статус пароля неизвестен";
}

function safeRussianApiError(value: unknown, fallback: string) {
  if (typeof value === "string" && ALLOWED_SHARED_PASSWORD_API_ERRORS.has(value)) {
    return value;
  }
  return fallback;
}

export async function runWithSavingNotification<T>(
  onSavingChange: (saving: boolean) => void,
  operation: () => Promise<T>,
) {
  onSavingChange(true);
  try {
    return await operation();
  } finally {
    onSavingChange(false);
  }
}

export async function requestSharedPassword(
  fetcher: SharedPasswordFetcher,
  input: string,
  init: RequestInit,
  fallback: string,
): Promise<SharedPasswordRequestResult> {
  try {
    const response = await fetcher(input, init);
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, error: fallback };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: fallback };
    }
    const body = parsed as SharedPasswordResponse;
    if (!response.ok) {
      return { ok: false, error: safeRussianApiError(body.error, fallback) };
    }
    if (typeof body.configured !== "boolean") {
      return { ok: false, error: fallback };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, error: fallback };
  }
}

export default function SharedPasswordSettings({
  dashboardId,
  dashboardName,
  onSavingChange,
}: SharedPasswordSettingsProps) {
  const [state, dispatch] = useReducer(
    reduceSharedPasswordSettingsState,
    dashboardId,
    createSharedPasswordSettingsState,
  );
  const currentDashboardId = useRef(dashboardId);
  currentDashboardId.current = dashboardId;
  const mounted = useRef(false);
  const onSavingChangeRef = useRef(onSavingChange);
  onSavingChangeRef.current = onSavingChange;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onSavingChangeRef.current(false);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "dashboard-changed", dashboardId });

    async function loadStatus() {
      const result = await requestSharedPassword(
        fetch,
        `/api/admin/dashboards/${dashboardId}/shared-password`,
        { cache: "no-store", signal: controller.signal },
        "Не удалось загрузить статус пароля",
      );
      if (
        controller.signal.aborted ||
        currentDashboardId.current !== dashboardId
      ) {
        return;
      }
      if (result.ok) {
        dispatch({
          type: "status-loaded",
          dashboardId,
          configured: result.body.configured === true,
        });
      } else {
        dispatch({
          type: "load-failed",
          dashboardId,
          error: result.error,
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
      const result = await runWithSavingNotification(
        (nextSaving) => {
          if (mounted.current) {
            onSavingChangeRef.current(nextSaving);
          }
        },
        () =>
          requestSharedPassword(
            fetch,
            `/api/admin/dashboards/${dashboardId}/shared-password`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                new_password: newPassword,
                confirm_password: confirmation,
              }),
            },
            "Не удалось сохранить пароль",
          ),
      );
      if (!mounted.current || currentDashboardId.current !== dashboardId) return;
      if (!result.ok) {
        dispatch({
          type: "save-failed",
          dashboardId,
          error: result.error,
        });
        return;
      }
      succeeded = true;
    } finally {
      if (
        succeeded &&
        mounted.current &&
        currentDashboardId.current === dashboardId
      ) {
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
        {sharedPasswordStatusText({ loading, configured })}
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
