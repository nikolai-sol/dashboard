import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { ReactNode } from "react";
import type { DashboardReadModel } from "../lib/read-model.ts";

type SourceState = DatasetMeta["state"];
const number = new Intl.NumberFormat("ru-RU");

function value(metric: number | null | undefined): string {
  return metric == null || !Number.isFinite(metric) ? "—" : number.format(metric);
}

function percent(metric: number | null | undefined): string {
  return metric == null || !Number.isFinite(metric) ? "—" : `${metric.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function sourceState(meta: DatasetMeta | null | undefined): SourceState {
  return meta?.state ?? "missing";
}

function SourceBadge({ label, state }: Readonly<{ label: string; state: SourceState }>) {
  return <span className="site-seo-source-badge" data-state={state}><span aria-hidden="true" />{label}</span>;
}

function OverviewSlot({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return <div data-panel-id={`overview.${id}`}>{children}</div>;
}

function OverviewPanel({ title, subtitle, source, state, children }: Readonly<{
  title: string;
  subtitle?: string;
  source?: string;
  state?: SourceState;
  children: ReactNode;
}>) {
  return (
    <section className="site-seo-panel site-seo-overview-panel" data-state={state}>
      <header className="site-seo-overview-panel-header">
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        {source && state ? <SourceBadge label={source} state={state} /> : null}
      </header>
      <div className="site-seo-overview-panel-body">{children}</div>
    </section>
  );
}

function GoalKpi({ label, metric, detail }: Readonly<{ label: string; metric: number | null | undefined; detail: string }>) {
  return (
    <div className="site-seo-goal-kpi">
      <span>{label}</span>
      <div><strong className="site-seo-kpi-value">{value(metric)}</strong><small>{detail}</small></div>
    </div>
  );
}

function HealthKpi({ label, metric, detail }: Readonly<{ label: string; metric: string; detail?: string }>) {
  return (
    <div className="site-seo-health-kpi">
      <span>{label}</span><strong className="site-seo-kpi-value">{metric}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function EmptyOverviewState({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="site-seo-overview-empty">{children}</div>;
}

type TrendRow = Readonly<{ date: string; visits: number }>;

function SearchTrend({ rows }: Readonly<{ rows: readonly TrendRow[] }>) {
  if (rows.length === 0) return <EmptyOverviewState>Нет опубликованной динамики органического поиска.</EmptyOverviewState>;
  const max = Math.max(1, ...rows.map((row) => row.visits));
  const denominator = Math.max(1, rows.length - 1);
  const coordinates = rows.map((row, index) => ({ x: rows.length === 1 ? 400 : 20 + index / denominator * 760, y: 160 - row.visits / max * 135 }));
  const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <div className="site-seo-trend">
      <div className="site-seo-trend-legend"><span aria-hidden="true" />Поисковые визиты · Метрика · Россия</div>
      <svg viewBox="0 0 800 180" preserveAspectRatio="none" role="img" aria-label="Динамика поисковых визитов в России">
        <line x1="20" y1="25" x2="780" y2="25" />
        <line x1="20" y1="92" x2="780" y2="92" />
        <line x1="20" y1="160" x2="780" y2="160" />
        {rows.length === 1 ? <circle cx={coordinates[0]!.x} cy={coordinates[0]!.y} r="4" /> : <polyline points={points} />}
      </svg>
      <div className="site-seo-trend-axis"><span>{rows[0]!.date}</span><span>{rows.at(-1)!.date}</span></div>
    </div>
  );
}

export function Overview({ id, model, showGsc, showMetrika = true, showWebmaster = true }: Readonly<{
  id: string;
  model: DashboardReadModel;
  showGsc: boolean;
  showMetrika?: boolean;
  showWebmaster?: boolean;
}>) {
  const metrikaMeta = showMetrika ? model.metrika ?? model.datasets.yandex_metrika : null;
  const latestUsers = [...(model.metrika?.daily ?? [])].reverse().find((row) => row.users != null) ?? null;

  return (
    <div id={id} className="site-seo-overview-grid">
      <OverviewSlot id="north_star">
        <section className="site-seo-panel site-seo-goal-panel">
          <h2>Цель: рост целевого органического трафика</h2>
          <div className="site-seo-goal-kpis">
            {showMetrika ? <GoalKpi label="Поисковые визиты" metric={model.metrika?.summary?.visits} detail="Метрика · Россия" /> : null}
            {showGsc ? <GoalKpi label="Google" metric={model.gsc.summary?.clicks} detail="клики" /> : null}
            {showWebmaster ? <GoalKpi label="Яндекс" metric={model.webmaster?.summary?.clicks} detail="клики" /> : null}
          </div>
        </section>
      </OverviewSlot>

      <OverviewSlot id="traffic_health">
        <OverviewPanel title="Здоровье трафика" subtitle="Поисковый трафик в России" source="Метрика" state={sourceState(metrikaMeta)}>
          <div className="site-seo-health-grid">
            <HealthKpi label="Визиты" metric={value(model.metrika?.summary?.visits)} detail="поисковые · Россия" />
            <HealthKpi label="Просмотры" metric={value(model.metrika?.summary?.pageviews)} detail="поисковые · Россия" />
            <HealthKpi label="Пользователи за день" metric={value(latestUsers?.users)} detail={latestUsers?.date} />
            <HealthKpi label="CTR Google" metric={showGsc ? percent(model.gsc.summary?.ctrPct) : "—"} />
            <HealthKpi label="CTR Яндекс" metric={showWebmaster ? percent(model.webmaster?.summary?.ctrPct) : "—"} />
          </div>
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="channels">
        <OverviewPanel title="Каналы привлечения" source="Метрика" state="missing">
          <EmptyOverviewState>Разбивка по каналам пока не опубликована в универсальном наборе данных.</EmptyOverviewState>
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="search_engines">
        <OverviewPanel title="Поисковые системы" subtitle="Распределение визитов" source="Метрика" state="missing">
          <EmptyOverviewState>Разбивка по поисковым системам пока не опубликована.</EmptyOverviewState>
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="organic_search">
        <OverviewPanel title="Органический поиск" subtitle="Поисковые визиты · Россия" source="Метрика" state={sourceState(metrikaMeta)}>
          <SearchTrend rows={showMetrika ? model.metrika?.daily ?? [] : []} />
        </OverviewPanel>
      </OverviewSlot>
    </div>
  );
}
