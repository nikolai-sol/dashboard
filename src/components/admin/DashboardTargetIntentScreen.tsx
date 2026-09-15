"use client";

import Link from "next/link";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type {
  DashboardTargetIntentAdminState,
  DashboardTargetIntentHistoryEntry,
  DashboardTargetIntentPreview,
} from "@/lib/admin-ui-types";

export const TARGET_INTENT_REPLACEMENT_CONFIRMATION = "ЗАМЕНИТЬ КАТАЛОГ";
const MAX_TARGET_INTENT_UPLOAD_BYTES = 5 * 1024 * 1024;

export type DashboardTargetIntentPhase =
  | "source"
  | "validating"
  | "preview-ready"
  | "publishing"
  | "active"
  | "failed"
  | "restore-confirmation";

export type DashboardTargetIntentState = {
  phase: DashboardTargetIntentPhase;
  loading: boolean;
  canonical: DashboardTargetIntentAdminState | null;
  preview: DashboardTargetIntentPreview | null;
  restorePublication: DashboardTargetIntentHistoryEntry | null;
  error: string | null;
  errorActiveState: "preserved" | "unknown";
  notice: string | null;
};

export type DashboardTargetIntentAction =
  | { type: "load-started" }
  | { type: "load-succeeded"; canonical: DashboardTargetIntentAdminState; notice?: string }
  | { type: "preview-started" }
  | { type: "preview-succeeded"; preview: DashboardTargetIntentPreview }
  | { type: "publish-started"; kind?: "publish" | "restore" }
  | { type: "restore-requested"; publication: DashboardTargetIntentHistoryEntry }
  | { type: "restore-cancelled" }
  | { type: "operation-failed"; error: string; activeState?: "preserved" | "unknown" }
  | { type: "refresh-failed-after-success"; message: string }
  | { type: "source-edited" }
  | { type: "reset-source" };

export function createDashboardTargetIntentState(): DashboardTargetIntentState {
  return {
    phase: "source",
    loading: true,
    canonical: null,
    preview: null,
    restorePublication: null,
    error: null,
    errorActiveState: "preserved",
    notice: null,
  };
}

export function reduceDashboardTargetIntentState(
  state: DashboardTargetIntentState,
  action: DashboardTargetIntentAction,
): DashboardTargetIntentState {
  switch (action.type) {
    case "load-started":
      return { ...state, loading: true, error: null, notice: null };
    case "load-succeeded":
      return {
        ...state,
        phase: action.canonical.activeVersionId ? "active" : "source",
        loading: false,
        canonical: action.canonical,
        preview: null,
        restorePublication: null,
        error: null,
        errorActiveState: "preserved",
        notice: action.notice ?? null,
      };
    case "preview-started":
      return {
        ...state,
        phase: "validating",
        loading: false,
        preview: null,
        restorePublication: null,
        error: null,
        errorActiveState: "preserved",
        notice: null,
      };
    case "preview-succeeded":
      return {
        ...state,
        phase: action.preview.state === "failed" ? "failed" : "preview-ready",
        loading: false,
        preview: action.preview,
        restorePublication: null,
        error: action.preview.state === "failed" ? "Не удалось проверить источник" : null,
        errorActiveState: "preserved",
        notice: null,
      };
    case "publish-started":
      return {
        ...state,
        phase: "publishing",
        restorePublication: action.kind === "restore" ? state.restorePublication : null,
        error: null,
        errorActiveState: "preserved",
        notice: null,
      };
    case "restore-requested":
      return {
        ...state,
        phase: "restore-confirmation",
        restorePublication: action.publication,
        error: null,
        errorActiveState: "preserved",
        notice: null,
      };
    case "restore-cancelled":
      return {
        ...state,
        phase: state.preview ? "preview-ready" : state.canonical?.activeVersionId ? "active" : "source",
        restorePublication: null,
        error: null,
        errorActiveState: "preserved",
      };
    case "operation-failed":
      return {
        ...state,
        phase: "failed",
        loading: false,
        error: action.error,
        errorActiveState: action.activeState ?? "preserved",
        notice: null,
      };
    case "refresh-failed-after-success":
      return {
        ...state,
        phase: "failed",
        loading: false,
        canonical: null,
        preview: null,
        restorePublication: null,
        error: "Не удалось загрузить обновлённое состояние — обновите страницу",
        errorActiveState: "unknown",
        notice: action.message,
      };
    case "source-edited":
    case "reset-source":
      return {
        ...state,
        phase: "source",
        loading: false,
        preview: null,
        restorePublication: null,
        error: null,
        errorActiveState: "preserved",
        notice: null,
      };
  }
}

type TargetIntentEditNavigationStatus = "loading" | "seo" | "unsupported" | "unavailable" | "failed";

export function TargetIntentEditNavigationView({
  dashboardId,
  status,
}: {
  dashboardId: string;
  status: TargetIntentEditNavigationStatus;
}) {
  if (status === "seo") {
    return (
      <Link
        href={`/admin/dashboards/${dashboardId}/target-intent`}
        className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
      >
        Целевой интент
      </Link>
    );
  }

  if (status === "loading") {
    return (
      <span className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400">
        Целевой интент…
      </span>
    );
  }

  return (
    <span
      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
      title={status === "unsupported" ? "Целевой интент доступен только для SEO-дашбордов" : undefined}
    >
      {status === "unsupported"
        ? "Целевой интент доступен только для SEO-дашбордов"
        : status === "unavailable"
          ? "Целевой интент недоступен для этого дашборда"
        : "Не удалось определить поддержку целевого интента"}
    </span>
  );
}

export function DashboardTargetIntentNavigation({ dashboardId }: { dashboardId: string }) {
  const [status, setStatus] = useState<TargetIntentEditNavigationStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();

    async function loadCapability() {
      try {
        const response = await fetch(`/api/admin/dashboards/${dashboardId}/target-intent`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        if (controller.signal.aborted) return;
        if (response.ok) {
          setStatus("seo");
          return;
        }
        if (payload?.error === "Целевой интент доступен только для SEO-дашбордов") {
          setStatus("unsupported");
          return;
        }
        setStatus(response.status === 404 ? "unavailable" : "failed");
      } catch {
        if (!controller.signal.aborted) setStatus("failed");
      }
    }

    void loadCapability();
    return () => controller.abort();
  }, [dashboardId]);

  return <TargetIntentEditNavigationView dashboardId={dashboardId} status={status} />;
}

type DashboardTargetIntentViewProps = {
  dashboardId: string;
  state: DashboardTargetIntentState;
  sourceMode: "upload" | "google_sheet";
  selectedFilename: string;
  googleSheetsUrl: string;
  label: string;
  confirmation: string;
  onSourceModeChange(mode: "upload" | "google_sheet"): void;
  onFileChange(event: ChangeEvent<HTMLInputElement>): void;
  onGoogleSheetsUrlChange(value: string): void;
  onLabelChange(value: string): void;
  onConfirmationChange(value: string): void;
  onValidate(): void;
  onPublish(): void;
  onRequestRestore(publication: DashboardTargetIntentHistoryEntry): void;
  onCancelRestore(): void;
  onRestore(): void;
};

function statusText(state: DashboardTargetIntentState) {
  if (state.loading) return "Загрузка состояния…";
  switch (state.phase) {
    case "source": return "Выберите источник";
    case "validating": return "Источник проверяется…";
    case "preview-ready": return "Предпросмотр готов";
    case "publishing": return "Публикация новой версии…";
    case "active": return "Активная версия";
    case "failed": return "Операция завершилась ошибкой";
    case "restore-confirmation": return "Подтвердите восстановление";
  }
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : value;
}

function transportLabel(value: "upload" | "google_sheet") {
  return value === "google_sheet" ? "Google Sheets" : "Файл";
}

function matchTypeLabel(value: "exact" | "phrase") {
  return value === "exact" ? "точное" : "фраза";
}

export function DashboardTargetIntentView({
  dashboardId,
  state,
  sourceMode,
  selectedFilename,
  googleSheetsUrl,
  label,
  confirmation,
  onSourceModeChange,
  onFileChange,
  onGoogleSheetsUrlChange,
  onLabelChange,
  onConfirmationChange,
  onValidate,
  onPublish,
  onRequestRestore,
  onCancelRestore,
  onRestore,
}: DashboardTargetIntentViewProps) {
  const preview = state.preview;
  const groups = new Set(
    (preview?.rows ?? []).map((row) => row.group?.trim()).filter((value): value is string => Boolean(value)),
  ).size;
  const sourceReady = sourceMode === "upload" ? Boolean(selectedFilename) : Boolean(googleSheetsUrl.trim());
  const confirming = confirmation.trim() === TARGET_INTENT_REPLACEMENT_CONFIRMATION;
  const busy = state.loading || state.phase === "validating" || state.phase === "publishing";
  const canPublish = Boolean(
    preview &&
    preview.state === "valid" &&
    preview.errors.length === 0 &&
    preview.ruleCount > 0 &&
    state.canonical !== null &&
    label.trim() &&
    confirming &&
    state.restorePublication === null &&
    (state.phase === "preview-ready" || state.phase === "failed"),
  );
  const pendingRestore = state.restorePublication;
  const canRestore = Boolean(
    pendingRestore && confirming && (state.phase === "restore-confirmation" || state.phase === "failed"),
  );
  const activePublication = state.canonical?.history.find((item) => item.active) ?? null;

  return (
    <section className="space-y-6" data-workflow-state={state.phase}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Целевой интент</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Управление полной версией правил классификации SEO-запросов для дашборда #{dashboardId}.
          </p>
        </div>
        <Link
          href={`/admin/dashboards/${dashboardId}/edit`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Назад к редактированию
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
          {statusText(state)}
        </span>
        <span className="text-xs text-slate-500">
          Google Sheets проверяется только по кнопке — автоматического обновления нет.
        </span>
      </div>

      {state.error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.error}
          {state.errorActiveState === "preserved" ? ". Текущая активная версия не изменена." : null}
        </div>
      ) : null}
      {state.notice ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {state.notice}
        </div>
      ) : null}

      {activePublication ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {state.errorActiveState === "unknown"
              ? "Последняя загруженная версия — результат операции уточняется"
              : "Активная версия"}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-emerald-950">
            <span><strong>Версия {activePublication.versionId}</strong></span>
            <span>{activePublication.label}</span>
            <span>{activePublication.ruleCount.toLocaleString("ru-RU")} правил</span>
            <span>{formatTimestamp(activePublication.publishedAt)}</span>
          </div>
        </div>
      ) : state.canonical && !state.loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Активный каталог пока не опубликован. Классификация не настроена.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">Источник новой версии</h2>
          <p className="text-sm text-slate-600">
            Выберите один источник и вручную создайте неизменяемый предпросмотр.
          </p>
        </div>

        <label className="mt-5 block max-w-xl text-sm">
          <span className="mb-1 block font-medium text-slate-700">Название целевой категории</span>
          <input
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            maxLength={191}
            placeholder="Целевой интент"
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Например, «Мед. интент». Это название увидят пользователи SEO-дашборда.
          </span>
        </label>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className={`rounded-xl border p-4 ${sourceMode === "upload" ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <input
                type="radio"
                name="target-intent-source"
                checked={sourceMode === "upload"}
                disabled={busy}
                onChange={() => onSourceModeChange("upload")}
              />
              Загрузить Excel или CSV
            </span>
            <span className="mt-1 block text-xs text-slate-500">До 5 МБ; XLS, XLSX или UTF-8 CSV.</span>
          </label>
          <label className={`rounded-xl border p-4 ${sourceMode === "google_sheet" ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <input
                type="radio"
                name="target-intent-source"
                checked={sourceMode === "google_sheet"}
                disabled={busy}
                onChange={() => onSourceModeChange("google_sheet")}
              />
              Google Sheets
            </span>
            <span className="mt-1 block text-xs text-slate-500">Снимок загружается только при ручной проверке.</span>
          </label>
        </div>

        <div className="mt-4">
          {sourceMode === "upload" ? (
            <label className="block max-w-xl text-sm">
              <span className="mb-1 block font-medium text-slate-700">Файл с правилами</span>
              <input
                type="file"
                accept=".xls,.xlsx,.csv"
                disabled={busy}
                onChange={onFileChange}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              {selectedFilename ? <span className="mt-1 block text-xs text-slate-500">Выбран: {selectedFilename}</span> : null}
            </label>
          ) : (
            <label className="block max-w-xl text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ссылка Google Sheets</span>
              <input
                type="url"
                value={googleSheetsUrl}
                onChange={(event) => onGoogleSheetsUrlChange(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          )}
        </div>

        <button
          type="button"
          onClick={onValidate}
          disabled={!sourceReady || busy}
          className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.phase === "validating" ? "Проверяем…" : "Проверить источник"}
        </button>
      </div>

      {preview ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Предпросмотр готов</h2>
            <p className="mt-1 text-sm text-slate-600">
              {transportLabel(preview.sourceTransport)} · {preview.filename ?? preview.sourceIdentity}
              {preview.worksheet ? ` · лист «${preview.worksheet}»` : ""}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Правил", preview.ruleCount],
              ["Групп", groups],
              ["Дубликатов", preview.duplicateCount],
              ["Конфликтов", preview.conflictCount],
            ].map(([name, value]) => (
              <div key={String(name)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{name}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          {preview.errors.length ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <h3 className="font-semibold text-rose-800">Ошибки проверки</h3>
              <ul className="mt-2 space-y-1 text-sm text-rose-700">
                {preview.errors.slice(0, 50).map((error, index) => (
                  <li key={`${error.code}-${error.row ?? "file"}-${index}`}>
                    {error.row === null ? "Файл" : `Строка ${error.row}`}
                    {error.column ? `, ${error.column}` : ""}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Ошибок проверки нет. Предпросмотр можно опубликовать.
            </div>
          )}

          {preview.rows.length ? (
            <div>
              <h3 className="mb-2 font-semibold text-slate-900">Примеры правил из источника</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Ключ</th>
                    <th className="px-3 py-2">Группа</th>
                    <th className="px-3 py-2">Тип совпадения</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.slice(0, 8).map((row) => (
                    <tr key={`${row.sourceRowOrdinal}-${row.normalizedKey}`}>
                      <td className="px-3 py-2 text-slate-900">{row.key}</td>
                      <td className="px-3 py-2 text-slate-600">{row.group ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{matchTypeLabel(row.matchType)}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              Публикация полностью заменит текущий активный каталог правилами из этого предпросмотра.
            </p>
            <label className="mt-3 block max-w-md text-sm text-amber-950">
              <span className="mb-1 block">Введите «{TARGET_INTENT_REPLACEMENT_CONFIRMATION}» для подтверждения</span>
              <input
                value={confirmation}
                onChange={(event) => onConfirmationChange(event.target.value)}
                autoComplete="off"
                disabled={busy}
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2"
              />
            </label>
            <button
              type="button"
              onClick={onPublish}
              disabled={!canPublish}
              className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Опубликовать новую версию
            </button>
          </div>
        </div>
      ) : null}

      {pendingRestore ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-amber-950">Восстановление создаст новую версию</h2>
          <p className="mt-2 text-sm text-amber-900">
            Снимок версии {pendingRestore.versionId} будет скопирован в новую неизменяемую версию и полностью заменит текущий активный каталог.
          </p>
          <label className="mt-3 block max-w-md text-sm text-amber-950">
            <span className="mb-1 block">Введите «{TARGET_INTENT_REPLACEMENT_CONFIRMATION}» для подтверждения</span>
            <input
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
              autoComplete="off"
              disabled={state.phase === "publishing"}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onRestore}
              disabled={!canRestore}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Подтвердить восстановление
            </button>
            <button
              type="button"
              onClick={onCancelRestore}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {state.canonical?.previews.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Последние проверки источника</h2>
          <p className="mt-1 text-sm text-slate-600">
            Ошибочные проверки сохраняются для аудита и не меняют активную версию.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Время</th>
                  <th className="px-3 py-2">Источник</th>
                  <th className="px-3 py-2">Результат</th>
                  <th className="px-3 py-2">Счётчики</th>
                  <th className="px-3 py-2">Ошибки</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.canonical.previews.slice(0, 10).map((item) => (
                  <tr key={item.previewId}>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatTimestamp(item.createdAt)}</td>
                    <td className="max-w-xs break-all px-3 py-3 text-slate-600">
                      {transportLabel(item.sourceTransport)}<br />
                      <span className="text-xs">{item.filename ?? item.sourceIdentity}</span>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-700">
                      {item.state === "valid"
                        ? "Готово к публикации"
                        : item.state === "invalid"
                          ? "Есть ошибки"
                          : "Проверка не выполнена"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {item.ruleCount} правил · {item.duplicateCount} дубл. · {item.conflictCount} конфл.
                    </td>
                    <td className="max-w-sm px-3 py-3 text-slate-600">
                      {item.errors.length ? item.errors.slice(0, 2).map((error) => error.message).join("; ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">История публикаций</h2>
        {state.canonical?.history.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Версия</th>
                  <th className="px-3 py-2">Операция</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Источник и доказательство</th>
                  <th className="px-3 py-2">Правила</th>
                  <th className="px-3 py-2">Комментарий</th>
                  <th className="px-3 py-2">Автор и время</th>
                  <th className="px-3 py-2">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.canonical.history.map((publication) => (
                  <tr key={publication.publicationId}>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      Версия {publication.versionId}
                      {publication.active ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">активна</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {publication.kind === "restore" ? "Восстановление" : "Публикация"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{publication.label}</td>
                    <td className="max-w-xs break-all px-3 py-3 text-slate-600">
                      {transportLabel(publication.sourceTransport)}<br />
                      <span className="text-xs">{publication.sourceIdentity}</span><br />
                      <code className="text-[11px] text-slate-500">SHA-256: {publication.contentSha256}</code>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{publication.ruleCount.toLocaleString("ru-RU")}</td>
                    <td className="px-3 py-3 text-slate-600">{publication.comment ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {publication.publishedBy}<br />
                      <span className="text-xs">{formatTimestamp(publication.publishedAt)}</span>
                    </td>
                    <td className="px-3 py-3">
                      {publication.active ? (
                        <span className="text-xs font-medium text-emerald-700">Текущая</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRequestRestore(publication)}
                          disabled={busy}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Восстановить как новую версию
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : state.canonical ? (
          <p className="mt-3 text-sm text-slate-500">Публикаций пока нет.</p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">История недоступна, пока состояние не загружено.</p>
        )}
      </div>
    </section>
  );
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type TargetIntentPendingOperation = {
  kind: "publish" | "restore";
  targetKey: string;
  id: string;
};

export function retainTargetIntentOperation(
  current: TargetIntentPendingOperation | null,
  kind: TargetIntentPendingOperation["kind"],
  targetKey: string,
  createId: () => string,
): TargetIntentPendingOperation {
  if (current?.kind === kind && current.targetKey === targetKey) return current;
  return { kind, targetKey, id: createId() };
}

type TargetIntentMutation =
  | { kind: "publish"; previewId: string; label: string; operationId: string }
  | { kind: "restore"; publicationId: string; operationId: string };

type TargetIntentPreviewRequest =
  | { transport: "upload"; filename: string; contentBase64: string }
  | { transport: "google_sheet"; sourceUrl: string };

export function buildTargetIntentPreviewRequest(
  dashboardId: string,
  source: TargetIntentPreviewRequest,
): { url: string; init: RequestInit } {
  const body = source.transport === "upload"
    ? {
        transport: "upload",
        filename: source.filename,
        content_base64: source.contentBase64,
      }
    : {
        transport: "google_sheet",
        source_url: source.sourceUrl,
      };
  return {
    url: `/api/admin/dashboards/${dashboardId}/target-intent/preview`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export function buildTargetIntentMutationRequest(
  dashboardId: string,
  mutation: TargetIntentMutation,
): { url: string; init: RequestInit } {
  const suffix = mutation.kind === "publish" ? "publish" : "restore";
  const body = mutation.kind === "publish"
    ? {
        preview_id: mutation.previewId,
        label: mutation.label,
        operation_id: mutation.operationId,
      }
    : {
        publication_id: mutation.publicationId,
        operation_id: mutation.operationId,
      };
  return {
    url: `/api/admin/dashboards/${dashboardId}/target-intent/${suffix}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export class TargetIntentRequestError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "unknown",
  ) {
    super(message);
    this.name = "TargetIntentRequestError";
  }
}

function safeApiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim() && error.length <= 240) return error;
  }
  return fallback;
}

export async function requestTargetIntentJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  fallback: string,
) {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new TargetIntentRequestError(fallback, "unknown");
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new TargetIntentRequestError(
      safeApiError(payload, fallback),
      response.status >= 500 ? "unknown" : "rejected",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TargetIntentRequestError(fallback, "unknown");
  }
  return payload as Record<string, unknown>;
}

function assertAdminState(payload: Record<string, unknown>): DashboardTargetIntentAdminState {
  if (
    !(payload.activeVersionId === null || typeof payload.activeVersionId === "string") ||
    !Array.isArray(payload.history) ||
    !Array.isArray(payload.previews)
  ) {
    throw new Error("Не удалось загрузить состояние целевого интента");
  }
  return payload as DashboardTargetIntentAdminState;
}

function assertPreview(payload: Record<string, unknown>): DashboardTargetIntentPreview {
  if (
    typeof payload.previewId !== "string" ||
    !["valid", "invalid", "failed"].includes(String(payload.state)) ||
    !Array.isArray(payload.rows) ||
    !Array.isArray(payload.errors)
  ) {
    throw new Error("Не удалось проверить источник");
  }
  return payload as DashboardTargetIntentPreview;
}

async function fileToBoundedBase64(file: File) {
  if (file.size <= 0) throw new Error("Выбран пустой файл");
  if (file.size > MAX_TARGET_INTENT_UPLOAD_BYTES) throw new Error("Файл превышает допустимый размер 5 МБ");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_TARGET_INTENT_UPLOAD_BYTES) throw new Error("Файл превышает допустимый размер 5 МБ");
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default function DashboardTargetIntentScreen({ dashboardId }: { dashboardId: string }) {
  const [state, dispatch] = useReducer(
    reduceDashboardTargetIntentState,
    undefined,
    createDashboardTargetIntentState,
  );
  const [sourceMode, setSourceMode] = useState<"upload" | "google_sheet">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState("");
  const [label, setLabel] = useState("Целевой интент");
  const [confirmation, setConfirmation] = useState("");
  const mounted = useRef(true);
  const pendingOperation = useRef<TargetIntentPendingOperation | null>(null);

  async function loadCanonicalState(notice?: string, signal?: AbortSignal) {
    const payload = await requestTargetIntentJson(
      fetch,
      `/api/admin/dashboards/${dashboardId}/target-intent`,
      { cache: "no-store", signal },
      "Не удалось загрузить состояние целевого интента",
    );
    const canonical = assertAdminState(payload);
    if (!mounted.current || signal?.aborted) return;
    const active = canonical.history.find((item) => item.active);
    if (active) setLabel(active.label);
    dispatch({ type: "load-succeeded", canonical, notice });
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    dispatch({ type: "load-started" });
    void loadCanonicalState(undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted && mounted.current) {
        dispatch({
          type: "operation-failed",
          error: error instanceof Error ? error.message : "Не удалось загрузить состояние целевого интента",
        });
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
    };
    // loadCanonicalState intentionally belongs to this dashboard-id effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    pendingOperation.current = null;
    setConfirmation("");
    setSelectedFile(event.target.files?.[0] ?? null);
    dispatch({ type: "source-edited" });
  }

  async function validateSource() {
    dispatch({ type: "preview-started" });
    setConfirmation("");
    try {
      let request: { url: string; init: RequestInit };
      if (sourceMode === "upload") {
        if (!selectedFile) throw new Error("Выберите Excel- или CSV-файл");
        const contentBase64 = await fileToBoundedBase64(selectedFile);
        request = buildTargetIntentPreviewRequest(dashboardId, {
          transport: "upload",
          filename: selectedFile.name,
          contentBase64,
        });
      } else {
        if (!googleSheetsUrl.trim()) throw new Error("Укажите ссылку Google Sheets");
        request = buildTargetIntentPreviewRequest(dashboardId, {
          transport: "google_sheet",
          sourceUrl: googleSheetsUrl.trim(),
        });
      }
      const payload = await requestTargetIntentJson(
        fetch, request.url, request.init,
        "Не удалось проверить источник",
      );
      if (mounted.current) dispatch({ type: "preview-succeeded", preview: assertPreview(payload) });
    } catch (error) {
      if (mounted.current) {
        dispatch({
          type: "operation-failed",
          error: error instanceof Error ? error.message : "Не удалось проверить источник",
        });
      }
    }
  }

  async function publishPreview() {
    if (!state.preview) return;
    const operation = retainTargetIntentOperation(
      pendingOperation.current,
      "publish",
      `preview:${state.preview.previewId}|label:${label.trim()}`,
      () => crypto.randomUUID(),
    );
    pendingOperation.current = operation;
    dispatch({ type: "publish-started", kind: "publish" });
    const request = buildTargetIntentMutationRequest(dashboardId, {
      kind: "publish",
      previewId: state.preview.previewId,
      label: label.trim(),
      operationId: operation.id,
    });
    try {
      await requestTargetIntentJson(
        fetch, request.url, request.init,
        "Не удалось опубликовать каталог",
      );
    } catch (error) {
      if (mounted.current) {
        const unknown = error instanceof TargetIntentRequestError && error.outcome === "unknown";
        dispatch({
          type: "operation-failed",
          error: unknown
            ? "Не удалось подтвердить результат публикации. Повторите действие: будет использован тот же идентификатор операции"
            : error instanceof Error ? error.message : "Не удалось опубликовать каталог",
          activeState: unknown ? "unknown" : "preserved",
        });
      }
      return;
    }

    pendingOperation.current = null;
    setConfirmation("");
    try {
      await loadCanonicalState("Новая версия опубликована. Предыдущая версия сохранена в истории.");
    } catch {
      if (mounted.current) {
        dispatch({
          type: "refresh-failed-after-success",
          message: "Новая версия опубликована. Предыдущая версия сохранена в истории.",
        });
      }
    }
  }

  async function restorePublication() {
    const publication = state.restorePublication;
    if (!publication) return;
    const operation = retainTargetIntentOperation(
      pendingOperation.current,
      "restore",
      `publication:${publication.publicationId}`,
      () => crypto.randomUUID(),
    );
    pendingOperation.current = operation;
    dispatch({ type: "publish-started", kind: "restore" });
    const request = buildTargetIntentMutationRequest(dashboardId, {
      kind: "restore",
      publicationId: publication.publicationId,
      operationId: operation.id,
    });
    try {
      await requestTargetIntentJson(
        fetch, request.url, request.init,
        "Не удалось восстановить каталог",
      );
    } catch (error) {
      if (mounted.current) {
        const unknown = error instanceof TargetIntentRequestError && error.outcome === "unknown";
        dispatch({
          type: "operation-failed",
          error: unknown
            ? "Не удалось подтвердить результат восстановления. Повторите действие: будет использован тот же идентификатор операции"
            : error instanceof Error ? error.message : "Не удалось восстановить каталог",
          activeState: unknown ? "unknown" : "preserved",
        });
      }
      return;
    }

    pendingOperation.current = null;
    setConfirmation("");
    try {
      await loadCanonicalState("Исторический снимок опубликован как новая версия.");
    } catch {
      if (mounted.current) {
        dispatch({
          type: "refresh-failed-after-success",
          message: "Исторический снимок опубликован как новая версия.",
        });
      }
    }
  }

  return (
    <DashboardTargetIntentView
      dashboardId={dashboardId}
      state={state}
      sourceMode={sourceMode}
      selectedFilename={selectedFile?.name ?? ""}
      googleSheetsUrl={googleSheetsUrl}
      label={label}
      confirmation={confirmation}
      onSourceModeChange={(mode) => {
        pendingOperation.current = null;
        setSourceMode(mode);
        setConfirmation("");
        dispatch({ type: "reset-source" });
      }}
      onFileChange={onFileChange}
      onGoogleSheetsUrlChange={(value) => {
        pendingOperation.current = null;
        setConfirmation("");
        setGoogleSheetsUrl(value);
        dispatch({ type: "source-edited" });
      }}
      onLabelChange={(value) => {
        pendingOperation.current = null;
        setConfirmation("");
        setLabel(value);
      }}
      onConfirmationChange={setConfirmation}
      onValidate={() => void validateSource()}
      onPublish={() => void publishPreview()}
      onRequestRestore={(publication) => {
        if (
          pendingOperation.current?.kind !== "restore" ||
          pendingOperation.current.targetKey !== `publication:${publication.publicationId}`
        ) {
          pendingOperation.current = null;
        }
        setConfirmation("");
        dispatch({ type: "restore-requested", publication });
      }}
      onCancelRestore={() => {
        pendingOperation.current = null;
        setConfirmation("");
        dispatch({ type: "restore-cancelled" });
      }}
      onRestore={() => void restorePublication()}
    />
  );
}
