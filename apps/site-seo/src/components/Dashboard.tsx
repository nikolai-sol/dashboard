import type { SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { Overview } from "./Overview.tsx";
import { Search } from "./Search.tsx";
import { Wordstat } from "./Wordstat.tsx";
import { Alice } from "./Alice.tsx";
import { SeoOs } from "./SeoOs.tsx";
import { Sources } from "./Sources.tsx";
import { PeriodSelector, buildDashboardQuery } from "./PeriodSelector.tsx";
import type { PeriodSelection } from "../lib/period-selection.ts";

export type DashboardTab = Readonly<{ id: string; label: string }>;

function enabled(profile: SiteProfile, sourceKey: SiteProfile["sources"][number]["sourceKey"]): boolean {
  return profile.sources.some((source) => source.sourceKey === sourceKey && source.mode !== "disabled");
}

export function dashboardTabs(profile: SiteProfile): DashboardTab[] {
  const tabs: DashboardTab[] = [{ id: "overview", label: "Обзор" }];
  if (enabled(profile, "yandex_metrika")) tabs.push({ id: "traffic", label: "Посещаемость и страницы" });
  if (enabled(profile, "yandex_webmaster") || enabled(profile, "google_search_console")) tabs.push({ id: "search", label: "Поиск и индексация" });
  if (enabled(profile, "yandex_wordstat")) tabs.push({ id: "wordstat", label: "Wordstat" });
  if (enabled(profile, "yandex_webmaster_alice_manual")) tabs.push({ id: "alice", label: "AI-видимость и конкуренты" });
  if (enabled(profile, "seo_os")) tabs.push({ id: "seo-os", label: "SEO OS" });
  tabs.push({ id: "sources", label: "Источники" });
  return tabs;
}

export function Dashboard({ profile, model, selection, publicationId, filters }: Readonly<{ profile: SiteProfile; model: DashboardReadModel; selection: PeriodSelection; publicationId: string | null; filters: Readonly<Record<string, string>> }>) {
  const query = buildDashboardQuery(selection, publicationId, filters);
  const gscEnabled = enabled(profile, "google_search_console");
  return <main data-dashboard-ready="true">
    <h1>{profile.title}</h1>
    <PeriodSelector selection={selection} publicationId={publicationId} filters={filters} />
    <p><a href={`/api/dashboard/${profile.slug}?${query}`}>JSON</a>{" · "}<a href={`/api/dashboard/${profile.slug}/excel?${query}`}>Excel</a>{" · "}<a href={`/api/dashboard/${profile.slug}/pdf?${query}`}>PDF</a></p>
    <nav aria-label="Разделы">{dashboardTabs(profile).map((tab) => <a key={tab.id} href={`#${tab.id}`}>{tab.label}</a>)}</nav>
    <Overview id="overview" model={model} showGsc={gscEnabled} />
    {enabled(profile, "yandex_metrika") && <section id="traffic"><h2>Посещаемость и страницы</h2><p>Метрика: {model.datasets.yandex_metrika?.state ?? "missing"}</p>
      {model.metrika?.summary && <p>Визиты: {model.metrika.summary.visits}; просмотры: {model.metrika.summary.pageviews}</p>}
      {model.metrika && <><h3>Динамика</h3><table><tbody>{model.metrika.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>визиты: {row.visits}</td><td>просмотры: {row.pageviews}</td><td>Пользователи за день: {row.users ?? "неизвестно"}</td></tr>)}</tbody></table>
        <h3>Страницы</h3><table><tbody>{model.metrika.topPages.map((row) => <tr key={row.page}><th>{row.page}</th><td>визиты: {row.visits}</td><td>просмотры: {row.pageviews}</td></tr>)}</tbody></table></>}
    </section>}
    {(enabled(profile, "yandex_webmaster") || gscEnabled) && <Search id="search" model={model} showGsc={gscEnabled} />}
    {enabled(profile, "yandex_wordstat") && <Wordstat id="wordstat" meta={model.datasets.yandex_wordstat} />}
    {enabled(profile, "yandex_webmaster_alice_manual") && <Alice id="alice" meta={model.datasets.yandex_webmaster_alice_manual} />}
    {enabled(profile, "seo_os") && <SeoOs id="seo-os" meta={model.datasets.seo_os} />}
    <Sources id="sources" profile={profile} model={model} />
  </main>;
}
