"use client";

import Link from "next/link";
import { useState } from "react";
import type { DashboardListItem } from "@/lib/admin-ui-types";

type DashboardListProps = {
  dashboards: DashboardListItem[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export default function DashboardList({ dashboards, loading = false, onRefresh }: DashboardListProps) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const removeDashboard = async (id: number) => {
    const confirmed = window.confirm("Delete this dashboard?");
    if (!confirmed) return;

    setBusyId(id);
    try {
      await fetch(`/api/admin/dashboards/${id}`, { method: "DELETE" });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const cloneDashboard = async (id: number, currentClientId: string, currentClientName: string) => {
    const clientId = window.prompt("New client_id", `${currentClientId}_copy`);
    if (!clientId) return;
    const clientName = window.prompt("New client_name", `${currentClientName} Copy`) ?? `${currentClientName} Copy`;

    setBusyId(id);
    try {
      await fetch(`/api/admin/dashboards/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_name: clientName }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Dashboards</h2>
        <Link
          href="/admin/dashboards/new"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + Create new
        </Link>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading...</p> : null}

      {!loading && dashboards.length === 0 ? (
        <p className="text-sm text-slate-500">No dashboards yet.</p>
      ) : null}

      {!loading && dashboards.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Dashboard</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Sources</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dashboards.map((dashboard) => (
                <tr key={dashboard.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{dashboard.client_id}</td>
                  <td className="px-3 py-2 text-slate-700">{dashboard.dashboard_name}</td>
                  <td className="px-3 py-2 text-slate-600">{dashboard.dashboard_type}</td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(dashboard.created_at)}</td>
                  <td className="px-3 py-2 text-slate-600">{dashboard.sources_count}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <a
                        href={dashboard.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        View
                      </a>
                      <Link
                        href={`/admin/dashboards/${dashboard.id}/edit`}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/dashboards/${dashboard.id}/media-plan`}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        Plan
                      </Link>
                      <Link
                        href={`/admin/dashboards/${dashboard.id}/google-ads`}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        GAds
                      </Link>
                      <Link
                        href={`/admin/dashboards/${dashboard.id}/yandex-direct`}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        YDirect
                      </Link>
                      <button
                        type="button"
                        onClick={() => cloneDashboard(dashboard.id, dashboard.client_id, dashboard.client_name)}
                        disabled={busyId === dashboard.id}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Clone
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDashboard(dashboard.id)}
                        disabled={busyId === dashboard.id}
                        className="rounded border border-rose-200 px-2 py-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
