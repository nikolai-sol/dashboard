import type { ReactNode } from "react";
import type { DashboardTab } from "./Dashboard.tsx";

type SiteSeoShellProps = Readonly<{
  title: string;
  domain?: string;
  logoAsset?: string | null;
  tabs: readonly DashboardTab[];
  activeTab: string;
  tabHref: (id: string) => string;
  toolbar: ReactNode;
  exports: ReactNode;
  children?: ReactNode;
}>;

export function SiteSeoShell({ title, domain, logoAsset, tabs, activeTab, tabHref, toolbar, exports, children }: SiteSeoShellProps) {
  const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? tabs[0]?.label ?? title;
  const fallbackMark = title.trim().slice(0, 1).toUpperCase();
  return (
    <main className="site-seo-page" data-dashboard-ready="true">
      <div className="site-seo-dashboard">
        <aside className="site-seo-rail">
          <div className="site-seo-identity">
            {logoAsset ? <img className="site-seo-logo" src={logoAsset} alt="" /> : <span className="site-seo-logo-fallback" aria-hidden="true">{fallbackMark}</span>}
            <div>
              <strong>{title}</strong>
              {domain ? <p>{domain}</p> : null}
            </div>
          </div>
          <nav className="site-seo-nav" aria-label="Разделы">
            {tabs.map((tab) => (
              <a key={tab.id} href={tabHref(tab.id)} aria-current={tab.id === activeTab ? "page" : undefined}>
                <span className="site-seo-nav-mark" aria-hidden="true" />{tab.label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="site-seo-content">
          <header className="site-seo-header">
            <div className="site-seo-header-row">
              <h1>{activeLabel}</h1>
              <div className="site-seo-exports">{exports}</div>
            </div>
            <nav className="site-seo-mobile-tabs" aria-label="Разделы">
              {tabs.map((tab) => <a key={tab.id} href={tabHref(tab.id)} aria-current={tab.id === activeTab ? "page" : undefined}>{tab.label}</a>)}
            </nav>
            <div className="site-seo-toolbar">{toolbar}</div>
          </header>
          <div className="site-seo-selected-tab">{children}</div>
        </div>
      </div>
    </main>
  );
}
