import type { SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { Overview } from "./Overview.tsx";
import { Search } from "./Search.tsx";
import { Wordstat } from "./Wordstat.tsx";
import { Alice } from "./Alice.tsx";
import { SeoOs } from "./SeoOs.tsx";
import { Sources } from "./Sources.tsx";

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

export function Dashboard({ profile, model }: Readonly<{ profile: SiteProfile; model: DashboardReadModel }>) {
  return <main>
    <h1>{profile.title}</h1>
    <nav aria-label="Разделы">{dashboardTabs(profile).map((tab) => <a key={tab.id} href={`#${tab.id}`}>{tab.label}</a>)}</nav>
    <Overview id="overview" model={model} />
    {enabled(profile, "yandex_metrika") && <section id="traffic"><h2>Посещаемость и страницы</h2><p>{model.datasets.yandex_metrika?.state ?? "missing"}</p></section>}
    {(enabled(profile, "yandex_webmaster") || enabled(profile, "google_search_console")) && <Search id="search" model={model} />}
    {enabled(profile, "yandex_wordstat") && <Wordstat id="wordstat" meta={model.datasets.yandex_wordstat} />}
    {enabled(profile, "yandex_webmaster_alice_manual") && <Alice id="alice" meta={model.datasets.yandex_webmaster_alice_manual} />}
    {enabled(profile, "seo_os") && <SeoOs id="seo-os" meta={model.datasets.seo_os} />}
    <Sources id="sources" profile={profile} model={model} />
  </main>;
}
