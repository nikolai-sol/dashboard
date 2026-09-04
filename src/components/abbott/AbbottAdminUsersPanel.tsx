"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, Trash2, X } from "lucide-react";

import {
  abbottAdminUsersApiPath,
  normalizeAbbottAdminUserInput,
} from "./abbott-admin-user-filter";

type AbbottAdminUsersPanelProps = {
  dashboardId: string;
  onChanged: () => void;
};

function validResponse(value: unknown): value is { user_ids: string[] } {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray((value as { user_ids?: unknown }).user_ids)
    && (value as { user_ids: unknown[] }).user_ids.every(
      (item) => typeof item === "string" && /^[0-9]{1,32}$/.test(item),
    );
}

export default function AbbottAdminUsersPanel({
  dashboardId,
  onChanged,
}: AbbottAdminUsersPanelProps) {
  const [open, setOpen] = useState(false);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useCallback(
    () => abbottAdminUsersApiPath(dashboardId, window.location.search),
    [dashboardId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetch(endpoint(), { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !validResponse(body)) throw new Error("unavailable");
        if (!cancelled) setUserIds(body.user_ids);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить список администраторов.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, open]);

  async function mutate(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint(), {
        method,
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !validResponse(payload)) throw new Error("unavailable");
      setUserIds(payload.user_ids);
      setDraft("");
      onChanged();
    } catch {
      setError("Не удалось сохранить список. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function addUsers() {
    const normalized = normalizeAbbottAdminUserInput(draft);
    if (!normalized.ok) {
      setError("Укажите User ID цифрами: по одному на строке.");
      return;
    }
    void mutate("POST", { user_ids: normalized.userIds });
  }

  if (!open) {
    return (
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
          aria-label="Настроить список администраторов"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          Список администраторов
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4" aria-label="Настройка администраторов">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">User ID администраторов</h3>
          <p className="mt-1 text-sm text-slate-600">
            Эти визиты исключаются только при выборе «ВСЕ без админов». Исходные данные не изменяются.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800"
          aria-label="Закрыть настройки"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="abbott-admin-user-ids">
            Добавить User ID
          </label>
          <textarea
            id="abbott-admin-user-ids"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            disabled={busy}
            placeholder="Один User ID на строке"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-sky-400 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addUsers}
            disabled={busy}
            className="mt-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Добавить
          </button>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-700">Текущий список ({userIds.length})</div>
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
            {busy && userIds.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">Загрузка…</p>
            ) : userIds.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">Список пуст.</p>
            ) : userIds.map((userId) => (
              <div key={userId} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <code className="text-sm text-slate-800">{userId}</code>
                <button
                  type="button"
                  onClick={() => void mutate("DELETE", { user_id: userId })}
                  disabled={busy}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  aria-label={`Удалить User ID ${userId}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
    </section>
  );
}
