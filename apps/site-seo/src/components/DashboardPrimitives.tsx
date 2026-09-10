import type { ReactNode } from "react";

type PanelProps = Readonly<{
  title: ReactNode;
  subtitle?: ReactNode;
  state?: string;
  children?: ReactNode;
}>;

type KpiProps = Readonly<{
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}>;

export function Panel({ title, subtitle, state, children }: PanelProps) {
  return (
    <section className="site-seo-panel" data-state={state}>
      <header className="site-seo-panel-header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="site-seo-panel-body">{children}</div>
    </section>
  );
}

export function KpiStrip({ children }: Readonly<{ children?: ReactNode }>) {
  return <div className="site-seo-kpi-strip">{children}</div>;
}

export function Kpi({ label, value, detail }: KpiProps) {
  return (
    <div className="site-seo-kpi">
      <span className="site-seo-kpi-label">{label}</span>
      <span className="site-seo-kpi-value">{value}</span>
      {detail ? <span className="site-seo-kpi-detail">{detail}</span> : null}
    </div>
  );
}

export function TableFrame({
  label,
  children,
}: Readonly<{ label: string; children?: ReactNode }>) {
  return (
    <div
      className="site-seo-table-frame"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ state }: Readonly<{ state: string }>) {
  return (
    <span className="site-seo-status-badge" data-state={state}>
      {state}
    </span>
  );
}
