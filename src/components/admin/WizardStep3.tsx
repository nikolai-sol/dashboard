"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardFormData, DashboardSourceForm } from "@/lib/admin-ui-types";
import { buildDefaultBrandId } from "@/lib/multibrand";

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
    () => data.sources.filter((source) => source.role === "actual" && source.platform !== "leads"),
    [data.sources],
  );
  const actualSourcesKey = useMemo(
    () =>
      actualSources
        .map(
          (source) =>
            `${source.platform}:${parseAccountIds(source.source_config?.account_ids).join(",")}`,
        )
        .join("|"),
    [actualSources],
  );
  const planSource = data.sources.find((source) => source.role === "plan");
  const multibrand = data.config.multibrand ?? {
    enabled: false,
    executive_title: "",
    executive_subtitle: "",
    brands: [],
  };

  const setActualSources = (nextActual: DashboardSourceForm[]) => {
    onChange({
      ...data,
      sources: planSource ? [...nextActual, planSource] : nextActual,
    });
  };

  const setMultibrand = (nextMultibrand: typeof multibrand) => {
    onChange({
      ...data,
      config: {
        ...data.config,
        multibrand: nextMultibrand,
      },
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
      if (data.config.period_from) params.set("date_from", data.config.period_from);
      if (data.config.period_to) params.set("date_to", data.config.period_to);
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
      void loadCampaigns(idx);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualSourcesKey, data.config.period_from, data.config.period_to]);

  const addBrand = () => {
    const index = multibrand.brands.length;
    const label = `Brand ${index + 1}`;
    setMultibrand({
      ...multibrand,
      brands: [
        ...multibrand.brands,
        {
          id: buildDefaultBrandId(label, index),
          label,
          color: ["#2563eb", "#e11d48", "#059669", "#7c3aed", "#ea580c", "#0891b2"][index % 6],
          description: "",
          channel_patterns: [],
          source_filters: actualSources.map((source) => ({
            platform: source.platform,
            filter_type: "name_pattern" as const,
            filter_value: "",
          })),
        },
      ],
    });
  };

  const updateBrand = (brandIndex: number, patch: Record<string, unknown>) => {
    const nextBrands = [...multibrand.brands];
    nextBrands[brandIndex] = {
      ...nextBrands[brandIndex],
      ...patch,
    };
    if (!String(nextBrands[brandIndex].id ?? "").trim()) {
      nextBrands[brandIndex].id = buildDefaultBrandId(String(nextBrands[brandIndex].label ?? ""), brandIndex);
    }
    setMultibrand({ ...multibrand, brands: nextBrands });
  };

  const removeBrand = (brandIndex: number) => {
    setMultibrand({
      ...multibrand,
      brands: multibrand.brands.filter((_, index) => index !== brandIndex),
    });
  };

  const updateBrandSourceFilter = (
    brandIndex: number,
    platform: string,
    patch: { filter_type?: "all" | "name_pattern" | "id_list"; filter_value?: string | null },
  ) => {
    const brand = multibrand.brands[brandIndex];
    if (!brand) return;
    const nextFilters = [...brand.source_filters];
    const existingIndex = nextFilters.findIndex((item) => item.platform === platform);
    if (existingIndex >= 0) {
      nextFilters[existingIndex] = {
        ...nextFilters[existingIndex],
        ...patch,
      };
    } else {
      nextFilters.push({
        platform,
        filter_type: patch.filter_type ?? "all",
        filter_value: patch.filter_value ?? null,
      });
    }
    updateBrand(brandIndex, { source_filters: nextFilters });
  };

  const getBrandSourceFilter = (brandIndex: number, platform: string) =>
    multibrand.brands[brandIndex]?.source_filters.find((item) => item.platform === platform) ?? {
      platform,
      filter_type: "all" as const,
      filter_value: null,
    };

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

      {multibrand.enabled ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Multibrand filters</h4>
              <p className="mt-1 text-xs text-slate-500">
                Define the executive brand slices for this dashboard. Each brand card behaves like its own awareness dashboard: source filters narrow actual campaign data, and brand channel rules map plan rows and fact channels to the same brand.
              </p>
            </div>
            <button
              type="button"
              onClick={addBrand}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs hover:bg-white"
            >
              Add brand
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {multibrand.brands.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                Add at least one brand to enable the multibrand dashboard layer.
              </div>
            ) : null}

            {multibrand.brands.map((brand, brandIndex) => (
              <article key={`${brand.id}-${brandIndex}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="grid gap-4 md:grid-cols-[1.2fr_1.2fr_140px_auto] md:items-end">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Brand label</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={brand.label}
                      onChange={(e) => updateBrand(brandIndex, { label: e.target.value })}
                      placeholder="ХЗН"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Brand ID</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={brand.id}
                      onChange={(e) => updateBrand(brandIndex, { id: e.target.value.trim().toLowerCase() })}
                      placeholder="xzn"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Color</span>
                    <input
                      type="color"
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 py-1"
                      value={brand.color}
                      onChange={(e) => updateBrand(brandIndex, { color: e.target.value })}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => removeBrand(brandIndex)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Description</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={brand.description ?? ""}
                      onChange={(e) => updateBrand(brandIndex, { description: e.target.value })}
                      placeholder="7 channels"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Brand channel rules</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={brand.channel_patterns.join(", ")}
                      onChange={(e) =>
                        updateBrand(brandIndex, {
                          channel_patterns: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="ХЗН, HZN, exact channel name"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      Used for media plan rows and channel-level brand matching. You can list brand words, SQL-like patterns with % and _, or exact fact channel names to assign a channel directly to this brand.
                    </span>
                  </label>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Source Filters
                  </div>
                  <p className="text-xs text-slate-500">
                    These filters build the actual awareness slice for the brand. Leave a platform on <span className="font-medium text-slate-700">All campaigns</span> only if that platform is not used for brand separation.
                  </p>
                  {actualSources.map((source) => {
                    const brandFilter = getBrandSourceFilter(brandIndex, source.platform);
                    return (
                      <div key={`${brand.id}-${source.platform}`} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[160px_160px_1fr]">
                        <div className="text-sm font-medium text-slate-900">{source.platform}</div>

                        <select
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={brandFilter.filter_type}
                          onChange={(e) =>
                            updateBrandSourceFilter(brandIndex, source.platform, {
                              filter_type: e.target.value as "all" | "name_pattern" | "id_list",
                              filter_value: e.target.value === "all" ? null : brandFilter.filter_value,
                            })
                          }
                        >
                          <option value="all">All campaigns</option>
                          <option value="name_pattern">Name pattern</option>
                          <option value="id_list">ID list</option>
                        </select>

                        <input
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={brandFilter.filter_value ?? ""}
                          onChange={(e) =>
                            updateBrandSourceFilter(brandIndex, source.platform, {
                              filter_value: e.target.value,
                            })
                          }
                          disabled={brandFilter.filter_type === "all"}
                          placeholder={
                            brandFilter.filter_type === "id_list"
                              ? "123,456,789"
                              : `%${brand.label || source.platform}%`
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
