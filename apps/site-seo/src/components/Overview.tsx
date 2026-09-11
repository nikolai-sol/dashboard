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

function BreakdownList({ rows, translateTrafficSources = false, className = "site-seo-breakdown-list" }: Readonly<{
  rows: readonly MetrikaBreakdownRow[];
  translateTrafficSources?: boolean;
  className?: string;
}>) {
  const maxVisits = Math.max(1, ...rows.map((row) => row.visits));
  return (
    <ol className={className}>
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

type WeeklyTrendRow = Readonly<{ week: string; start: number; visits: number }>;
type TrendTick = Readonly<{ value: number; y: number }>;

function isoWeek(date: string): Readonly<{ key: string; start: number }> {
  const value = new Date(`${date}T00:00:00Z`);
  const monday = new Date(value);
  monday.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const fourthJanuary = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(fourthJanuary);
  firstMonday.setUTCDate(fourthJanuary.getUTCDate() - ((fourthJanuary.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((monday.getTime() - firstMonday.getTime()) / 604_800_000);
  return { key: `${year}-W${String(week).padStart(2, "0")}`, start: monday.getTime() };
}

function weeklyTrend(rows: readonly TrendRow[]): WeeklyTrendRow[] {
  const weeks = new Map<string, WeeklyTrendRow>();
  for (const row of rows) {
    const { key, start } = isoWeek(row.date);
    const current = weeks.get(key);
    weeks.set(key, { week: key, start, visits: (current?.visits ?? 0) + row.visits });
  }
  return [...weeks.values()].sort((left, right) => left.start - right.start);
}

function SearchTrend({ rows, state }: Readonly<{ rows: readonly TrendRow[]; state: SourceState }>) {
  if (rows.length === 0) return <EmptyOverviewState>Динамика: {stateCopy(state)}.</EmptyOverviewState>;
  const sorted = weeklyTrend(rows);
  const first = sorted[0]!.start;
  const last = sorted.at(-1)!.start;
  const dateRange = Math.max(604_800_000, last - first);
  const max = Math.max(0, ...sorted.map((row) => row.visits));
  const scaleMax = Math.max(1, max);
  const ticks: readonly TrendTick[] = max === 0
    ? [{ value: 0, y: 160 }]
    : max === 1
      ? [{ value: 1, y: 25 }, { value: 0, y: 160 }]
      : [{ value: max, y: 25 }, { value: max / 2, y: 92.5 }, { value: 0, y: 160 }];
  const coordinates = sorted.map((row) => ({ row, x: sorted.length === 1 ? 400 : 20 + (row.start - first) / dateRange * 760, y: 160 - row.visits / scaleMax * 135 }));
  const segments: Array<typeof coordinates> = [];
  for (const point of coordinates) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!previous || point.row.start - previous.row.start > 604_800_000) segments.push([point]);
    else segment!.push(point);
  }
  return (
    <div className="site-seo-trend">
      <div className="site-seo-trend-legend"><span aria-hidden="true" />Поисковые визиты · Метрика · Россия</div>
      <div className="site-seo-trend-chart">
        <div className="site-seo-trend-y-axis" aria-hidden="true">{ticks.map((tick) => <span data-axis-tick={tick.value} style={{ top: `${tick.y / 180 * 100}%` }} key={tick.value}>{value(tick.value)}</span>)}</div>
        <svg viewBox="0 0 800 180" preserveAspectRatio="none" role="img" aria-label="Еженедельная динамика поисковых визитов в России">
          {ticks.map((tick) => <line data-grid-tick={tick.value} x1="20" y1={tick.y} x2="780" y2={tick.y} key={tick.value} />)}
          {segments.map((segment, index) => <g data-series-segment={index} key={segment[0]!.row.week}>
            {segment.length > 1 ? <polyline points={segment.map((point) => `${point.x},${point.y}`).join(" ")} /> : null}
            {segment.map((point) => <circle data-week={point.row.week} key={point.row.week} cx={point.x} cy={point.y} r="3.5" />)}
          </g>)}
        </svg>
      </div>
      <div className="site-seo-trend-axis" data-single={sorted.length === 1}><span>{sorted[0]!.week}</span>{sorted.length > 1 ? <span>{sorted.at(-1)!.week}</span> : null}</div>
      <table className="site-seo-sr-only"><caption>Еженедельные поисковые визиты</caption><thead><tr><th>ISO-неделя</th><th>Визиты</th></tr></thead><tbody>{sorted.map((row) => <tr key={row.week}><td>{row.week}</td><td>{row.visits}</td></tr>)}</tbody></table>
    </div>
  );
}

type OverviewSearchEngine = Readonly<{ id: "google" | "yandex"; label: string; metrics: MetrikaBreakdownRow | null }>;

function weightedEngineMetric(rows: readonly MetrikaBreakdownRow[], key: "bounceRate" | "avgVisitDurationSeconds" | "pageDepth"): number | null {
  const measured = rows.filter((row) => row[key] !== null);
  const visits = measured.reduce((sum, row) => sum + row.visits, 0);
  return visits > 0 ? measured.reduce((sum, row) => sum + row[key]! * row.visits, 0) / visits : null;
}

function overviewSearchEngines(rows: readonly MetrikaBreakdownRow[]): OverviewSearchEngine[] {
  return ([
    { id: "google", pattern: /google/i, label: "Google" },
    { id: "yandex", pattern: /yandex|яндекс/i, label: "Яндекс" },
  ] as const).map(({ id, pattern, label }) => {
    const matches = rows.filter((candidate) => pattern.test(`${candidate.id ?? ""} ${candidate.label}`));
    if (matches.length === 0) return { id, label, metrics: null };
    return { id, label, metrics: {
      id,
      label,
      visits: matches.reduce((sum, row) => sum + row.visits, 0),
      pageviews: matches.reduce((sum, row) => sum + row.pageviews, 0),
      bounceRate: weightedEngineMetric(matches, "bounceRate"),
      avgVisitDurationSeconds: weightedEngineMetric(matches, "avgVisitDurationSeconds"),
      pageDepth: weightedEngineMetric(matches, "pageDepth"),
    } };
  });
}

function SearchEngineGrid({ engines, missingCopy }: Readonly<{ engines: readonly OverviewSearchEngine[]; missingCopy: string }>) {
  const maxVisits = Math.max(1, ...engines.flatMap((engine) => engine.metrics ? [engine.metrics.visits] : []));
  return <ol className="site-seo-breakdown-list site-seo-engine-grid">
    {engines.map(({ id, label, metrics }) => <li
      key={id}
      data-engine-slot={id}
      data-bounce-rate={metrics?.bounceRate ?? undefined}
      data-avg-visit-duration-seconds={metrics?.avgVisitDurationSeconds ?? undefined}
      data-page-depth={metrics?.pageDepth ?? undefined}
      data-state={metrics ? "ready" : "missing"}
    >
      <div><span>{label}</span><strong>{metrics ? value(metrics.visits) : "—"}</strong></div>
      <span className="site-seo-breakdown-track" aria-hidden="true">{metrics ? <span style={{ width: `${metrics.visits / maxVisits * 100}%` }} /> : null}</span>
      <small>{metrics ? `визиты · просмотры ${value(metrics.pageviews)}` : missingCopy}</small>
    </li>)}
  </ol>;
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
  const searchEngines = overviewSearchEngines(model.metrika?.searchEngines ?? []);
  const hasSearchEngineRows = searchEngines.some((engine) => engine.metrics !== null);
  const channelsState = breakdownState(channels, trafficState);
  const searchEnginesState = hasSearchEngineRows ? metrikaState : metrikaState === "complete_empty" ? "complete_empty" : "missing";

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
        <OverviewPanel title="Поисковые системы" subtitle="Поисковые визиты · Россия" source="Метрика" state={showMetrika ? searchEnginesState : "missing"} statusText={showMetrika && !hasSearchEngineRows ? "нет строк Google/Яндекс за период" : showMetrika ? undefined : "источник отключён"}>
          <SearchEngineGrid engines={searchEngines} missingCopy={showMetrika ? "нет строк за период" : "источник отключён"} />
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
