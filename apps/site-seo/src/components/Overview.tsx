import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { ReactNode } from "react";
import type { MetrikaBreakdownRow } from "../lib/db.ts";
import type { DashboardReadModel } from "../lib/read-model.ts";

type SourceState = DatasetMeta["state"];
const number = new Intl.NumberFormat("ru-RU");

function value(metric: number | null | undefined): string {
  return metric == null || !Number.isFinite(metric) ? "—" : number.format(metric);
}

function percent(metric: number | null | undefined): string {
  return metric == null || !Number.isFinite(metric) ? "—" : `${metric.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function decimal(metric: number | null | undefined): string {
  return metric == null || !Number.isFinite(metric) ? "—" : metric.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function sourceState(meta: DatasetMeta | null | undefined): SourceState {
  return meta?.state ?? "missing";
}

function stateCopy(state: SourceState): string {
  if (state === "ready") return "данные готовы";
  if (state === "complete_empty") return "подтверждённо пусто";
  if (state === "partial") return "данные неполные";
  if (state === "failed") return "ошибка последнего сбора";
  return "данные не опубликованы";
}

function periodCopy(meta: DatasetMeta | null | undefined): string | null {
  return meta?.period ? `${meta.period.from} — ${meta.period.to}` : null;
}

function sourceDetail(label: string, meta: DatasetMeta | null | undefined): string {
  return [label, periodCopy(meta), stateCopy(sourceState(meta))].filter(Boolean).join(" · ");
}

function SourceBadge({ label, state, statusText }: Readonly<{ label: string; state: SourceState; statusText?: string }>) {
  return <span className="site-seo-source-badge" data-state={state}><span className="site-seo-source-dot" aria-hidden="true" /><strong>{label}</strong><em>{statusText ?? stateCopy(state)}</em></span>;
}

function OverviewSlot({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return <div data-panel-id={`overview.${id}`}>{children}</div>;
}

function OverviewPanel({ title, subtitle, source, state, statusText, children }: Readonly<{
  title: string;
  subtitle?: string;
  source?: string;
  state?: SourceState;
  statusText?: string;
  children: ReactNode;
}>) {
  return (
    <section className="site-seo-panel site-seo-overview-panel" data-state={state}>
      <header className="site-seo-overview-panel-header">
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        {source && state ? <SourceBadge label={source} state={state} statusText={statusText} /> : null}
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

const trafficSourceLabels: Readonly<Record<string, string>> = {
  "Search engine traffic": "Поиск",
  "Direct traffic": "Прямые заходы",
  "Link traffic": "Переходы по ссылкам",
  "Social network traffic": "Соцсети",
  "Messenger traffic": "Мессенджеры",
  "Mailing traffic": "Рассылки",
  "Ad traffic": "Реклама",
  "Recommendation system traffic": "Рекомендации",
  "Internal traffic": "Внутренний трафик",
  "Cached page traffic": "Кешированные страницы",
  Unknown: "Неизвестно",
};

function BreakdownList({ rows, translateTrafficSources = false }: Readonly<{
  rows: readonly MetrikaBreakdownRow[];
  translateTrafficSources?: boolean;
}>) {
  const maxVisits = Math.max(1, ...rows.map((row) => row.visits));
  return (
    <ol className="site-seo-breakdown-list">
      {rows.map((row, index) => <li key={`${row.id ?? row.label}:${index}`}>
        <div><span>{translateTrafficSources ? trafficSourceLabels[row.label] ?? row.label : row.label}</span><strong>{value(row.visits)}</strong></div>
        <span className="site-seo-breakdown-track" aria-hidden="true"><span style={{ width: `${row.visits / maxVisits * 100}%` }} /></span>
        <small>визиты · просмотры {value(row.pageviews)}</small>
      </li>)}
    </ol>
  );
}

function breakdownState(rows: readonly MetrikaBreakdownRow[], metrikaState: SourceState): SourceState {
  if (rows.length > 0) return metrikaState;
  return metrikaState === "complete_empty" ? "complete_empty" : "missing";
}

type TrendRow = Readonly<{ date: string; visits: number }>;

function SearchTrend({ rows, state }: Readonly<{ rows: readonly TrendRow[]; state: SourceState }>) {
  if (rows.length === 0) return <EmptyOverviewState>Динамика: {stateCopy(state)}.</EmptyOverviewState>;
  const sorted = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const first = timestamp(sorted[0]!.date);
  const last = timestamp(sorted.at(-1)!.date);
  const dateRange = Math.max(86_400_000, last - first);
  const max = Math.max(1, ...sorted.map((row) => row.visits));
  const coordinates = sorted.map((row) => ({ row, time: timestamp(row.date), x: sorted.length === 1 ? 400 : 20 + (timestamp(row.date) - first) / dateRange * 760, y: 160 - row.visits / max * 135 }));
  const segments: Array<typeof coordinates> = [];
  for (const point of coordinates) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!previous || point.time - previous.time > 86_400_000) segments.push([point]);
    else segment!.push(point);
  }
  return (
    <div className="site-seo-trend">
      <div className="site-seo-trend-legend"><span aria-hidden="true" />Поисковые визиты · Метрика · Россия</div>
      <svg viewBox="0 0 800 180" preserveAspectRatio="none" role="img" aria-label="Динамика поисковых визитов в России">
        <line x1="20" y1="25" x2="780" y2="25" />
        <line x1="20" y1="92" x2="780" y2="92" />
        <line x1="20" y1="160" x2="780" y2="160" />
        {segments.map((segment, index) => <g data-series-segment={index} key={segment[0]!.row.date}>
          {segment.length > 1 ? <polyline points={segment.map((point) => `${point.x},${point.y}`).join(" ")} /> : null}
          {segment.map((point) => <circle key={point.row.date} cx={point.x} cy={point.y} r="3.5" />)}
        </g>)}
      </svg>
      <div className="site-seo-trend-axis"><span>{sorted[0]!.date}</span><span>{sorted.at(-1)!.date}</span></div>
      <table className="site-seo-sr-only"><caption>Ежедневные поисковые визиты</caption><thead><tr><th>Дата</th><th>Визиты</th></tr></thead><tbody>{sorted.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.visits}</td></tr>)}</tbody></table>
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
  const gscMeta = showGsc ? model.gsc.meta : null;
  const webmasterMeta = showWebmaster ? model.webmaster ?? model.datasets.yandex_webmaster : null;
  const metrikaState = sourceState(metrikaMeta);
  const trafficMeta = showMetrika ? model.metrika?.trafficMeta : null;
  const trafficState = sourceState(trafficMeta);
  const trafficHealth = model.metrika?.trafficHealth;
  const channels = model.metrika?.channels ?? [];
  const searchEngines = model.metrika?.searchEngines ?? [];
  const channelsState = breakdownState(channels, trafficState);
  const searchEnginesState = breakdownState(searchEngines, metrikaState);

  return (
    <div id={id} className="site-seo-overview-grid">
      <OverviewSlot id="north_star">
        <section className="site-seo-panel site-seo-goal-panel">
          <h2>Цель: рост целевого органического трафика</h2>
          <div className="site-seo-goal-kpis">
            {showMetrika ? <GoalKpi label="Поисковые визиты" metric={model.metrika?.summary?.visits} detail={sourceDetail("Метрика · Россия", metrikaMeta)} /> : null}
            {showGsc ? <GoalKpi label="Google" metric={model.gsc.summary?.clicks} detail={sourceDetail("клики · GSC", gscMeta)} /> : null}
            {showWebmaster ? <GoalKpi label="Яндекс" metric={model.webmaster?.summary?.clicks} detail={sourceDetail("клики · Вебмастер", webmasterMeta)} /> : null}
          </div>
        </section>
      </OverviewSlot>

      <OverviewSlot id="traffic_health">
        <OverviewPanel title="Здоровье трафика" subtitle={showMetrika ? "Весь трафик" : "Источник отключён"} source="Метрика" state={trafficState} statusText={showMetrika ? undefined : "источник отключён"}>
          <div className="site-seo-health-grid">
            {showMetrika ? <HealthKpi label="Визиты" metric={value(trafficHealth?.visits)} detail={sourceDetail("весь трафик", trafficMeta)} /> : null}
            {showMetrika ? <HealthKpi label="Просмотры" metric={value(trafficHealth?.pageviews)} detail={sourceDetail("весь трафик", trafficMeta)} /> : null}
            {showMetrika ? <HealthKpi label="Отказы" metric={percent(trafficHealth?.bounceRate)} /> : null}
            {showMetrika ? <HealthKpi label="Ср. время" metric={duration(trafficHealth?.avgVisitDurationSeconds)} /> : null}
            {showMetrika ? <HealthKpi label="Глубина" metric={decimal(trafficHealth?.pageDepth)} /> : null}
          </div>
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="channels">
        <OverviewPanel title="Каналы привлечения" source="Метрика" state={showMetrika ? channelsState : "missing"} statusText={showMetrika && channels.length === 0 ? "нет строк за период" : showMetrika ? undefined : "источник отключён"}>
          {!showMetrika ? <EmptyOverviewState>Источник Метрика отключён.</EmptyOverviewState>
            : channels.length > 0 ? <BreakdownList rows={channels} translateTrafficSources />
              : <EmptyOverviewState>Нет опубликованных строк каналов за выбранный период.</EmptyOverviewState>}
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="search_engines">
        <OverviewPanel title="Поисковые системы" subtitle="Поисковые визиты · Россия" source="Метрика" state={showMetrika ? searchEnginesState : "missing"} statusText={showMetrika && searchEngines.length === 0 ? "нет строк за период" : showMetrika ? undefined : "источник отключён"}>
          {!showMetrika ? <EmptyOverviewState>Источник Метрика отключён.</EmptyOverviewState>
            : searchEngines.length > 0 ? <BreakdownList rows={searchEngines} />
              : <EmptyOverviewState>Нет опубликованных строк поисковых систем за выбранный период.</EmptyOverviewState>}
        </OverviewPanel>
      </OverviewSlot>

      <OverviewSlot id="organic_search">
        <OverviewPanel title="Органический поиск" subtitle={showMetrika ? "Поисковые визиты · Россия" : "Источник отключён"} source="Метрика" state={metrikaState} statusText={showMetrika ? undefined : "источник отключён"}>
          {showMetrika ? <SearchTrend rows={model.metrika?.daily ?? []} state={metrikaState} /> : <EmptyOverviewState>Источник Метрика отключён.</EmptyOverviewState>}
        </OverviewPanel>
      </OverviewSlot>
    </div>
  );
}
