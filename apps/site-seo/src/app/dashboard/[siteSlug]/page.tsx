import { cookies } from "next/headers";
import { Dashboard } from "../../../components/Dashboard.tsx";
import { LoginForm } from "../../../components/LoginForm.tsx";
import { loadDashboardReadModel } from "../../../lib/read-model.ts";
import { defaultPeriodSelection, getSiteSeoRuntime } from "../../../lib/runtime.ts";

export default async function SiteSeoDashboardPage({ params }: Readonly<{ params: Promise<{ siteSlug: string }> }>) {
  const runtime = await getSiteSeoRuntime();
  const { siteSlug } = await params;
  if (siteSlug !== runtime.registration.profile.slug) return <main>Страница не найдена</main>;
  const session = await runtime.resolveSession((await cookies()).toString(), runtime.registration);
  if (!session) return <main><h1>{runtime.registration.profile.title}</h1><LoginForm dashboardId={runtime.registration.profile.dashboardId} /></main>;
  try {
    const model = await loadDashboardReadModel({ registration: runtime.registration, claim: session, selection: defaultPeriodSelection(runtime.registration.profile.businessTimezone), publicationId: null, filters: {}, execute: runtime.execute });
    return <Dashboard profile={runtime.registration.profile} model={model} />;
  } catch {
    return <main><h1>{runtime.registration.profile.title}</h1><p>Данные пока недоступны: не установлен canonical read model.</p></main>;
  }
}
