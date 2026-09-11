import type { ReactNode } from "react";

type PanelProps = Readonly<{
  title: ReactNode;
  subtitle?: ReactNode;
  state?: string;
  panelId?: string;
  children?: ReactNode;
}>;

type KpiProps = Readonly<{
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}>;

const stateLabels: Readonly<Record<string, string>> = {
  ready: "Данные готовы",
  partial: "Данные неполные",
  complete_empty: "Подтверждённо пусто",
  missing: "Данные не опубликованы",
  failed: "Ошибка последнего сбора",
  disabled: "Источник отключён",
};

export function datasetStateLabel(state: string): string {
  return stateLabels[state] ?? state;
}

export function Panel({ title, subtitle, state, panelId, children }: PanelProps) {
  return (
    <section className="site-seo-panel" data-state={state} data-panel-id={panelId}>
      <header className="site-seo-panel-header">
        <h2>{title}</h2>
      {subtitle !== undefined && subtitle !== null ? <p>{subtitle}</p> : null}
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
      {detail !== undefined && detail !== null ? <span className="site-seo-kpi-detail">{detail}</span> : null}
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
      {datasetStateLabel(state)}
    </span>
  );
}

export function EmptyNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="site-seo-empty-notice">{children}</p>;
}
