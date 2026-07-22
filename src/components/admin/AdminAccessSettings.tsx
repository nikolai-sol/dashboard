"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DashboardListItem } from "@/lib/admin-ui-types";
import { isSharedPasswordClient } from "@/lib/shared-password-policy";
import SharedPasswordSettings from "./SharedPasswordSettings";

type AccessUserRow = {
  id?: number;
  email: string;
  password: string;
};

type StoredAccessUser = {
  id: number;
  email: string;
};

const ACCESS_USERS_LOAD_ERROR = "Не удалось загрузить пользователей доступа";

type AccessUsersPayloadResult =
  | { ok: true; users: AccessUserRow[] }
  | { ok: false; error: string };

export function parseAccessUsersPayload(
  payload: unknown,
): AccessUsersPayloadResult {
  if (payload === null || typeof payload !== "object") {
    return { ok: false, error: ACCESS_USERS_LOAD_ERROR };
  }
  const users = (payload as { users?: unknown }).users;
  if (!Array.isArray(users)) {
    return { ok: false, error: ACCESS_USERS_LOAD_ERROR };
  }
  const validUsers = users.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      Number.isSafeInteger((item as { id?: unknown }).id) &&
      Number((item as { id?: unknown }).id) > 0 &&
      typeof (item as { email?: unknown }).email === "string",
  );
  if (!validUsers) {
    return { ok: false, error: ACCESS_USERS_LOAD_ERROR };
  }
  return {
    ok: true,
    users: (users as StoredAccessUser[]).map((item) => ({
      id: item.id,
      email: item.email,
      password: "",
    })),
  };
}

type AccessUsersEditorReadiness = {
  dashboardId: number | null;
  status: "idle" | "loading" | "ready" | "failed";
};

type AccessUsersEditorReadinessAction =
  | { type: "reset" }
  | { type: "load-started"; dashboardId: number }
  | { type: "load-succeeded"; dashboardId: number }
  | { type: "load-failed"; dashboardId: number };

export function createAccessUsersEditorReadiness(): AccessUsersEditorReadiness {
  return { dashboardId: null, status: "idle" };
}

export function reduceAccessUsersEditorReadiness(
  state: AccessUsersEditorReadiness,
  action: AccessUsersEditorReadinessAction,
): AccessUsersEditorReadiness {
  if (action.type === "reset") {
    return createAccessUsersEditorReadiness();
  }
  if (action.type === "load-started") {
    return { dashboardId: action.dashboardId, status: "loading" };
  }
  if (action.dashboardId !== state.dashboardId) {
    return state;
  }
  return {
    dashboardId: action.dashboardId,
    status: action.type === "load-succeeded" ? "ready" : "failed",
  };
}

export function isAccessUsersEditorReady(
  state: AccessUsersEditorReadiness,
  selectedDashboardId: number | null,
) {
  return (
    selectedDashboardId !== null &&
    state.dashboardId === selectedDashboardId &&
    state.status === "ready"
  );
}

export default function AdminAccessSettings() {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<number | null>(null);
  const [users, setUsers] = useState<AccessUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharedPasswordSaving, setSharedPasswordSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accessUsersReadiness, dispatchAccessUsersReadiness] = useReducer(
    reduceAccessUsersEditorReadiness,
    createAccessUsersEditorReadiness(),
  );
  const accessUsersSelection = useRef({
    dashboardId: selectedDashboardId,
    generation: 0,
  });
  if (accessUsersSelection.current.dashboardId !== selectedDashboardId) {
    accessUsersSelection.current = {
      dashboardId: selectedDashboardId,
      generation: accessUsersSelection.current.generation + 1,
    };
  }

  useEffect(() => {
    let cancelled = false;
    async function loadDashboards() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/dashboards", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(String(json?.error ?? "Failed to load dashboards"));
        }
        if (cancelled) return;
        const nextDashboards = Array.isArray(json?.dashboards) ? (json.dashboards as DashboardListItem[]) : [];
        setDashboards(nextDashboards);
        setSelectedDashboardId((prev) => prev ?? nextDashboards[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboards");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadDashboards();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDashboard = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null,
    [dashboards, selectedDashboardId],
  );

  useEffect(() => {
    let cancelled = false;
    const selectionGeneration = accessUsersSelection.current.generation;
    async function loadUsers() {
      if (!selectedDashboardId) {
        setUsers([]);
        dispatchAccessUsersReadiness({ type: "reset" });
        return;
      }
      if (
        selectedDashboard &&
        isSharedPasswordClient(selectedDashboard.client_id)
      ) {
        setUsers([]);
        setSaving(false);
        setError(null);
        setMessage(null);
        dispatchAccessUsersReadiness({ type: "reset" });
        return;
      }
      setUsers([]);
      setSaving(false);
      setError(null);
      setMessage(null);
      dispatchAccessUsersReadiness({
        type: "load-started",
        dashboardId: selectedDashboardId,
      });
      try {
        const response = await fetch(`/api/admin/access-users?dashboard_id=${selectedDashboardId}`, {
          cache: "no-store",
        });
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new Error(ACCESS_USERS_LOAD_ERROR);
        }
        if (!response.ok) {
          const errorBody = json as { error?: unknown };
          throw new Error(String(errorBody?.error ?? "Failed to load users"));
        }
        if (
          cancelled ||
          accessUsersSelection.current.generation !== selectionGeneration
        ) {
          return;
        }
        const parsed = parseAccessUsersPayload(json);
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }
        setUsers(parsed.users);
        dispatchAccessUsersReadiness({
          type: "load-succeeded",
          dashboardId: selectedDashboardId,
        });
      } catch (loadError) {
        if (
          cancelled ||
          accessUsersSelection.current.generation !== selectionGeneration
        ) {
          return;
        }
        setUsers([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load users");
        dispatchAccessUsersReadiness({
          type: "load-failed",
          dashboardId: selectedDashboardId,
        });
      }
    }
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [selectedDashboard, selectedDashboardId]);

  const accessUsersReady = isAccessUsersEditorReady(
    accessUsersReadiness,
    selectedDashboardId,
  );
  const accessUsersLoading =
    accessUsersReadiness.dashboardId === selectedDashboardId &&
    accessUsersReadiness.status === "loading";
  const accessUsersFailed =
    accessUsersReadiness.dashboardId === selectedDashboardId &&
    accessUsersReadiness.status === "failed";

  function updateUser(index: number, patch: Partial<AccessUserRow>) {
    if (!accessUsersReady) return;
    setUsers((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addUser() {
    if (!accessUsersReady) return;
    setUsers((current) => [...current, { email: "", password: "" }]);
  }

  function removeUser(index: number) {
    if (!accessUsersReady) return;
    setUsers((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveUsers() {
    if (!selectedDashboardId || !accessUsersReady) return;
    const targetDashboardId = selectedDashboardId;
    const selectionGeneration = accessUsersSelection.current.generation;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/access-users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard_id: targetDashboardId,
          users,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(String(json?.details ?? json?.error ?? "Failed to save users"));
      }
      if (accessUsersSelection.current.generation !== selectionGeneration) return;
      const nextUsers = Array.isArray(json?.users)
        ? (json.users as StoredAccessUser[]).map((item) => ({
            id: item.id,
            email: item.email,
            password: "",
          }))
        : [];
      setUsers(nextUsers);
      setMessage("Access users saved.");
    } catch (saveError) {
      if (accessUsersSelection.current.generation !== selectionGeneration) return;
      setError(saveError instanceof Error ? saveError.message : "Failed to save users");
    } finally {
      if (accessUsersSelection.current.generation === selectionGeneration) {
        setSaving(false);
      }
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-2 text-sm text-slate-600">Loading dashboards...</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
      <p className="mt-2 text-sm text-slate-600">
        Manage per-dashboard viewer access. Access rules depend on the selected dashboard.
      </p>

      <div className="mt-6 max-w-xl">
        <label className="block text-sm text-slate-700">
          Dashboard
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={selectedDashboardId ?? ""}
            disabled={saving || sharedPasswordSaving}
            onChange={(event) => setSelectedDashboardId(Number(event.target.value) || null)}
          >
            {dashboards.map((dashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {dashboard.client_name} - {dashboard.dashboard_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedDashboard ? (
        isSharedPasswordClient(selectedDashboard.client_id) ? (
          <div className="mt-6">
            <SharedPasswordSettings
              key={selectedDashboard.id}
              dashboardId={selectedDashboard.id}
              dashboardName={selectedDashboard.dashboard_name}
              onSavingChange={setSharedPasswordSaving}
            />
          </div>
        ) : (
          <div
            className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
            aria-label="Access users"
            aria-busy={accessUsersLoading || saving}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selectedDashboard.dashboard_name}</h2>
                <p className="text-sm text-slate-600">{selectedDashboard.url}</p>
              </div>
              <button
                type="button"
                onClick={addUser}
                disabled={!accessUsersReady}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add user
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {accessUsersLoading ? (
                <p className="text-sm text-slate-500">Loading access users...</p>
              ) : null}
              {accessUsersFailed ? (
                <p className="text-sm text-slate-500">Access users are unavailable.</p>
              ) : null}
              {accessUsersReady && users.length === 0 ? (
                <p className="text-sm text-slate-500">No viewer users. Dashboard is public.</p>
              ) : null}
              {accessUsersReady ? users.map((user, index) => (
                <div key={`${user.id ?? "new"}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]">
                  <label className="block text-sm text-slate-700">
                    Email
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      type="email"
                      value={user.email}
                      disabled={!accessUsersReady}
                      onChange={(event) => updateUser(index, { email: event.target.value })}
                      placeholder="client@example.com"
                    />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Password
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      type="password"
                      value={user.password}
                      disabled={!accessUsersReady}
                      onChange={(event) => updateUser(index, { password: event.target.value })}
                      placeholder={user.id ? "Leave blank to keep current password" : "Set password"}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeUser(index)}
                      disabled={!accessUsersReady}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )) : null}
            </div>

            {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
            {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}

            <div className="mt-4">
              <button
                type="button"
                onClick={saveUsers}
                disabled={saving || !selectedDashboardId || !accessUsersReady}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save access users"}
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
