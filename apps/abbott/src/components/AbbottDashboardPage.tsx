"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardAccessGate from "@/components/DashboardAccessGate";
import DashboardHeader, { type DashboardQuickRangePreset } from "./AbbottDashboardHeader";
import AbbottBiDashboard from "@/components/AbbottBiDashboard";
import AbbottDatePicker from "@/components/abbott/AbbottDatePicker";
import { getDashboardI18n } from "@/lib/dashboard-i18n";
import type { DashboardData } from "@/lib/types";
import {
  ABBOTT_NO_COMPLETED_DAYS,
  clampAbbottCurrentPresetToCoverage,
  defaultAbbottRange,
  detectAbbottPreset,
  latestCompletedAbbottDate,
  normalizeAbbottRequestedRange,
  resolveAbbottPreset,
  type AbbottDatePreset,
} from "@/lib/abbott-date-range";

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
  dashboardId: "18" | "abbott",
  range?: { from: string; to: string },
  accessToken?: string,
  embedKey?: string,
): Promise<{
  data: DashboardData | null;
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
    if (accessToken) {
      params.set("access_token", accessToken);
    }
    if (embedKey) {
      params.set("embed_key", embedKey);
    }
    const query = params.toString();
    const response = await fetch(`/api/dashboard/${dashboardId}${query ? `?${query}` : ""}`, { cache: "no-store" });
    if (response.status === 401) {
      const json = (await response.json().catch(() => null)) as
        | { dashboard?: DashboardAuthMeta }
        | null;
      return {
        data: null,
        errorMessage: null,
        authRequired: true,
        authMeta: json?.dashboard ?? null,
        notFound: false,
      };
    }
    if (response.status === 404) {
      return {
        data: null,
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
    if (data?.dashboard?.type !== "abbott_bi" || !data.abbott_bi) {
      throw new Error("Invalid Abbott dashboard response");
    }
    return { data, errorMessage: null, authRequired: false, authMeta: null, notFound: false };
  } catch (error) {
    console.warn("API unavailable, showing unavailable state:", error);
    const message = error instanceof Error ? error.message : "Unknown API error";
    return {
      data: null,
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

function resolveInitialAbbottRange(from: string, to: string) {
  if (from && to) {
    try {
      return normalizeAbbottRequestedRange({ from, to });
    } catch {
      return { from, to };
    }
  }
  return !from && !to ? defaultAbbottRange() : { from, to };
}

export default function AbbottDashboardPage({ dashboardId }: { dashboardId: "18" | "abbott" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryFrom = searchParams.get("from") ?? "";
  const queryTo = searchParams.get("to") ?? "";
  const initialAbbottRange = resolveInitialAbbottRange(queryFrom, queryTo);
  const rawInitialRange = {
    from: initialAbbottRange?.from ?? queryFrom,
    to: initialAbbottRange?.to ?? queryTo,
  };
  const initialRange = rawInitialRange;
  const initialFrom = initialRange.from;
  const initialTo = initialRange.to;
  const abbottMaxDate = latestCompletedAbbottDate();
  const initialAccessToken = searchParams.get("access_token") ?? "";
  const initialEmbedKey = searchParams.get("embed_key") ?? "";
  const isPdfMode = searchParams.get("pdf") === "true";
  const isMobileMode = searchParams.get("mobile") === "1";

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authMeta, setAuthMeta] = useState<DashboardAuthMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerAccessToken, setViewerAccessToken] = useState(initialAccessToken);
  const [viewerEmbedKey] = useState(initialEmbedKey);
  const [reloadKey, setReloadKey] = useState(0);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: initialFrom, to: initialTo });
  const [draftDateRange, setDraftDateRange] = useState<{ from: string; to: string }>({
    from: initialFrom,
    to: initialTo,
  });
  const [quickRangePreset, setQuickRangePreset] = useState<DashboardQuickRangePreset>(
    detectQuickRangePreset(initialFrom, initialTo),
  );
  const [abbottPreset, setAbbottPreset] = useState<AbbottDatePreset>(() =>
    initialAbbottRange?.from && initialAbbottRange?.to
      ? detectAbbottPreset(initialAbbottRange)
      : "this_month",
  );
  const [abbottEmptyMessage, setAbbottEmptyMessage] = useState<string | null>(() =>
    !initialAbbottRange ? ABBOTT_NO_COMPLETED_DAYS : null,
  );
  useEffect(() => {
    if (!queryFrom || !queryTo || !initialAbbottRange) return;
    if (queryFrom === initialAbbottRange.from && queryTo === initialAbbottRange.to) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", initialAbbottRange.from);
    params.set("to", initialAbbottRange.to);
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  }, [dashboardId, initialAbbottRange, queryFrom, queryTo, router, searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (abbottEmptyMessage) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);

      const result = await getDashboardData(
        dashboardId,
        dateRange.from && dateRange.to ? dateRange : undefined,
        viewerAccessToken || undefined,
        viewerEmbedKey || undefined,
      );
      if (cancelled) {
        return;
      }

      if (result.authRequired) {
        setDashboard(null);

        setApiError(null);
        setAuthRequired(true);
        setAuthMeta(result.authMeta);
        setNotFound(false);
        setIsLoading(false);
        return;
      }
      if (result.notFound) {
        setDashboard(null);

        setApiError(TECH_ISSUES_MESSAGE);
        setAuthRequired(false);
        setAuthMeta(null);
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      const abbottQuality = result.data?.abbott_bi?.data_quality;
      const coveredRange = abbottQuality?.status === "incomplete"
        ? clampAbbottCurrentPresetToCoverage(
            dateRange,
            abbottPreset,
            abbottQuality.blocking_gaps,
          )
        : null;
      if (coveredRange) {
        setDraftDateRange(coveredRange);
        setDateRange(coveredRange);
        const params = new URLSearchParams(searchParams.toString());
        params.set("from", coveredRange.from);
        params.set("to", coveredRange.to);
        router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
        return;
      }

      setDashboard(result.data);

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
  }, [abbottEmptyMessage, abbottPreset, dashboardId, dateRange, reloadKey, router, searchParams, viewerAccessToken, viewerEmbedKey]);

  const dashboardLanguage = dashboard?.dashboard.language ?? "en";
  const i18n = useMemo(() => getDashboardI18n(dashboardLanguage), [dashboardLanguage]);
  const locale = i18n.locale;
  const dashboardType = dashboard?.dashboard.type;

  const applyImmediateDateRange = (range: { from: string; to: string }, preset: DashboardQuickRangePreset) => {
    const resolvedRange = range;
    setQuickRangePreset(preset);
    setDraftDateRange(resolvedRange);
    setDateRange(resolvedRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", resolvedRange.from);
    params.set("to", resolvedRange.to);
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const applyAbbottDateRange = (range: { from: string; to: string }, preset: AbbottDatePreset) => {
    setAbbottPreset(preset);
    setAbbottEmptyMessage(null);
    setDraftDateRange(range);
    setDateRange(range);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", range.from);
    params.set("to", range.to);
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const handleAbbottPresetChange = (preset: AbbottDatePreset) => {
    setAbbottPreset(preset);
    if (preset === "custom") return;
    const resolved = resolveAbbottPreset(preset);
    if (resolved.kind === "empty") {
      setAbbottEmptyMessage(resolved.message);
      return;
    }
    applyAbbottDateRange({ from: resolved.from, to: resolved.to }, preset);
  };

  const applyAbbottCustomRange = () => {
    try {
      const range = normalizeAbbottRequestedRange(draftDateRange);
      applyAbbottDateRange(range, detectAbbottPreset(range));
    } catch {
      // The picker prevents ordinary invalid input; preserve the current data
      // if a malformed value still reaches this client boundary.
    }
  };

  const applyDateRange = () => {
    if (!draftDateRange.from || !draftDateRange.to) return;
    const resolvedRange = draftDateRange;
    setQuickRangePreset(detectQuickRangePreset(resolvedRange.from, resolvedRange.to));
    setDateRange(resolvedRange);
    setDraftDateRange(resolvedRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", resolvedRange.from);
    params.set("to", resolvedRange.to);
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  const handleQuickRangePresetChange = (preset: DashboardQuickRangePreset) => {
    if (preset === "custom") {
      setQuickRangePreset("custom");
      return;
    }
    applyImmediateDateRange(buildQuickRange(preset), preset);
  };

  const handleDraftDateFromChange = (value: string) => {
    const safeValue = value;
    setQuickRangePreset("custom");
    setDraftDateRange((prev) => ({ ...prev, from: safeValue }));
  };

  const handleDraftDateToChange = (value: string) => {
    const safeValue = value;
    setQuickRangePreset("custom");
    setDraftDateRange((prev) => ({ ...prev, to: safeValue }));
  };

  const handleAbbottDraftFromChange = (value: string) => {
    setAbbottPreset("custom");
    setDraftDateRange((prev) => ({ ...prev, from: value }));
  };

  const handleAbbottDraftToChange = (value: string) => {
    setAbbottPreset("custom");
    setDraftDateRange((prev) => ({ ...prev, to: value }));
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

  if (!isLoading && abbottEmptyMessage && !dashboard) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto min-h-screen w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <DashboardHeader
          clientName="Abbott"
          title="Аналитика трафика"
          periodLabel="Нет завершённых дней"
          pdfMode={isPdfMode}
          dateControlsSlot={
            <AbbottDatePicker
              preset={abbottPreset}
              appliedRange={dateRange}
              draftRange={draftDateRange}
              maxDate={abbottMaxDate}
              isLoading={isLoading}
              onPresetChange={handleAbbottPresetChange}
              onDraftFromChange={handleAbbottDraftFromChange}
              onDraftToChange={handleAbbottDraftToChange}
              onApplyCustom={applyAbbottCustomRange}
            />
          }
        />
        <section role="status" aria-live="polite" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-900">
          {abbottEmptyMessage}
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

  const abbottBiData = dashboardType === "abbott_bi" ? dashboard.abbott_bi : null;

  if (dashboardType === "abbott_bi" && abbottBiData) {
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
          onDateFromChange={handleDraftDateFromChange}
          onDateToChange={handleDraftDateToChange}
          onApplyDateRange={applyDateRange}
          quickRangePreset={quickRangePreset}
          onQuickRangePresetChange={handleQuickRangePresetChange}
          isUpdatingRange={isLoading}
          dateControlsSlot={
            <AbbottDatePicker
              preset={abbottPreset}
              appliedRange={dateRange}
              draftRange={draftDateRange}
              maxDate={abbottMaxDate}
              isLoading={isLoading}
              onPresetChange={handleAbbottPresetChange}
              onDraftFromChange={handleAbbottDraftFromChange}
              onDraftToChange={handleAbbottDraftToChange}
              onApplyCustom={applyAbbottCustomRange}
            />
          }
        />

        {abbottEmptyMessage ? (
          <section role="status" aria-live="polite" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-900">
            {abbottEmptyMessage}
          </section>
        ) : (
          <AbbottBiDashboard
            data={abbottBiData}
            locale={locale}
            portalName="ABBOTT"
            periodFrom={dashboard.dashboard.period.from}
            periodTo={dashboard.dashboard.period.to}
            dashboardId={dashboardId}
            onAdminUsersChanged={() => setReloadKey((value) => value + 1)}
          />
        )}
      </main>
    );
  }

  return null;
}
