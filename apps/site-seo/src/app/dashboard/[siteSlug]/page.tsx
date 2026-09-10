import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Dashboard } from "../../../components/Dashboard.tsx";
import { LoginForm } from "../../../components/LoginForm.tsx";
import { loadDashboardReadModel } from "../../../lib/read-model.ts";
import { defaultPeriodSelection, getSiteSeoRuntime, parseDashboardReadRequest } from "../../../lib/runtime.ts";
import { gscFilters } from "../../../lib/period-selection.ts";

export default async function SiteSeoDashboardPage({ params, searchParams }: Readonly<{ params: Promise<{ siteSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const runtime = await getSiteSeoRuntime();
  const { siteSlug } = await params;
  if (siteSlug !== runtime.registration.profile.slug) notFound();
  const session = await runtime.resolveSession((await cookies()).toString(), runtime.registration);
  if (!session) return <main><h1>{runtime.registration.profile.title}</h1><LoginForm dashboardId={runtime.registration.profile.dashboardId} siteSlug={siteSlug} /></main>;
  try {
    const values = await searchParams;
    const url = new URL("https://site-seo.local/dashboard");
    for (const [key, value] of Object.entries(values)) if (typeof value === "string") url.searchParams.set(key, value);
    const hasPeriodState = ["traffic_week", "gsc_period", "alice_month"].some((key) => url.searchParams.has(key));
    const request = hasPeriodState
      ? parseDashboardReadRequest(url, siteSlug, runtime.registration.profile.businessTimezone)
      : { slug: siteSlug, selection: defaultPeriodSelection(runtime.registration.profile.businessTimezone), publicationId: null, filters: gscFilters() };
    const model = await loadDashboardReadModel({ registration: runtime.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: runtime.execute });
    return <Dashboard profile={runtime.registration.profile} model={model} selection={request.selection} publicationId={request.publicationId} filters={request.filters} />;
  } catch {
    return <main><h1>{runtime.registration.profile.title}</h1><p>Данные пока недоступны: не установлен canonical read model.</p></main>;
  }
}
