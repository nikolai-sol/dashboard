"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardAccessGate from "@/components/DashboardAccessGate";
import DashboardHeader, {
  type DashboardDateControlsMode,
  type DashboardQuickRangePreset,
} from "@/components/DashboardHeader";
import ZarukuSeoDashboard, { type ZarukuTabId } from "@/components/ZarukuSeoDashboard";
import { zarukuTimeOwner } from "@/components/zaruku-seo-week-selection";
import { getDashboardI18n } from "@/lib/dashboard-i18n";
import type { DashboardData } from "@/lib/types";
import {
  clampZarukuDateRange,
  latestZarukuReportingDate,
} from "@/lib/zaruku-date-range";

type DashboardAuthMeta = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  auth_mode?: "email_password" | "password_only";
};

const TECH_ISSUES_MESSAGE = "Извините тех проблемы. мы скоро вернем все на место!";

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
    const response = await fetch(`/api/dashboard/zaruku${query ? `?${query}` : ""}`, { cache: "no-store" });
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
    console.warn("API unavailable, showing unavailable state:", error);
    const message = error instanceof Error ? error.message : "Unknown API error";
    return {
      data: null,
      demoMode: false,
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

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function startOfCurrentWeek() {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return shiftDate(now.toISOString().slice(0, 10), diffToMonday);
}

function buildQuickRange(preset: Exclude<DashboardQuickRangePreset, "custom">) {
  const today = isoToday();
  if (preset === "this_month") {
    return { from: startOfCurrentMonth(), to: today };
  }
  if (preset === "this_week") {
    return { from: startOfCurrentWeek(), to: today };
  }
  return { from: shiftDate(today, -1), to: shiftDate(today, -1) };
}

function detectQuickRangePreset(from: string, to: string): DashboardQuickRangePreset {
  if (!from || !to) return "custom";
  const thisMonth = buildQuickRange("this_month");
  if (from === thisMonth.from && to === thisMonth.to) return "this_month";
  const thisWeek = buildQuickRange("this_week");
  if (from === thisWeek.from && to === thisWeek.to) return "this_week";
  const yesterday = buildQuickRange("yesterday");
  if (from === yesterday.from && to === yesterday.to) return "yesterday";
  return "custom";
}

export default function ZarukuDashboardPage() {
  return <ZarukuDashboardPageContent />;
}

export function ZarukuDashboardPageContent({
  unsupportedDashboardFallback,
}: { unsupportedDashboardFallback?: ReactNode } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardId = "zaruku";
  const queryFrom = searchParams.get("from") ?? "";
  const queryTo = searchParams.get("to") ?? "";
  const isZarukuDashboard = dashboardId === "zaruku";
  const rawInitialRange = {
    from: queryFrom,
    to: queryTo,
  };
  const initialRange = isZarukuDashboard ? clampZarukuDateRange(rawInitialRange) : rawInitialRange;
  const initialFrom = initialRange.from;
  const initialTo = initialRange.to;
  const zarukuMaxDate = latestZarukuReportingDate();
  const rawInitialCompareRange = {
    from: searchParams.get("compare_from") ?? "",
    to: searchParams.get("compare_to") ?? "",
  };
  const initialCompareRange = isZarukuDashboard
    ? clampZarukuDateRange(rawInitialCompareRange)
    : rawInitialCompareRange;
  const initialCompareFrom = initialCompareRange.from;
  const initialCompareTo = initialCompareRange.to;
  const initialAccessToken = searchParams.get("access_token") ?? "";
  const initialEmbedKey = searchParams.get("embed_key") ?? "";
  const initialBrandId = searchParams.get("brand") ?? "";
  const isPdfMode = searchParams.get("pdf") === "true";
  const isMobileMode = searchParams.get("mobile") === "1";

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authMeta, setAuthMeta] = useState<DashboardAuthMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerAccessToken, setViewerAccessToken] = useState(initialAccessToken);
  const [viewerEmbedKey] = useState(initialEmbedKey);
  const [selectedBrandId, setSelectedBrandId] = useState(initialBrandId);
  const [reloadKey, setReloadKey] = useState(0);
  const [zarukuActiveTab, setZarukuActiveTab] = useState<ZarukuTabId>("overview");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: initialFrom, to: initialTo });
  const [draftDateRange, setDraftDateRange] = useState<{ from: string; to: string }>({
    from: initialFrom,
    to: initialTo,
  });
  const [quickRangePreset, setQuickRangePreset] = useState<DashboardQuickRangePreset>(
    detectQuickRangePreset(initialFrom, initialTo),
  );
  const [compareRange] = useState<{ from: string; to: string }>({
    from: initialCompareFrom,
    to: initialCompareTo,
  });

  useEffect(() => {
    if (!isZarukuDashboard || !queryFrom || !queryTo) return;
    if (queryFrom === initialFrom && queryTo === initialTo) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", initialFrom);
    params.set("to", initialTo);
    router.replace(`/dashboard/zaruku?${params.toString()}`, { scroll: false });
  }, [dashboardId, initialFrom, initialTo, isZarukuDashboard, queryFrom, queryTo, router, searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!dashboardId) {
        setDashboard(null);
        setIsDemoMode(false);
        setApiError("Dashboard id is missing in URL.");
        setAuthRequired(false);
        setAuthMeta(null);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
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
        setApiError(TECH_ISSUES_MESSAGE);
        setAuthRequired(false);
        setAuthMeta(null);
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      setDashboard(result.data);
      setIsDemoMode(result.demoMode);
      setApiError(result.errorMessage ? TECH_ISSUES_MESSAGE : null);
      setAuthRequired(false);
      setAuthMeta(null);
      setNotFound(false);

      const resolvedPeriod = {
        from: result.data?.dashboard.period.from || "",
        to: result.data?.dashboard.period.to || "",
      };
      const effectivePreset = detectQuickRangePreset(resolvedPeriod.from, resolvedPeriod.to);
      setDateRange((prev) => {
        const next = {
          from: prev.from || resolvedPeriod.from,
          to: prev.to || resolvedPeriod.to,
        };
        return prev.from === next.from && prev.to === next.to ? prev : next;
      });
      setDraftDateRange((prev) => {
        const next = {
          from: prev.from || resolvedPeriod.from,
          to: prev.to || resolvedPeriod.to,
        };
        return prev.from === next.from && prev.to === next.to ? prev : next;
      });
      setQuickRangePreset((prev) => (prev === "custom" ? effectivePreset : prev));
      setIsLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [compareRange, dashboardId, dateRange, reloadKey, router, searchParams, selectedBrandId, viewerAccessToken, viewerEmbedKey]);

  useEffect(() => {
    setSelectedBrandId(initialBrandId);
  }, [initialBrandId]);

  const dashboardLanguage = dashboard?.dashboard.language ?? "en";
  const i18n = useMemo(() => getDashboardI18n(dashboardLanguage), [dashboardLanguage]);
  const locale = i18n.locale;
  const dashboardType = dashboard?.dashboard.type ?? "awareness";

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
    window.open(`/api/dashboard/zaruku/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
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
    window.open(`/api/dashboard/zaruku/excel?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const applyImmediateDateRange = (range: { from: string; to: string }, preset: DashboardQuickRangePreset) => {
    const resolvedRange = isZarukuDashboard ? clampZarukuDateRange(range) : range;
    setQuickRangePreset(preset);
    setDraftDateRange(resolvedRange);
    setDateRange(resolvedRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", resolvedRange.from);
    params.set("to", resolvedRange.to);
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
    router.replace(`/dashboard/zaruku?${params.toString()}`, { scroll: false });
  };

  const applyDateRange = () => {
    if (!draftDateRange.from || !draftDateRange.to) return;
    const resolvedRange = isZarukuDashboard ? clampZarukuDateRange(draftDateRange) : draftDateRange;
    setQuickRangePreset(detectQuickRangePreset(resolvedRange.from, resolvedRange.to));
    setDateRange(resolvedRange);
    setDraftDateRange(resolvedRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", resolvedRange.from);
    params.set("to", resolvedRange.to);
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
    router.replace(`/dashboard/zaruku?${params.toString()}`, { scroll: false });
  };

  const handleQuickRangePresetChange = (preset: DashboardQuickRangePreset) => {
    if (preset === "custom") {
      setQuickRangePreset("custom");
      return;
    }
    applyImmediateDateRange(buildQuickRange(preset), preset);
  };

  const handleDraftDateFromChange = (value: string) => {
    const safeValue = isZarukuDashboard && value > zarukuMaxDate ? zarukuMaxDate : value;
    setQuickRangePreset("custom");
    setDraftDateRange((prev) => ({ ...prev, from: safeValue }));
  };

  const handleDraftDateToChange = (value: string) => {
    const safeValue = isZarukuDashboard && value > zarukuMaxDate ? zarukuMaxDate : value;
    setQuickRangePreset("custom");
    setDraftDateRange((prev) => ({ ...prev, to: safeValue }));
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
              router.replace(`/dashboard/zaruku?${params.toString()}`, { scroll: false });
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

  if (!isLoading && !dashboard && apiError) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto min-h-screen w-full max-w-[1000px] px-4 py-12 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dashboard Portal</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">{TECH_ISSUES_MESSAGE}</h1>
        </section>
      </main>
    );
  }

  if (!isLoading && dashboard && (dashboard.dashboard.type !== "zaruku_bi" || !dashboard.zaruku_seo)) {
    if (unsupportedDashboardFallback) return unsupportedDashboardFallback;
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto min-h-screen w-full max-w-[1000px] px-4 py-12 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dashboard Portal</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">{TECH_ISSUES_MESSAGE}</h1>
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
  const zarukuSeoData = dashboardType === "zaruku_bi" ? dashboard.zaruku_seo : null;
  const zarukuTimeOwnerMode = zarukuTimeOwner(zarukuActiveTab);
  const zarukuDateControlsMode: DashboardDateControlsMode = zarukuTimeOwnerMode === "url"
    ? "active"
    : "hidden";

  if (dashboardType === "zaruku_bi" && zarukuSeoData) {
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
          dateControlsMode={zarukuDateControlsMode}
          showIdentity={false}
          language={dashboardLanguage}
          labels={i18n.header}
          dateFrom={draftDateRange.from}
          dateTo={draftDateRange.to}
          maxDate={zarukuMaxDate}
          onDateFromChange={handleDraftDateFromChange}
          onDateToChange={handleDraftDateToChange}
          onApplyDateRange={applyDateRange}
          quickRangePreset={quickRangePreset}
          onQuickRangePresetChange={handleQuickRangePresetChange}
          isUpdatingRange={isLoading}
        />

        {isDemoMode ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {i18n.common.demoMode}
            {apiError ? ` (${apiError})` : ""}
          </div>
        ) : null}

        <ZarukuSeoDashboard data={zarukuSeoData} locale={locale} onActiveTabChange={setZarukuActiveTab} />
      </main>
    );
  }

  return null;
}
