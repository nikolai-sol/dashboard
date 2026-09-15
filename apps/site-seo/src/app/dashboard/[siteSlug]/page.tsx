import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Dashboard, intentPublicationMatches } from "../../../components/Dashboard.tsx";
import { LoginForm } from "../../../components/LoginForm.tsx";
import { loadAvailableMetrikaWeeks, loadDashboardReadModel } from "../../../lib/read-model.ts";
import { defaultPeriodSelection, getSiteSeoRuntime, parseDashboardReadRequest } from "../../../lib/runtime.ts";
import { gscFilters, resolveAvailableWeekSelection, resolveComparisonWeek } from "../../../lib/period-selection.ts";

function boundedIntentPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  return Math.min(10_000, Math.max(1, Number(value)));
}

export default async function SiteSeoDashboardPage({ params, searchParams }: Readonly<{ params: Promise<{ siteSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const runtime = await getSiteSeoRuntime();
  const { siteSlug } = await params;
  if (siteSlug !== runtime.registration.profile.slug) notFound();
  const session = await runtime.resolveSession((await cookies()).toString(), runtime.registration);
  if (!session) return <main className="site-seo-state-page" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section className="site-seo-state-card" style={{ width: "min(100%, 440px)", padding: 24, border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff" }}><h1>{runtime.registration.profile.title}</h1><LoginForm dashboardId={runtime.registration.profile.dashboardId} siteSlug={siteSlug} /></section></main>;
  try {
    const values = await searchParams;
    const url = new URL("https://site-seo.local/dashboard");
    for (const [key, value] of Object.entries(values)) if (typeof value === "string") url.searchParams.set(key, value);
    const hasPeriodState = ["traffic_week", "gsc_period", "alice_month"].some((key) => url.searchParams.has(key));
    const requested = hasPeriodState
      ? parseDashboardReadRequest(url, siteSlug, runtime.registration.profile.businessTimezone)
      : { slug: siteSlug, selection: defaultPeriodSelection(runtime.registration.profile.businessTimezone), publicationId: null, filters: gscFilters() };
    const availableWeeks = await loadAvailableMetrikaWeeks({ registration: runtime.registration, claim: session, execute: runtime.executeAvailableMetrikaWeeks });
    const resolvedSelection = resolveAvailableWeekSelection(requested.selection, availableWeeks);
    const comparisonMode = typeof values.comparison_mode === "string" ? values.comparison_mode : null;
    const resolvedWithMode = resolvedSelection && comparisonMode === "single"
      ? { ...resolvedSelection, traffic: { ...resolvedSelection.traffic, comparison: null } }
      : resolvedSelection && (comparisonMode === "compare" || comparisonMode === "previous")
        ? { ...resolvedSelection, traffic: { ...resolvedSelection.traffic, comparison: resolveComparisonWeek(resolvedSelection.traffic.primary, resolvedSelection.traffic.comparison, availableWeeks, comparisonMode) } }
        : resolvedSelection;
    const selection = resolvedWithMode
      ? hasPeriodState ? resolvedWithMode : { ...resolvedWithMode, gsc: resolvedWithMode.traffic.primary }
      : requested.selection;
    const request = { ...requested, selection };
    const model = await loadDashboardReadModel({ registration: runtime.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: runtime.execute });
    const intentReviewRequested = ["intent_target_page", "intent_other_page", "intent_open", "intent_publication"].some((key) => url.searchParams.has(key));
    const expectedIntentPublication = typeof values.intent_publication === "string" ? values.intent_publication : null;
    if (!intentPublicationMatches(model.targetIntent, expectedIntentPublication, intentReviewRequested)) {
      return <main className="site-seo-state-page" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section className="site-seo-state-card" style={{ width: "min(100%, 440px)", padding: 24, border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff" }}><h1>{runtime.registration.profile.title}</h1><p>Не удалось подтвердить версию классификации. Вернитесь к обзору и откройте таблицу заново, чтобы не смешивать версии правил.</p></section></main>;
    }
    const intentOpen = values.intent_open === "target" || values.intent_open === "other" ? values.intent_open : undefined;
    return <Dashboard profile={runtime.registration.profile} model={model} selection={request.selection} publicationId={request.publicationId} filters={request.filters} availableWeeks={availableWeeks} activeTab={typeof values.tab === "string" ? values.tab : undefined} intentPages={{ target: boundedIntentPage(values.intent_target_page), other: boundedIntentPage(values.intent_other_page) }} intentOpen={intentOpen} />;
  } catch {
    return <main className="site-seo-state-page" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section className="site-seo-state-card" style={{ width: "min(100%, 440px)", padding: 24, border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff" }}><h1>{runtime.registration.profile.title}</h1><p>Данные пока недоступны: не установлен canonical read model.</p></section></main>;
  }
}
