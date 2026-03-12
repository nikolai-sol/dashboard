"use client";

import { useEffect, useState } from "react";
import DashboardList from "@/components/admin/DashboardList";
import type { DashboardListItem } from "@/lib/admin-ui-types";

export default function AdminDashboardsPage() {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboards = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/dashboards", { cache: "no-store" });
      const json = await response.json();
      setDashboards(json.dashboards ?? []);
    } catch {
      setDashboards([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboards();
  }, []);

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Dashboards</h1>
      <DashboardList dashboards={dashboards} loading={loading} onRefresh={loadDashboards} />
    </section>
  );
}
