"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, DashboardSourceForm } from "@/lib/admin-ui-types";

type Campaign = {
  id: string;
  name: string;
  platform: string;
  copyable_id?: string;
};

type WizardStep3Props = {
  data: DashboardFormData;
  onChange: (next: DashboardFormData) => void;
};

function parseIdList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export default function WizardStep3({ data, onChange }: WizardStep3Props) {
  const [campaignsBySource, setCampaignsBySource] = useState<Record<number, Campaign[]>>({});
  const [searchBySource, setSearchBySource] = useState<Record<number, string>>({});
  const [loadingBySource, setLoadingBySource] = useState<Record<number, boolean>>({});

  const actualSources = useMemo(
    () => data.sources.filter((source) => source.role === "actual"),
    [data.sources],
  );
  const planSource = data.sources.find((source) => source.role === "plan");

  const setActualSources = (nextActual: DashboardSourceForm[]) => {
    onChange({
      ...data,
      sources: planSource ? [...nextActual, planSource] : nextActual,
    });
  };

  const updateFilter = (sourceIndex: number, nextFilter: DashboardSourceForm["filters"][number]) => {
    const nextActual = [...actualSources];
    nextActual[sourceIndex] = {
      ...nextActual[sourceIndex],
      filters: [nextFilter],
    };
    setActualSources(nextActual);
  };

  const loadCampaigns = async (sourceIndex: number, search?: string) => {
    const source = actualSources[sourceIndex];
    if (!source) return;

    setLoadingBySource((prev) => ({ ...prev, [sourceIndex]: true }));
    try {
      const params = new URLSearchParams({ platform: source.platform });
      if (search) params.set("search", search);
      const accountIds = parseAccountIds(source.source_config?.account_ids);
      if (accountIds.length) {
        params.set("account_ids", accountIds.join(","));
      }
      const response = await fetch(`/api/admin/campaigns?${params.toString()}`);
      const json = await response.json();
      setCampaignsBySource((prev) => ({ ...prev, [sourceIndex]: json.campaigns ?? [] }));
    } catch {
      setCampaignsBySource((prev) => ({ ...prev, [sourceIndex]: [] }));
    } finally {
      setLoadingBySource((prev) => ({ ...prev, [sourceIndex]: false }));
    }
  };

  useEffect(() => {
    actualSources.forEach((_, idx) => {
      if (!campaignsBySource[idx]) {
        void loadCampaigns(idx);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualSources.map((source) => source.platform).join("|")]);

  return (
    <section className="space-y-4">
      {actualSources.map((source, index) => {
        const filter = source.filters[0] ?? { filter_type: "all", filter_value: null };
        const campaigns = campaignsBySource[index] ?? [];
        const selectedIds = parseIdList(filter.filter_value);
        const searchTerm = searchBySource[index] ?? "";

        const patternCount =
          filter.filter_type === "name_pattern" && filter.filter_value
            ? campaigns.filter((campaign) =>
                campaign.name.toLowerCase().includes(filter.filter_value!.replace(/[%_]/g, "").toLowerCase()),
              ).length
            : campaigns.length;

        return (
          <article key={`${source.platform}-${index}`} className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-900">{source.platform} - campaign filter</h4>

            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={filter.filter_type === "all"}
                  onChange={() => updateFilter(index, { filter_type: "all", filter_value: null })}
                />
                All campaigns
              </label>

              <label className="block">
                <div className="mb-1 flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filter.filter_type === "name_pattern"}
                    onChange={() => updateFilter(index, { filter_type: "name_pattern", filter_value: "" })}
                  />
                  Name pattern
                </div>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={filter.filter_type === "name_pattern" ? filter.filter_value ?? "" : ""}
                  onChange={(e) =>
                    updateFilter(index, { filter_type: "name_pattern", filter_value: e.target.value })
                  }
                  disabled={filter.filter_type !== "name_pattern"}
                  placeholder="rag_mp_%"
                />
                {filter.filter_type === "name_pattern" ? (
                  <p className="mt-1 text-xs text-slate-500">Matched: {patternCount}</p>
                ) : null}
              </label>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={filter.filter_type === "id_list"}
                    onChange={() => updateFilter(index, { filter_type: "id_list", filter_value: "" })}
                  />
                  Select manually
                </label>

                {filter.filter_type === "id_list" ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        value={searchTerm}
                        onChange={(e) => setSearchBySource((prev) => ({ ...prev, [index]: e.target.value }))}
                        placeholder="search campaigns"
                      />
                      <button
                        type="button"
                        onClick={() => loadCampaigns(index, searchTerm)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50"
                      >
                        Search
                      </button>
                    </div>

                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {loadingBySource[index] ? (
                        <p className="text-xs text-slate-500">Loading...</p>
                      ) : campaigns.length === 0 ? (
                        <p className="text-xs text-slate-500">No campaigns in DB yet for this platform.</p>
                      ) : (
                        campaigns.map((campaign) => {
                          const checked = selectedIds.includes(campaign.id);
                          return (
                            <div key={campaign.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                              <label className="flex flex-1 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) {
                                      next.add(campaign.id);
                                    } else {
                                      next.delete(campaign.id);
                                    }
                                    updateFilter(index, {
                                      filter_type: "id_list",
                                      filter_value: Array.from(next).join(","),
                                    });
                                  }}
                                />
                                <span className="font-mono text-slate-500">{campaign.id}</span>
                                <span className="truncate">{campaign.name}</span>
                              </label>
                              <button
                                type="button"
                                onClick={async () => {
                                  const value = campaign.copyable_id ?? campaign.id;
                                  try {
                                    await navigator.clipboard.writeText(value);
                                  } catch {
                                    // ignore clipboard errors
                                  }
                                }}
                                className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                              >
                                Copy ID
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Selected: {selectedIds.length}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const match = searchTerm.trim().toLowerCase();
                          const matchedIds = campaigns
                            .filter((campaign) =>
                              match ? campaign.name.toLowerCase().includes(match) : true,
                            )
                            .map((campaign) => campaign.id);
                          updateFilter(index, {
                            filter_type: "id_list",
                            filter_value: matchedIds.join(","),
                          });
                        }}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        Select all by search
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
