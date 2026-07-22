"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function AdminAccessSettings() {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<number | null>(null);
  const [users, setUsers] = useState<AccessUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    async function loadUsers() {
      if (!selectedDashboardId) {
        setUsers([]);
        return;
      }
      if (
        selectedDashboard &&
        isSharedPasswordClient(selectedDashboard.client_id)
      ) {
        setUsers([]);
        setError(null);
        setMessage(null);
        return;
      }
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/api/admin/access-users?dashboard_id=${selectedDashboardId}`, {
          cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(String(json?.error ?? "Failed to load users"));
        }
        if (cancelled) return;
        const nextUsers = Array.isArray(json?.users)
          ? (json.users as StoredAccessUser[]).map((item) => ({
              id: item.id,
              email: item.email,
              password: "",
            }))
          : [];
        setUsers(nextUsers);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load users");
        }
      }
    }
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [selectedDashboard, selectedDashboardId]);

  function updateUser(index: number, patch: Partial<AccessUserRow>) {
    setUsers((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addUser() {
    setUsers((current) => [...current, { email: "", password: "" }]);
  }

  function removeUser(index: number) {
    setUsers((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveUsers() {
    if (!selectedDashboardId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/access-users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard_id: selectedDashboardId,
          users,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(String(json?.details ?? json?.error ?? "Failed to save users"));
      }
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
      setError(saveError instanceof Error ? saveError.message : "Failed to save users");
    } finally {
      setSaving(false);
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
            />
          </div>
        ) : (
          <div
            className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
            aria-label="Access users"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selectedDashboard.dashboard_name}</h2>
                <p className="text-sm text-slate-600">{selectedDashboard.url}</p>
              </div>
              <button
                type="button"
                onClick={addUser}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                Add user
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {users.length === 0 ? (
                <p className="text-sm text-slate-500">No viewer users. Dashboard is public.</p>
              ) : null}
              {users.map((user, index) => (
                <div key={`${user.id ?? "new"}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]">
                  <label className="block text-sm text-slate-700">
                    Email
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      type="email"
                      value={user.email}
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
                      onChange={(event) => updateUser(index, { password: event.target.value })}
                      placeholder={user.id ? "Leave blank to keep current password" : "Set password"}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeUser(index)}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
            {message ? <p className="mt-4 text-sm text-emerald-600">{message}</p> : null}

            <div className="mt-4">
              <button
                type="button"
                onClick={saveUsers}
                disabled={saving || !selectedDashboardId}
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
