"use client";

import type { DashboardFormData } from "@/lib/admin-ui-types";

type WizardStep1Props = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

export default function WizardStep1({ data, onChange }: WizardStep1Props) {
  const setField = (key: keyof DashboardFormData, value: string) => {
    onChange({ ...data, [key]: value });
  };

  const setConfig = (key: keyof DashboardFormData["config"], value: string) => {
    onChange({
      ...data,
      config: {
        ...data.config,
        [key]: value,
      },
    });
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client ID</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.client_id}
            onChange={(e) => setField("client_id", e.target.value.toLowerCase())}
            placeholder="rag_mp"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client Name</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.client_name}
            onChange={(e) => setField("client_name", e.target.value)}
            placeholder="RAG Market Place"
          />
        </label>
      </div>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-700">Dashboard Name</span>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          value={data.dashboard_name}
          onChange={(e) => setField("dashboard_name", e.target.value)}
          placeholder="Awareness Q1 2025"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Type</span>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.dashboard_type}
            onChange={(e) => onChange({ ...data, dashboard_type: e.target.value as DashboardFormData["dashboard_type"] })}
          >
            <option value="awareness">Awareness</option>
            <option value="performance">Performance</option>
            <option value="overview">Overview</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Period From</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.config.period_from}
            onChange={(e) => setConfig("period_from", e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Period To</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={data.config.period_to}
            onChange={(e) => setConfig("period_to", e.target.value)}
          />
        </label>
      </div>

      <label className="text-sm md:w-56">
        <span className="mb-1 block font-medium text-slate-700">Currency</span>
        <select
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          value={data.config.currency}
          onChange={(e) => setConfig("currency", e.target.value as DashboardFormData["config"]["currency"])}
        >
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
          <option value="RUB">RUB</option>
        </select>
      </label>
    </section>
  );
}
