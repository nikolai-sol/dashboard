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
import { SiteSeoShell } from "./SiteSeoShell.tsx";
import { Traffic } from "./Traffic.tsx";

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

export function resolveActiveTab(tabs: readonly DashboardTab[], requested?: string): string {
  return tabs.some((tab) => tab.id === requested) ? requested! : tabs[0]!.id;
}

export function Dashboard({ profile, model, selection, publicationId, filters, activeTab: requestedTab }: Readonly<{ profile: SiteProfile; model: DashboardReadModel; selection: PeriodSelection; publicationId: string | null; filters: Readonly<Record<string, string>>; activeTab?: string }>) {
  const query = buildDashboardQuery(selection, publicationId, filters);
  const gscEnabled = enabled(profile, "google_search_console");
  const webmasterComparison = model.trafficComparison.yandex_webmaster;
  const tabs = dashboardTabs(profile);
  const activeTab = resolveActiveTab(tabs, requestedTab);
  const tabHref = (id: string) => `?${query}&tab=${encodeURIComponent(id)}`;
  const toolbar = <PeriodSelector selection={selection} publicationId={publicationId} filters={filters} activeTab={activeTab} />;
  const exports = <p><a href={`/api/dashboard/${profile.slug}?${query}`}>JSON</a>{" · "}<a href={`/api/dashboard/${profile.slug}/excel?${query}`}>Excel</a>{" · "}<a href={`/api/dashboard/${profile.slug}/pdf?${query}`}>PDF</a></p>;

  let section;
  if (activeTab === "overview") section = <Overview id="overview" model={model} showGsc={gscEnabled} />;
  else if (activeTab === "traffic") section = <Traffic id="traffic" model={model} selection={selection} />;
  else if (activeTab === "search") section = <><Search id="search" model={model} showGsc={gscEnabled} />
    {selection.traffic.comparison && webmasterComparison && "kind" in webmasterComparison && webmasterComparison.kind === "webmaster" && <p>Сравнение Webmaster {selection.traffic.comparison.key}: клики {webmasterComparison.summary?.clicks ?? "нет данных"}; показы {webmasterComparison.summary?.impressions ?? "нет данных"}</p>}</>;
  else if (activeTab === "wordstat") section = <Wordstat id="wordstat" meta={model.datasets.yandex_wordstat} data={model.wordstat} />;
  else if (activeTab === "alice") section = <Alice id="alice" meta={model.datasets.yandex_webmaster_alice_manual} data={model.alice} />;
  else if (activeTab === "seo-os") section = <SeoOs id="seo-os" meta={model.datasets.seo_os} data={model.seoOs} />;
  else section = <Sources id="sources" profile={profile} model={model} />;

  return <SiteSeoShell title={profile.title} domain={profile.domain} logoAsset={profile.logoAsset} tabs={tabs} activeTab={activeTab} tabHref={tabHref} toolbar={toolbar} exports={exports}>{section}</SiteSeoShell>;
}
