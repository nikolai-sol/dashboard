"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ChannelMix from "@/components/ChannelMix";
import CampaignPerformanceTable from "@/components/CampaignPerformanceTable";
import DashboardAccessGate from "@/components/DashboardAccessGate";
import ChannelPerformanceTable from "@/components/ChannelPerformanceTable";
import ComparisonSection from "@/components/ComparisonSection";
import ConversionFunnel from "@/components/ConversionFunnel";
import CustomTable from "@/components/CustomTable";
import DashboardAiSummaryCard from "@/components/DashboardAiSummaryCard";
import DashboardHeader from "@/components/DashboardHeader";
import KPICard from "@/components/KPICard";
import PlatformFilter from "@/components/PlatformFilter";
import PlatformPlanVsFact from "@/components/PlatformPlanVsFact";
import PlatformTable from "@/components/PlatformTable";
import PlanVsFact from "@/components/PlanVsFact";
import PromopagesSection from "@/components/PromopagesSection";
import AnalyticsSection from "@/components/AnalyticsSection";
import PostClickAnalyticsTable from "@/components/PostClickAnalyticsTable";
import SpendByPlatform from "@/components/SpendByPlatform";
import SpendConversionsScatter from "@/components/SpendConversionsScatter";
import TrendChart from "@/components/TrendChart";
import MultibrandPanel from "@/components/MultibrandPanel";
import MultibrandExecutivePage from "@/components/MultibrandExecutivePage";
import AbbottBiDashboard from "@/components/AbbottBiDashboard";
import type { MultibrandBrandSummary } from "@/components/MultibrandExecutivePage";
import { getDashboardI18n } from "@/lib/dashboard-i18n";
import type { DashboardData } from "@/lib/types";
import { resolvePlatformIdFromSourceKey } from "@/lib/source-mapping";

const SPEND_RELATED_KPIS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);

type RenderableKpiCard = {
  key: string;
  title: string;
  value: number;
  prev: number;
  color: string;
  format: (value: number) => string;
  trend: number[];
  deltaOverride?: number | null;
};

type DashboardAuthMeta = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  auth_mode?: "email_password" | "password_only";
};

type MultibrandSummary = MultibrandBrandSummary & {
  platforms_count: number;
};

function buildAwarenessTotals(data: DashboardData | null | undefined) {
  const platforms = data?.platforms ?? [];
  const boundPromopages = data?.bound_promopages?.by_channel ?? [];

  const baseImpressions = platforms.reduce((sum, item) => sum + item.impressions, 0);
  const baseClicks = platforms.reduce((sum, item) => sum + item.clicks, 0);
  const baseSpend = platforms.reduce((sum, item) => sum + item.spend, 0);
  const baseConversions = platforms.reduce((sum, item) => sum + item.conversions, 0);
  const baseViews = platforms.reduce((sum, item) => sum + item.views, 0);
  const baseReach = platforms.reduce((sum, item) => sum + item.reach, 0);

  const promoImpressions = boundPromopages.reduce((sum, item) => sum + item.impressions, 0);
  const promoClicks = boundPromopages.reduce((sum, item) => sum + item.clicks, 0);
  const promoSpend = boundPromopages.reduce((sum, item) => sum + item.spend, 0);
  const promoViews = boundPromopages.reduce((sum, item) => sum + item.views, 0);
  const promoReach = boundPromopages.reduce((sum, item) => sum + item.reach, 0);

  const totalImpressions = baseImpressions + promoImpressions;
  const totalClicks = baseClicks + promoClicks;
  const totalSpend = baseSpend + promoSpend;
  const totalConversions = baseConversions;
  const totalViews = baseViews + promoViews;
  const totalReach = baseReach + promoReach;
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  return {
    totalImpressions,
    totalClicks,
    totalSpend,
    totalConversions,
    totalViews,
    totalReach,
    avgCtr,
  };
}

function money(value: number, currency = "EUR", locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function moneyFixed2(value: number, currency = "EUR", locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function compact(value: number, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(Math.round(value));
}

function formatPeriodDate(isoDate: string, locale = "en-GB") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || "—";
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDate || "—";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

async function getDashboardData(
  id: string,
  range?: { from: string; to: string },
  compareRange?: { from: string; to: string } | null,
  accessToken?: string,
  embedKey?: string,
  brandId?: string | null,
): Promise<{
  data: DashboardData | null;
  demoMode: boolean;
  errorMessage: string | null;
  authRequired: boolean;
  authMeta: DashboardAuthMeta | null;
  notFound: boolean;
}> {
  try {
    const params = new URLSearchParams();
    if (range?.from && range?.to) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    if (compareRange?.from && compareRange?.to) {
      params.set("compare_from", compareRange.from);
      params.set("compare_to", compareRange.to);
    }
    if (accessToken) {
      params.set("access_token", accessToken);
    }
    if (embedKey) {
      params.set("embed_key", embedKey);
    }
    if (brandId) {
      params.set("brand", brandId);
    }
    const query = params.toString();
    const response = await fetch(`/api/dashboard/${id}${query ? `?${query}` : ""}`, { cache: "no-store" });
    if (response.status === 401) {
      const json = (await response.json().catch(() => null)) as
        | { dashboard?: DashboardAuthMeta }
        | null;
      return {
        data: null,
        demoMode: false,
        errorMessage: null,
        authRequired: true,
        authMeta: json?.dashboard ?? null,
        notFound: false,
      };
    }
    if (response.status === 404) {
      return {
        data: null,
        demoMode: false,
        errorMessage: "Dashboard not found",
        authRequired: false,
        authMeta: null,
        notFound: true,
      };
    }
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = (await response.json()) as DashboardData;
    return { data, demoMode: false, errorMessage: null, authRequired: false, authMeta: null, notFound: false };
  } catch (error) {
    console.warn("API unavailable, using mock data:", error);
    const { mockDashboardData } = await import("@/lib/mock-data");
    const message = error instanceof Error ? error.message : "Unknown API error";
    return {
      data: mockDashboardData,
      demoMode: true,
      errorMessage: message,
      authRequired: false,
      authMeta: null,
      notFound: false,
    };
  }
}

function shiftDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMonth(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetDate = new Date(Date.UTC(year, targetMonth + 1, 0));
  const clampedDay = Math.min(day, targetDate.getUTCDate());
  return new Date(Date.UTC(year, targetMonth, clampedDay)).toISOString().slice(0, 10);
}

function shiftYear(isoDate: string, years: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(year + years, month - 1, clampedDay)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
}

function buildCompareRange(
  preset: "previous" | "month" | "week" | "year" | "custom",
  from: string,
  to: string,
  customFrom: string,
  customTo: string,
) {
  if (!from || !to) return { from: "", to: "" };
  const span = daysBetween(from, to);
  if (preset === "custom") {
    return { from: customFrom, to: customTo };
  }
  if (preset === "previous") {
    const compareTo = shiftDate(from, -1);
    const compareFrom = shiftDate(compareTo, -(span - 1));
    return { from: compareFrom, to: compareTo };
  }
  if (preset === "month") {
    return { from: shiftMonth(from, -1), to: shiftMonth(to, -1) };
  }
  if (preset === "week") {
    const compareTo = shiftDate(to, -7);
    const compareFrom = shiftDate(compareTo, -6);
    return { from: compareFrom, to: compareTo };
  }
  return { from: shiftYear(from, -1), to: shiftYear(to, -1) };
}

export default function DashboardByIdPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardId = params?.id ? String(params.id).toLowerCase() : "rag_mp";
  const initialFrom = searchParams.get("from") ?? "";
  const initialTo = searchParams.get("to") ?? "";
  const initialCompareFrom = searchParams.get("compare_from") ?? "";
  const initialCompareTo = searchParams.get("compare_to") ?? "";
  const initialAccessToken = searchParams.get("access_token") ?? "";
  const initialEmbedKey = searchParams.get("embed_key") ?? "";
  const initialBrandId = searchParams.get("brand") ?? "";
  const isPdfMode = searchParams.get("pdf") === "true";
  const isMobileMode = searchParams.get("mobile") === "1";

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"platform" | "channel">("platform");
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authMeta, setAuthMeta] = useState<DashboardAuthMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerAccessToken, setViewerAccessToken] = useState(initialAccessToken);
  const [viewerEmbedKey] = useState(initialEmbedKey);
  const [selectedBrandId, setSelectedBrandId] = useState(initialBrandId);
  const [brandSummaries, setBrandSummaries] = useState<MultibrandSummary[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [isGeneratingAiSummary, setIsGeneratingAiSummary] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: initialFrom, to: initialTo });
  const [draftDateRange, setDraftDateRange] = useState<{ from: string; to: string }>({
    from: initialFrom,
    to: initialTo,
  });
  const [compareOpen, setCompareOpen] = useState(Boolean(initialCompareFrom && initialCompareTo));
  const [comparePreset, setComparePreset] = useState<"previous" | "month" | "week" | "year" | "custom">("month");
  const [compareRange, setCompareRange] = useState<{ from: string; to: string }>({
    from: initialCompareFrom,
    to: initialCompareTo,
  });
  const [draftCompareRange, setDraftCompareRange] = useState<{ from: string; to: string }>({
    from: initialCompareFrom,
    to: initialCompareTo,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const result = await getDashboardData(
        dashboardId,
        dateRange.from && dateRange.to ? dateRange : undefined,
        compareRange.from && compareRange.to ? compareRange : null,
        viewerAccessToken || undefined,
        viewerEmbedKey || undefined,
        selectedBrandId || undefined,
      );
      if (cancelled) {
        return;
      }

      if (result.authRequired) {
        setDashboard(null);
        setIsDemoMode(false);
        setApiError(null);
        setAuthRequired(true);
        setAuthMeta(result.authMeta);
        setNotFound(false);
        setIsLoading(false);
        return;
      }
      if (result.notFound) {
        setDashboard(null);
        setIsDemoMode(false);
        setApiError(result.errorMessage);
        setAuthRequired(false);
        setAuthMeta(null);
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      setDashboard(result.data);
      setIsDemoMode(result.demoMode);
      setApiError(result.errorMessage);
      setAiSummaryError(null);
      setAuthRequired(false);
      setAuthMeta(null);
      setNotFound(false);

      const availablePlatforms = result.data?.platforms.map((platform) => platform.id) ?? [];
      setSelectedPlatforms(availablePlatforms);
      const availableChannels = (result.data?.channel_performance ?? []).map((item) => item.channel);
      setSelectedChannels(availableChannels);
      setFilterMode(result.data?.dashboard.filter_scope === "channel" ? "channel" : "platform");
      setDraftDateRange((prev) => ({
        from: prev.from || result.data?.dashboard.period.from || "",
        to: prev.to || result.data?.dashboard.period.to || "",
      }));
      setIsLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [compareRange, dashboardId, dateRange, reloadKey, selectedBrandId, viewerAccessToken, viewerEmbedKey]);

  async function generateAiSummary() {
    if (!dashboard?.ai_summary_enabled || isGeneratingAiSummary) {
      return;
    }

    setIsGeneratingAiSummary(true);
    setAiSummaryError(null);

    try {
      const params = new URLSearchParams();
      if (dateRange.from && dateRange.to) {
        params.set("from", dateRange.from);
        params.set("to", dateRange.to);
      }
      if (compareRange.from && compareRange.to) {
        params.set("compare_from", compareRange.from);
        params.set("compare_to", compareRange.to);
      }
      if (viewerAccessToken) {
        params.set("access_token", viewerAccessToken);
      }
      if (viewerEmbedKey) {
        params.set("embed_key", viewerEmbedKey);
      }
      if (selectedBrandId) {
        params.set("brand", selectedBrandId);
      }

      const query = params.toString();
      const response = await fetch(
        `/api/dashboard/${dashboardId}/ai-summary/generate${query ? `?${query}` : ""}`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { effective_summary?: DashboardData["ai_summary"]; error?: string; details?: string }
        | null;

      if (!response.ok || !payload?.effective_summary) {
        throw new Error(payload?.error || payload?.details || `API returned ${response.status}`);
      }

      setDashboard((prev) =>
        prev
          ? {
              ...prev,
              ai_summary: payload.effective_summary,
              ai_summary_enabled: true,
            }
          : prev,
      );
    } catch (error) {
      setAiSummaryError(error instanceof Error ? error.message : "Failed to generate summary");
    } finally {
      setIsGeneratingAiSummary(false);
    }
  }

  useEffect(() => {
    setSelectedBrandId(initialBrandId);
  }, [initialBrandId]);

  const effectiveDraftCompareRange = useMemo(() => {
    const effectiveFrom = draftDateRange.from || dashboard?.dashboard.period.from || "";
    const effectiveTo = draftDateRange.to || dashboard?.dashboard.period.to || "";
    if (comparePreset === "custom") {
      return draftCompareRange;
    }
    return buildCompareRange(comparePreset, effectiveFrom, effectiveTo, draftCompareRange.from, draftCompareRange.to);
  }, [
    comparePreset,
    dashboard?.dashboard.period.from,
    dashboard?.dashboard.period.to,
    draftCompareRange,
    draftDateRange.from,
    draftDateRange.to,
  ]);

  const selectedSet = useMemo(() => new Set(selectedPlatforms), [selectedPlatforms]);
  const selectedChannelSet = useMemo(() => new Set(selectedChannels), [selectedChannels]);
  const filterScope = dashboard?.dashboard.filter_scope ?? "both";
  const effectiveFilterMode = filterScope === "both" ? filterMode : filterScope;

  const channelVisiblePlatformIds = useMemo(() => {
    if (!dashboard) return new Set<string>();
    const ids = new Set<string>();
    dashboard.plan_vs_fact.forEach((item) => {
      if (!selectedChannelSet.has(item.channel)) return;
      item.platforms.forEach((platform) => ids.add(resolvePlatformIdFromSourceKey(platform.source_key)));
    });
    return ids;
  }, [dashboard, selectedChannelSet]);

  const filteredPlatforms = useMemo(() => {
    if (!dashboard) return [];
    if (effectiveFilterMode === "channel") {
      return dashboard.platforms.filter((item) => channelVisiblePlatformIds.has(item.id));
    }
    return dashboard.platforms.filter((item) => selectedSet.has(item.id));
  }, [channelVisiblePlatformIds, dashboard, effectiveFilterMode, selectedSet]);

  const filteredTimeseries = useMemo(() => {
    if (!dashboard) return [];
    if (effectiveFilterMode === "channel") {
      return dashboard.timeseries.filter((item) => channelVisiblePlatformIds.has(item.platform));
    }
    return dashboard.timeseries.filter((item) => selectedSet.has(item.platform));
  }, [channelVisiblePlatformIds, dashboard, effectiveFilterMode, selectedSet]);

  const filteredPlanVsFact = useMemo(() => {
    if (!dashboard) return [];
    const platformFiltered = dashboard.plan_vs_fact.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => {
          const platformId = resolvePlatformIdFromSourceKey(platform.source_key);
          return platformId === "yandex_promopages" || selectedSet.has(platformId);
        }),
    );
    if (effectiveFilterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard, effectiveFilterMode, selectedChannelSet, selectedSet]);

  const filteredChannelPerformance = useMemo(() => {
    if (!dashboard?.channel_performance) return [];
    const platformFiltered = dashboard.channel_performance.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => {
          const platformId = resolvePlatformIdFromSourceKey(platform.source_key);
          return platformId === "yandex_promopages" || selectedSet.has(platformId);
        }),
    );
    if (effectiveFilterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard, effectiveFilterMode, selectedChannelSet, selectedSet]);

  const filteredChannelTimeseries = useMemo(() => {
    if (!dashboard?.channel_timeseries) return [];
    if (effectiveFilterMode === "channel") {
      return dashboard.channel_timeseries.filter((item) => selectedChannelSet.has(item.channel));
    }
    return dashboard.channel_timeseries;
  }, [dashboard, effectiveFilterMode, selectedChannelSet]);

  const filteredBoundPromopages = useMemo(() => {
    if (!dashboard?.bound_promopages) {
      return {
        byChannel: [],
        timeseries: [],
      };
    }
    const visibleChannels = new Set(filteredPlanVsFact.map((item) => item.channel));
    return {
      byChannel: dashboard.bound_promopages.by_channel.filter((item) => visibleChannels.has(item.channel)),
      timeseries: dashboard.bound_promopages.timeseries.filter((item) => visibleChannels.has(item.channel)),
    };
  }, [dashboard, filteredPlanVsFact]);

  const filteredPostClickAnalytics = useMemo(() => {
    if (!dashboard?.postclick_analytics) {
      return {
        rows: [],
        timeseries: [],
      };
    }
    const visibleChannels = new Set(filteredPlanVsFact.map((item) => item.channel));
    return {
      rows: dashboard.postclick_analytics.rows.filter((item) => visibleChannels.has(item.channel)),
      timeseries: dashboard.postclick_analytics.timeseries.filter((item) => visibleChannels.has(item.channel)),
    };
  }, [dashboard, filteredPlanVsFact]);

  const currencyCode = dashboard?.dashboard.currency || "EUR";
  const dashboardLanguage = dashboard?.dashboard.language ?? "en";
  const i18n = useMemo(() => getDashboardI18n(dashboardLanguage), [dashboardLanguage]);
  const locale = i18n.locale;
  const showSpend = dashboard?.dashboard.show_spend ?? true;
  const multibrand = dashboard?.dashboard.multibrand;
  const sectionOrder = dashboard?.dashboard.section_order ?? [];
  const dashboardType = dashboard?.dashboard.type ?? "awareness";
  const visibleMetrics = (dashboard?.visible_metrics ?? dashboard?.kpi_config ?? []).filter(
    (metric) => showSpend || !SPEND_RELATED_KPIS.has(metric),
  );
  const channelOptions = useMemo(
    () =>
      (dashboard?.channel_performance ?? []).map((item) => ({
        id: item.channel,
        name: item.channel,
        color: item.platforms[0]?.color ?? "#94a3b8",
      })),
    [dashboard?.channel_performance],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadBrandSummaries() {
      if (!dashboard?.dashboard.multibrand?.enabled || !dashboard.dashboard.multibrand.brands.length) {
        setBrandSummaries([]);
        return;
      }

      const summaries = await Promise.all(
        dashboard.dashboard.multibrand.brands.map(async (brand) => {
          const result = await getDashboardData(
            dashboardId,
            dateRange.from && dateRange.to ? dateRange : undefined,
            null,
            viewerAccessToken || undefined,
            brand.id,
          );
          const brandData = result.data;
          const brandTotals = buildAwarenessTotals(brandData);
          return {
            id: brand.id,
            label: brand.label,
            color: brand.color,
            description: brand.description,
            total_impressions: brandTotals.totalImpressions,
            total_clicks: brandTotals.totalClicks,
            total_spend: brandTotals.totalSpend,
            total_conversions: brandTotals.totalConversions,
            avg_ctr: brandTotals.avgCtr,
            total_views: brandTotals.totalViews,
            total_reach: brandTotals.totalReach,
            platforms_count: brandData?.platforms.length ?? 0,
            channels_count: brandData?.channel_performance?.length ?? 0,
          } satisfies MultibrandSummary;
        }),
      );

      if (!cancelled) {
        setBrandSummaries(summaries);
      }
    }

    void loadBrandSummaries();

    return () => {
      cancelled = true;
    };
  }, [dashboard?.dashboard.multibrand, dashboardId, dateRange, viewerAccessToken]);

  const multibrandExecutiveTotals = useMemo(() => {
    return brandSummaries.reduce(
      (acc, brand) => {
        acc.impressions += brand.total_impressions;
        acc.clicks += brand.total_clicks;
        acc.spend += brand.total_spend;
        acc.conversions += brand.total_conversions;
        acc.views += brand.total_views;
        acc.reach += brand.total_reach;
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, views: 0, reach: 0 },
    );
  }, [brandSummaries]);

  const multibrandExecutiveCtr = useMemo(() => {
    return multibrandExecutiveTotals.impressions > 0
      ? (multibrandExecutiveTotals.clicks / multibrandExecutiveTotals.impressions) * 100
      : 0;
  }, [multibrandExecutiveTotals.clicks, multibrandExecutiveTotals.impressions]);

  const totals = useMemo(() => {
    const baseImpressions = filteredPlatforms.reduce((sum, item) => sum + item.impressions, 0);
    const baseClicks = filteredPlatforms.reduce((sum, item) => sum + item.clicks, 0);
    const baseSpend = filteredPlatforms.reduce((sum, item) => sum + item.spend, 0);
    const totalConversions = filteredPlatforms.reduce((sum, item) => sum + item.conversions, 0);
    const baseViews = filteredPlatforms.reduce((sum, item) => sum + item.views, 0);
    const baseReach = filteredPlatforms.reduce((sum, item) => sum + item.reach, 0);
    const promoImpressions = filteredBoundPromopages.byChannel.reduce((sum, item) => sum + item.impressions, 0);
    const promoClicks = filteredBoundPromopages.byChannel.reduce((sum, item) => sum + item.clicks, 0);
    const promoSpend = filteredBoundPromopages.byChannel.reduce((sum, item) => sum + item.spend, 0);
    const promoViews = filteredBoundPromopages.byChannel.reduce((sum, item) => sum + item.views, 0);
    const promoReach = filteredBoundPromopages.byChannel.reduce((sum, item) => sum + item.reach, 0);
    const totalImpressions = baseImpressions + promoImpressions;
    const totalClicks = baseClicks + promoClicks;
    const totalSpend = baseSpend + promoSpend;
    const totalViews = baseViews + promoViews;
    const totalReach = baseReach + promoReach;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const avgCpv = totalViews > 0 ? totalSpend / totalViews : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const avgFrequency = totalReach > 0 ? totalImpressions / totalReach : 0;
    return {
      totalImpressions,
      totalClicks,
      totalSpend,
      totalConversions,
      totalViews,
      totalReach,
      avgCtr,
      avgCpm,
      avgCpc,
      avgCpv,
      avgCpa,
      avgFrequency,
    };
  }, [filteredBoundPromopages.byChannel, filteredPlatforms]);

  const scales = useMemo(() => {
    const kpi = dashboard?.kpi;
    if (!kpi) {
      return { impressions: 0.9, clicks: 0.9, spend: 0.95 };
    }

    return {
      impressions: kpi.total_impressions > 0 ? kpi.prev_impressions / kpi.total_impressions : 0.9,
      clicks: kpi.total_clicks > 0 ? kpi.prev_clicks / kpi.total_clicks : 0.9,
      spend: kpi.total_spend > 0 ? kpi.prev_spend / kpi.total_spend : 0.95,
    };
  }, [dashboard?.kpi]);

  const previousTotals = useMemo(() => {
    const prevImpressions = totals.totalImpressions * scales.impressions;
    const prevClicks = totals.totalClicks * scales.clicks;
    const prevSpend = totals.totalSpend * scales.spend;
    const prevViews = totals.totalViews * scales.impressions;
    const prevConversions = totals.totalConversions * scales.clicks;
    const prevReach = totals.totalReach * scales.impressions;
    const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
    const prevCpm = prevImpressions > 0 ? (prevSpend / prevImpressions) * 1000 : 0;
    const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;
    const prevCpv = prevViews > 0 ? prevSpend / prevViews : 0;
    const prevCpa = prevConversions > 0 ? prevSpend / prevConversions : 0;
    const prevFrequency = prevReach > 0 ? prevImpressions / prevReach : 0;
    return {
      prevImpressions,
      prevClicks,
      prevSpend,
      prevViews,
      prevConversions,
      prevReach,
      prevCtr,
      prevCpm,
      prevCpc,
      prevCpv,
      prevCpa,
      prevFrequency,
    };
  }, [
    scales.clicks,
    scales.impressions,
    scales.spend,
    totals.totalClicks,
    totals.totalConversions,
    totals.totalImpressions,
    totals.totalReach,
    totals.totalSpend,
    totals.totalViews,
  ]);

  const aggregatedDaily = useMemo(() => {
    const byDate = new Map<
      string,
      { impressions: number; clicks: number; spend: number; conversions: number; views: number }
    >();
    const cvByPlatform = new Map(
      filteredPlatforms.map((platform) => [
        platform.id,
        platform.clicks > 0 ? platform.conversions / platform.clicks : 0,
      ]),
    );
    const viewByPlatform = new Map(
      filteredPlatforms.map((platform) => [
        platform.id,
        platform.impressions > 0 ? platform.views / platform.impressions : 0,
      ]),
    );

    filteredTimeseries.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, { impressions: 0, clicks: 0, spend: 0, conversions: 0, views: 0 });
      }
      const row = byDate.get(point.date)!;
      row.impressions += point.impressions;
      row.clicks += point.clicks;
      row.spend += point.spend;
      row.conversions += point.clicks * (cvByPlatform.get(point.platform) ?? 0);
      row.views += point.impressions * (viewByPlatform.get(point.platform) ?? 0);
    });

    filteredBoundPromopages.timeseries.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, { impressions: 0, clicks: 0, spend: 0, conversions: 0, views: 0 });
      }
      const row = byDate.get(point.date)!;
      row.impressions += point.impressions;
      row.clicks += point.clicks;
      row.spend += point.spend;
      row.views += point.views;
    });

    return [...byDate.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredBoundPromopages.timeseries, filteredPlatforms, filteredTimeseries]);

  const latestTrend = useMemo(() => aggregatedDaily.slice(-30), [aggregatedDaily]);

  const kpiCards = useMemo<RenderableKpiCard[]>(() => {
    const kpiConfig = (dashboard?.kpi_config?.slice(0, 5) ?? ["impressions", "clicks", "ctr", "cpm", "spend"])
      .filter((metric) => showSpend || !SPEND_RELATED_KPIS.has(metric));

    const metricMap = {
      impressions: {
        key: "impressions",
        title: i18n.metrics.impressions,
        value: totals.totalImpressions,
        prev: previousTotals.prevImpressions,
        color: "#2563eb",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.impressions),
      },
      clicks: {
        key: "clicks",
        title: i18n.metrics.clicks,
        value: totals.totalClicks,
        prev: previousTotals.prevClicks,
        color: "#7c3aed",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.clicks),
      },
      ctr: {
        key: "ctr",
        title: i18n.metrics.ctr,
        value: totals.avgCtr,
        prev: previousTotals.prevCtr,
        color: "#16a34a",
        format: (value: number) => `${value.toFixed(2)}%`,
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        ),
      },
      cpm: {
        key: "cpm",
        title: i18n.metrics.cpm,
        value: totals.avgCpm,
        prev: previousTotals.prevCpm,
        color: "#f97316",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
        ),
      },
      cpc: {
        key: "cpc",
        title: i18n.metrics.cpc,
        value: totals.avgCpc,
        prev: previousTotals.prevCpc,
        color: "#6366f1",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) => (item.clicks > 0 ? item.spend / item.clicks : 0)),
      },
      spend: {
        key: "spend",
        title: i18n.metrics.spend,
        value: totals.totalSpend,
        prev: previousTotals.prevSpend,
        color: "#0ea5e9",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) => item.spend),
      },
      views: {
        key: "views",
        title: i18n.metrics.views,
        value: totals.totalViews,
        prev: previousTotals.prevViews,
        color: "#ec4899",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.views),
      },
      cpv: {
        key: "cpv",
        title: i18n.metrics.cpv,
        value: totals.avgCpv,
        prev: previousTotals.prevCpv,
        color: "#d946ef",
        format: (value: number) => moneyFixed2(value, currencyCode, locale),
        trend: latestTrend.map((item) => (item.views > 0 ? item.spend / item.views : 0)),
      },
      conversions: {
        key: "conversions",
        title: i18n.metrics.conversions,
        value: totals.totalConversions,
        prev: previousTotals.prevConversions,
        color: "#059669",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.conversions),
      },
      cpa: {
        key: "cpa",
        title: i18n.metrics.cpa,
        value: totals.avgCpa,
        prev: previousTotals.prevCpa,
        color: "#dc2626",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) =>
          item.conversions > 0 ? item.spend / item.conversions : 0,
        ),
      },
      roas: {
        key: "roas",
        title: i18n.metrics.roas,
        value: 0,
        prev: 0,
        color: "#0f766e",
        format: (value: number) => `${value.toFixed(2)}x`,
        trend: latestTrend.map(() => 0),
      },
      reach: {
        key: "reach",
        title: i18n.metrics.reach,
        value: totals.totalReach,
        prev: previousTotals.prevReach,
        color: "#14b8a6",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.impressions * 0.35),
      },
      frequency: {
        key: "frequency",
        title: i18n.metrics.frequency,
        value: totals.avgFrequency,
        prev: previousTotals.prevFrequency,
        color: "#f59e0b",
        format: (value: number) => value.toFixed(2),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? item.impressions / Math.max(item.impressions * 0.35, 1) : 0,
        ),
      },
    } as const;

    const baseCards: RenderableKpiCard[] = kpiConfig
      .map((key) => metricMap[key as keyof typeof metricMap] ?? metricMap.impressions)
      .map((card) => ({
        key: card.key,
        title: card.title,
        value: card.value,
        prev: card.prev,
        color: card.color,
        format: card.format,
        trend: card.trend,
      }))
      .slice(0, 5);

    const customCards: RenderableKpiCard[] = (dashboard?.custom_kpi_cards ?? [])
      .map((card) => {
        const sourceMetric =
          metricMap[card.trend_source as keyof typeof metricMap] ?? metricMap.impressions;
        const deltaOverride =
          sourceMetric.prev !== 0
            ? ((sourceMetric.value - sourceMetric.prev) / sourceMetric.prev) * 100
            : 0;
        return {
          key: card.id,
          title: card.title,
          value: card.value,
          prev: card.value,
          color: sourceMetric.color,
          format: sourceMetric.format,
          trend: sourceMetric.trend,
          deltaOverride,
        };
      });

    return [...baseCards, ...customCards];
  }, [currencyCode, dashboard?.custom_kpi_cards, dashboard?.kpi_config, i18n.metrics, latestTrend, locale, previousTotals, showSpend, totals]);

  const renderSection = (sectionId: string) => {
    if (sectionId === "kpi_grid") {
      return (
        <section
          key={sectionId}
          className="kpi-grid mb-6"
          style={{ ["--kpi-cols" as string]: String(Math.max(1, Math.min(kpiCards.length, 8))) } as CSSProperties}
        >
          {kpiCards.map((card) => (
            <KPICard
              key={card.key}
              title={card.title}
              value={card.value}
              prevValue={card.prev}
              color={card.color}
              format={card.format}
              trend={card.trend}
              pdfMode={isPdfMode}
              deltaOverride={card.deltaOverride}
            />
          ))}
        </section>
      );
    }

    if (sectionId === "spend_section" && showSpend) {
      return (
        <section key={sectionId} className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SpendByPlatform
              data={filteredPlatforms}
              currencyFormatter={(value) => money(value, currencyCode, locale)}
              pdfMode={isPdfMode}
              forceMobile={isMobileMode}
              labels={{
                title: i18n.sections.spendByPlatform,
                shareOfTotal: i18n.spend.shareOfTotal,
                spend: i18n.spend.spend,
                impressions: i18n.spend.impressions,
                clicks: i18n.spend.clicks,
              }}
            />
          </div>
          <div className="xl:col-span-2">
            <ChannelMix
              data={filteredPlatforms}
              currencyFormatter={(value) => money(value, currencyCode, locale)}
              locale={locale}
              pdfMode={isPdfMode}
              labels={{
                title: i18n.sections.channelMix,
                noData: i18n.common.noDataForSelectedPlatforms,
                totalSpend: i18n.spend.totalSpend,
                spend: i18n.spend.spend,
                impressions: i18n.spend.impressions,
                clicks: i18n.spend.clicks,
              }}
            />
          </div>
        </section>
      );
    }

    if (sectionId === "trend_chart") {
      return (
        <section key={sectionId} className="mb-6">
          <TrendChart
            points={filteredTimeseries}
            selectedPlatforms={selectedPlatforms}
            onTogglePlatform={togglePlatform}
            selectedMetrics={visibleMetrics}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            currencyCode={currencyCode}
            showSpend={showSpend}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.trendByDay,
              metrics: {
                impressions: i18n.metrics.impressions,
                clicks: i18n.metrics.clicks,
                spend: i18n.metrics.spend,
              },
            }}
          />
        </section>
      );
    }

    if (sectionId === "conversion_funnel") {
      if (dashboardType !== "performance" || !dashboard?.funnel?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <ConversionFunnel
            data={dashboard.funnel}
            pdfMode={isPdfMode}
            locale={locale}
            labels={{
              title: "Conversion Funnel",
              previousRate: "From previous",
              overallRate: "Overall",
            }}
          />
        </section>
      );
    }

    if (sectionId === "campaign_table") {
      if (dashboardType !== "performance" || !dashboard?.campaign_breakdown?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <CampaignPerformanceTable
            campaigns={dashboard.campaign_breakdown}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            locale={locale}
            labels={{
              title: "Campaign Performance",
              noRows: "No campaign rows available.",
              campaign: "Campaign",
              platform: i18n.common.platform,
              spend: i18n.metrics.spend,
              conversions: "Conversions",
              cpa: i18n.metrics.cpa,
              clicks: i18n.metrics.clicks,
              cpc: i18n.metrics.cpc,
              total: i18n.common.total,
            }}
          />
        </section>
      );
    }

    if (sectionId === "scatter_plot") {
      if (dashboardType !== "performance" || !dashboard?.campaign_breakdown?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <SpendConversionsScatter
            campaigns={dashboard.campaign_breakdown}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            labels={{
              title: "Spend vs Conversions",
              noRows: "No campaign rows available.",
              spend: i18n.metrics.spend,
              conversions: "Conversions",
              cpa: i18n.metrics.cpa,
            }}
          />
        </section>
      );
    }

    if (sectionId === "plan_vs_fact") {
      return (
        <section key={sectionId} className="mb-6">
          <PlanVsFact
            rows={filteredChannelPerformance}
            selectedMetrics={visibleMetrics}
            showSpend={showSpend}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            currencyCode={currencyCode}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.channelPerformancePlanFact,
              noRows: i18n.planFact.noRows,
              total: i18n.common.total,
              channel: i18n.common.channel,
              metrics: i18n.metrics,
              planOnlyTitle: i18n.planFact.planOnlyTitle,
              fact: i18n.planFact.fact,
              plan: i18n.planFact.plan,
              completion: i18n.planFact.completion,
              status: i18n.planFact.status,
              onTrack: i18n.planFact.onTrack,
              watch: i18n.planFact.watch,
              offTrack: i18n.planFact.offTrack,
              noStatus: i18n.planFact.noStatus,
            }}
          />
        </section>
      );
    }

    if (sectionId === "platform_table") {
      return (
        <section key={sectionId} className="pb-4">
          <PlatformTable
            rows={filteredPlatforms}
            timeseries={filteredTimeseries}
            selectedMetrics={visibleMetrics}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            currencyCode={currencyCode}
            showSpend={showSpend}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.platformPerformance,
              platform: i18n.common.platform,
              metrics: i18n.metrics,
              trend: i18n.common.trend,
              total: i18n.common.total,
            }}
          />
        </section>
      );
    }

    if (sectionId === "platform_plan_fact") {
      return (
        <section key={sectionId} className="mb-6">
          <PlatformPlanVsFact
            rows={filteredPlanVsFact}
            selectedMetrics={visibleMetrics}
            showSpend={showSpend}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            currencyCode={currencyCode}
            locale={locale}
            labels={{
              title: i18n.sections.platformPerformancePlanFact,
              noRows:
                i18n.language === "ru"
                  ? "Нет доступных строк платформ План / Факт."
                  : "No platform plan/fact rows available.",
              total: i18n.common.total,
              platform: i18n.common.platform,
              metrics: i18n.metrics,
              fact: i18n.planFact.fact,
              plan: i18n.planFact.plan,
              completion: i18n.planFact.completion,
            }}
          />
        </section>
      );
    }

    if (sectionId === "channel_table") {
      return (
        <section key={sectionId} className="pb-4">
          <ChannelPerformanceTable
            rows={filteredPlanVsFact}
            channelTimeseries={filteredChannelTimeseries}
            selectedMetrics={visibleMetrics}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            currencyCode={currencyCode}
            showSpend={showSpend}
            locale={locale}
            labels={{
              title: i18n.sections.channelPerformance,
              noRows: i18n.channelTable.noRows,
              total: i18n.common.total,
              channel: i18n.common.channel,
              instrument: i18n.common.instrument,
              buyType: i18n.common.buyType,
              metrics: i18n.metrics,
            }}
          />
        </section>
      );
    }

    if (sectionId === "promopages") {
      if (!dashboard?.promopages) return null;
      return (
        <PromopagesSection
          key={sectionId}
          data={dashboard.promopages}
          selectedMetrics={visibleMetrics}
          currencyFormatter={(value) => money(value, currencyCode, locale)}
          locale={locale}
          labels={{
            title: i18n.sections.promopages,
            noRows:
              i18n.language === "ru"
                ? "Нет доступных данных ПромоСтраниц за выбранный период."
                : "No Promopages data available for the selected period.",
            metrics: i18n.metrics,
            campaign: i18n.language === "ru" ? "Кампания" : "Campaign",
            date: i18n.language === "ru" ? "Дата" : "Date",
            account: i18n.language === "ru" ? "Аккаунт" : "Account",
          }}
        />
      );
    }

    if (sectionId === "analytics") {
      if (!dashboard?.analytics) return null;
      return (
        <AnalyticsSection
          key={sectionId}
          kpi={dashboard.analytics.kpi}
          timeseries={dashboard.analytics.timeseries}
          locale={locale}
          labels={{
            title: i18n.sections.analytics,
            date: i18n.language === "ru" ? "Дата" : "Date",
            visits: i18n.language === "ru" ? "Визиты" : "Visits",
            users: i18n.language === "ru" ? "Пользователи" : "Users",
            pageviews: i18n.language === "ru" ? "Просмотры страниц" : "Pageviews",
            bounceRate: i18n.language === "ru" ? "Отказы" : "Bounce rate",
            avgVisitDuration: i18n.language === "ru" ? "Ср. длительность визита" : "Avg visit duration",
            total: i18n.common.total,
          }}
        />
      );
    }

    if (sectionId === "postclick_analytics") {
      if (!filteredPostClickAnalytics.rows.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <PostClickAnalyticsTable
            rows={filteredPostClickAnalytics.rows}
            timeseries={filteredPostClickAnalytics.timeseries}
            locale={locale}
            labels={{
              title: i18n.sections.postclickAnalytics,
              sourceNote:
                i18n.language === "ru"
                  ? "Достижения целей берутся из Yandex Metrika на том же UTM-grain: daily rows из analytics_scope='goal' суммируются по привязанным utm_source для каждой строки медиаплана."
                  : "Goal reaches come from Yandex Metrika on the same UTM grain: daily analytics_scope='goal' rows are summed across bound utm_source values for each media plan row.",
              noRows:
                i18n.language === "ru"
                  ? "Нет доступных строк постклик аналитики за выбранный период."
                  : "No post-click analytics rows available for the selected period.",
              total: i18n.common.total,
              channel: i18n.common.channel,
              instrument: i18n.common.instrument,
              visits: i18n.language === "ru" ? "Визиты" : "Visits",
              users: i18n.language === "ru" ? "Пользователи" : "Users",
              pageviews: i18n.language === "ru" ? "Просмотры страниц" : "Pageviews",
              goalReaches: i18n.language === "ru" ? "Достижения целей" : "Goal reaches",
              conversionRate: i18n.language === "ru" ? "CR" : "CR",
              bounceRate: i18n.language === "ru" ? "Отказы" : "Bounce rate",
              avgVisitDuration: i18n.language === "ru" ? "Ср. длительность визита" : "Avg visit duration",
              utmSources: i18n.language === "ru" ? "UTM source" : "UTM sources",
            }}
          />
        </section>
      );
    }

    return null;
  };

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platformId)) {
        const next = prev.filter((item) => item !== platformId);
        const fallback = dashboard?.platforms.map((platform) => platform.id) ?? [];
        return next.length ? next : fallback;
      }
      return [...prev, platformId];
    });
  };

  const selectAll = () => {
    setSelectedPlatforms(dashboard?.platforms.map((platform) => platform.id) ?? []);
  };

  const toggleChannel = (channel: string) => {
    setSelectedChannels((prev) => {
      if (prev.includes(channel)) {
        const next = prev.filter((item) => item !== channel);
        const fallback = (dashboard?.channel_performance ?? []).map((item) => item.channel);
        return next.length ? next : fallback;
      }
      return [...prev, channel];
    });
  };

  const selectAllChannels = () => {
    setSelectedChannels((dashboard?.channel_performance ?? []).map((item) => item.channel));
  };

  const exportPdf = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const from = dateRange.from || dashboard?.dashboard.period.from;
    const to = dateRange.to || dashboard?.dashboard.period.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (compareRange.from && compareRange.to) {
      params.set("compare_from", compareRange.from);
      params.set("compare_to", compareRange.to);
    }
    if (viewerAccessToken) {
      params.set("access_token", viewerAccessToken);
    }
    if (viewerEmbedKey) {
      params.set("embed_key", viewerEmbedKey);
    }
    if (selectedBrandId) {
      params.set("brand", selectedBrandId);
    }
    window.open(`/api/dashboard/${dashboardId}/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const exportExcel = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const from = dateRange.from || dashboard?.dashboard.period.from;
    const to = dateRange.to || dashboard?.dashboard.period.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (compareRange.from && compareRange.to) {
      params.set("compare_from", compareRange.from);
      params.set("compare_to", compareRange.to);
    }
    if (viewerAccessToken) {
      params.set("access_token", viewerAccessToken);
    }
    if (viewerEmbedKey) {
      params.set("embed_key", viewerEmbedKey);
    }
    if (selectedBrandId) {
      params.set("brand", selectedBrandId);
    }
    window.open(`/api/dashboard/${dashboardId}/excel?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const applyDateRange = () => {
    if (!draftDateRange.from || !draftDateRange.to) return;
    setDateRange(draftDateRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", draftDateRange.from);
    params.set("to", draftDateRange.to);
    if (compareRange.from && compareRange.to) {
      params.set("compare_from", compareRange.from);
      params.set("compare_to", compareRange.to);
    } else {
      params.delete("compare_from");
      params.delete("compare_to");
    }
    if (selectedBrandId) {
      params.set("brand", selectedBrandId);
    } else {
      params.delete("brand");
    }
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const applyCompareRange = () => {
    if (!effectiveDraftCompareRange.from || !effectiveDraftCompareRange.to) return;
    setCompareRange(effectiveDraftCompareRange);
    setCompareOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    params.set("compare_from", effectiveDraftCompareRange.from);
    params.set("compare_to", effectiveDraftCompareRange.to);
    if (selectedBrandId) {
      params.set("brand", selectedBrandId);
    } else {
      params.delete("brand");
    }
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const clearCompareRange = () => {
    setCompareOpen(false);
    setCompareRange({ from: "", to: "" });
    setDraftCompareRange({ from: "", to: "" });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("compare_from");
    params.delete("compare_to");
    if (selectedBrandId) {
      params.set("brand", selectedBrandId);
    } else {
      params.delete("brand");
    }
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const applyBrandSelection = (brandId: string | null) => {
    setSelectedBrandId(brandId ?? "");
    const params = new URLSearchParams(searchParams.toString());
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    if (compareRange.from && compareRange.to) {
      params.set("compare_from", compareRange.from);
      params.set("compare_to", compareRange.to);
    }
    if (viewerAccessToken) {
      params.set("access_token", viewerAccessToken);
    }
    if (viewerEmbedKey) {
      params.set("embed_key", viewerEmbedKey);
    }
    if (brandId) {
      params.set("brand", brandId);
    } else {
      params.delete("brand");
    }
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  if (!isLoading && authRequired && authMeta) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <DashboardAccessGate
          dashboardId={dashboardId}
          dashboardName={authMeta.dashboard_name}
          clientName={authMeta.client_name}
          authMode={authMeta.auth_mode}
          onSuccess={(accessToken) => {
            if (accessToken) {
              setViewerAccessToken(accessToken);
              const params = new URLSearchParams(searchParams.toString());
              params.set("access_token", accessToken);
              if (selectedBrandId) {
                params.set("brand", selectedBrandId);
              }
              router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
            }
            setReloadKey((value) => value + 1);
          }}
        />
      </main>
    );
  }

  if (!isLoading && notFound) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto min-h-screen w-full max-w-[1000px] px-4 py-12 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dashboard Portal</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Дашборд не найден</h1>
          <p className="mt-3 text-sm text-slate-600">
            Проверьте ссылку или войдите в личный кабинет, чтобы открыть доступный дашборд.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Перейти в личный кабинет
          </Link>
        </section>
      </main>
    );
  }

  if (isLoading || !dashboard) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto flex min-h-screen w-full max-w-[1400px] items-center justify-center px-4 py-6 sm:px-6 lg:px-8 ${
          isPdfMode ? "pdf-mode" : ""
        }`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <p className="text-sm text-slate-500">{i18n.common.loadingDashboard}</p>
      </main>
    );
  }

  const periodLabel = `${formatPeriodDate(dashboard.dashboard.period.from, locale)} - ${formatPeriodDate(
    dashboard.dashboard.period.to,
    locale,
  )}`;
  const clientName = dashboard.dashboard.client_name || dashboardId.toUpperCase();

  if (dashboardType === "abbott_bi" && dashboard.abbott_bi) {
    return (
      <main
        data-dashboard-ready="true"
        className={`mx-auto min-h-screen w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <DashboardHeader
          clientName={clientName}
          title={dashboard.dashboard.dashboard_name}
          periodLabel={periodLabel}
          logoUrl={dashboard.dashboard.logo_url}
          pdfMode={isPdfMode}
          language={dashboardLanguage}
          labels={i18n.header}
          dateFrom={draftDateRange.from}
          dateTo={draftDateRange.to}
          onDateFromChange={(value) => setDraftDateRange((prev) => ({ ...prev, from: value }))}
          onDateToChange={(value) => setDraftDateRange((prev) => ({ ...prev, to: value }))}
          onApplyDateRange={applyDateRange}
          isUpdatingRange={isLoading}
        />

        {isDemoMode ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {i18n.common.demoMode}
            {apiError ? ` (${apiError})` : ""}
          </div>
        ) : null}

        <AbbottBiDashboard data={dashboard.abbott_bi} locale={locale} />
      </main>
    );
  }

  // ── Multibrand executive page: show when type=multibrand and no brand selected ──
  if (dashboardType === "multibrand" && !selectedBrandId && multibrand?.enabled && !isPdfMode) {
    const execKpis = [
      {
        key: "impressions",
        label: "Показы",
        formatted: compact(multibrandExecutiveTotals.impressions, locale),
      },
      {
        key: "clicks",
        label: "Клики",
        formatted: compact(multibrandExecutiveTotals.clicks, locale),
      },
      {
        key: "ctr",
        label: "CTR",
        formatted: `${multibrandExecutiveCtr.toFixed(2)}%`,
      },
      {
        key: "reach",
        label: "Охват",
        formatted: compact(multibrandExecutiveTotals.reach, locale),
      },
    ];

    return (
      <main
        data-dashboard-ready="true"
        className="mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8"
      >
        <DashboardHeader
          clientName={clientName}
          title={dashboard.dashboard.dashboard_name}
          periodLabel={periodLabel}
          logoUrl={dashboard.dashboard.logo_url}
          pdfMode={false}
          language={dashboardLanguage}
          labels={i18n.header}
          dateFrom={draftDateRange.from}
          dateTo={draftDateRange.to}
          onDateFromChange={(value) => setDraftDateRange((prev) => ({ ...prev, from: value }))}
          onDateToChange={(value) => setDraftDateRange((prev) => ({ ...prev, to: value }))}
          onApplyDateRange={applyDateRange}
          isUpdatingRange={isLoading}
          compareOpen={false}
          comparePreset={comparePreset}
          compareFrom=""
          compareTo=""
          onToggleCompare={() => {}}
          onComparePresetChange={setComparePreset}
          onCompareFromChange={() => {}}
          onCompareToChange={() => {}}
          onApplyCompare={() => {}}
          onClearCompare={() => {}}
          onExportExcel={exportExcel}
          onExportPdf={exportPdf}
        />
        {brandSummaries.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            Загружаем данные по брендам…
          </div>
        )}
        {brandSummaries.length > 0 && (
          <MultibrandExecutivePage
            title={multibrand.executive_title || clientName}
            subtitle={multibrand.executive_subtitle}
            brands={brandSummaries}
            execKpis={execKpis}
            formatCompact={(v) => compact(v, locale)}
            formatCtr={(v) => `${v.toFixed(2)}%`}
            onSelectBrand={applyBrandSelection}
          />
        )}
      </main>
    );
  }

  return (
    <main
      data-dashboard-ready="true"
      className={`mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
      style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
    >
      <DashboardHeader
        clientName={clientName}
        title={dashboard.dashboard.dashboard_name}
        periodLabel={periodLabel}
        logoUrl={dashboard.dashboard.logo_url}
        pdfMode={isPdfMode}
        language={dashboardLanguage}
        labels={i18n.header}
        dateFrom={draftDateRange.from}
        dateTo={draftDateRange.to}
        onDateFromChange={(value) => setDraftDateRange((prev) => ({ ...prev, from: value }))}
        onDateToChange={(value) => setDraftDateRange((prev) => ({ ...prev, to: value }))}
        onApplyDateRange={applyDateRange}
        isUpdatingRange={isLoading}
        compareOpen={compareOpen}
        comparePreset={comparePreset}
        compareFrom={effectiveDraftCompareRange.from}
        compareTo={effectiveDraftCompareRange.to}
        onToggleCompare={() => setCompareOpen((prev) => !prev)}
        onComparePresetChange={setComparePreset}
        onCompareFromChange={(value) => setDraftCompareRange((prev) => ({ ...prev, from: value }))}
        onCompareToChange={(value) => setDraftCompareRange((prev) => ({ ...prev, to: value }))}
        onApplyCompare={applyCompareRange}
        onClearCompare={clearCompareRange}
        onExportExcel={exportExcel}
        onExportPdf={exportPdf}
      />

      <DashboardAiSummaryCard
        summary={dashboard.ai_summary}
        enabled={Boolean(dashboard.ai_summary_enabled)}
        labels={i18n.aiSummary}
        onGenerate={dashboard.ai_summary_enabled ? generateAiSummary : undefined}
        isGenerating={isGeneratingAiSummary}
        generateError={aiSummaryError}
      />

      {isDemoMode ? (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {i18n.common.demoMode}
          {apiError ? ` (${apiError})` : ""}
        </div>
      ) : null}

      {/* Back to executive overview when a brand is selected */}
      {!isPdfMode && dashboardType === "multibrand" && selectedBrandId && multibrand?.enabled ? (
        <div className="no-print mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => applyBrandSelection(null)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Все бренды
          </button>
          {(() => {
            const activeBrand = multibrand.brands.find((b) => b.id === selectedBrandId);
            return activeBrand ? (
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeBrand.color }} />
                <span className="text-sm font-semibold text-slate-950">{activeBrand.label}</span>
              </div>
            ) : null;
          })()}
        </div>
      ) : null}

      {!isPdfMode && multibrand?.enabled && brandSummaries.length > 0 && dashboardType !== "multibrand" ? (
        <MultibrandPanel
          title={multibrand.executive_title || dashboard.dashboard.client_name}
          subtitle={multibrand.executive_subtitle}
          brands={brandSummaries}
          selectedBrandId={selectedBrandId || null}
          currencyFormatter={(value) => money(value, currencyCode, locale)}
          formatCompact={(value) => compact(value, locale)}
          onSelectBrand={applyBrandSelection}
        />
      ) : null}

      {!isPdfMode ? (
        <PlatformFilter
          className="no-print"
          options={
            effectiveFilterMode === "channel"
              ? channelOptions
              : dashboard.platforms.map((platform) => ({
                  id: platform.id,
                  name: platform.name,
                  color: platform.color,
                }))
          }
          selected={effectiveFilterMode === "channel" ? selectedChannels : selectedPlatforms}
          onToggle={effectiveFilterMode === "channel" ? toggleChannel : togglePlatform}
          onSelectAll={effectiveFilterMode === "channel" ? selectAllChannels : selectAll}
          labels={i18n.filter}
          mode={filterMode}
          onModeChange={setFilterMode}
          filterScope={channelOptions.length > 0 ? filterScope : "platform"}
        />
      ) : null}

      {dashboard.comparison ? (
        <ComparisonSection
          comparison={dashboard.comparison}
          detailMode={effectiveFilterMode === "channel" ? "channel" : "platform"}
          selectedMetrics={visibleMetrics}
          selectedPlatforms={
            effectiveFilterMode === "channel"
              ? Array.from(channelVisiblePlatformIds)
              : selectedPlatforms
          }
          selectedChannels={selectedChannels}
          currentTimeseries={filteredTimeseries}
          currentChannelTimeseries={filteredChannelTimeseries}
          currencyFormatter={(value) => money(value, currencyCode, locale)}
          currencyCode={currencyCode}
          locale={locale}
          language={dashboardLanguage}
          showSpend={showSpend}
          labels={{
            title: i18n.sections.comparison,
            metrics: i18n.metrics,
            total: i18n.common.total,
            platform: i18n.common.platform,
            channel: i18n.common.channel,
            noData: i18n.common.noDataForSelectedPlatforms,
          }}
        />
      ) : null}

      {sectionOrder.map((sectionId) => renderSection(sectionId))}

      {dashboard?.custom_tables?.map((table, i) => (
        <CustomTable key={i} data={table} locale={locale} pdfMode={isPdfMode} />
      ))}
    </main>
  );
}
