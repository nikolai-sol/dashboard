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
  return (
    <main className="site-seo-shell" data-dashboard-ready="true">
      <nav className="site-seo-rail" aria-label="Разделы">
        {tabs.map((tab) => (
          <a key={tab.id} href={tabHref(tab.id)} aria-current={tab.id === activeTab ? "page" : undefined}>
            {tab.label}
          </a>
        ))}
      </nav>
      <div className="site-seo-content">
        <header className="site-seo-header">
          <div className="site-seo-identity">
            {logoAsset ? <img className="site-seo-logo" src={logoAsset} alt="" /> : null}
            <div>
              <h1>{title}</h1>
              {domain ? <p>{domain}</p> : null}
            </div>
          </div>
          <div className="site-seo-exports">{exports}</div>
        </header>
        <div className="site-seo-toolbar">{toolbar}</div>
        <div className="site-seo-selected-tab">{children}</div>
      </div>
    </main>
  );
}
