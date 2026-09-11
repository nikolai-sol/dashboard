import type { SiteProfile } from "@reportingdash/site-seo-contract";
import type { WebmasterCanonicalMetrics } from "../lib/db.ts";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, TableFrame } from "./DashboardPrimitives.tsx";

const number = new Intl.NumberFormat("ru-RU");

function metric(value: number | null | undefined, maximumFractionDigits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${metric(value)}%`;
}

type SectionAggregate = Readonly<{
  id: string;
  label: string;
  metrics: WebmasterCanonicalMetrics | null;
}>;

function pathname(value: string): string {
  try { return new URL(value, "https://site-seo.local").pathname; }
  catch { return value.split(/[?#]/, 1)[0] ?? value; }
}

export function aggregateWebmasterSections(
  sections: NonNullable<SiteProfile["seoSections"]>,
  pages: NonNullable<DashboardReadModel["webmaster"]>["topPages"],
): SectionAggregate[] {
  const prefixes = sections.flatMap((section) => section.pathPrefixes.map((prefix) => ({ section, prefix })))
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const grouped = new Map<string, typeof pages>();
  for (const page of pages) {
    const path = pathname(page.page);
    const match = prefixes.find(({ prefix }) => path === prefix.slice(0, -1) || path.startsWith(prefix));
    if (match) grouped.set(match.section.id, [...(grouped.get(match.section.id) ?? []), page]);
  }
  return sections.map((section) => {
    const rows = grouped.get(section.id) ?? [];
    if (rows.length === 0) return { id: section.id, label: section.label, metrics: null };
    const clicks = rows.reduce((sum, row) => sum + row.metrics.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.metrics.impressions, 0);
    const positioned = rows.filter((row) => row.metrics.averagePosition !== null && (row.metrics.positionedImpressions ?? row.metrics.impressions) > 0);
    const positionedImpressions = positioned.reduce((sum, row) => sum + (row.metrics.positionedImpressions ?? row.metrics.impressions), 0);
    return {
      id: section.id,
      label: section.label,
      metrics: {
        clicks,
        impressions,
        ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
        averagePosition: positionedImpressions > 0
          ? positioned.reduce((sum, row) => sum + row.metrics.averagePosition! * (row.metrics.positionedImpressions ?? row.metrics.impressions), 0) / positionedImpressions
          : null,
        positionedImpressions,
      },
    };
  });
}

type UnifiedQuery = Readonly<{
  phrase: string;
  google: WebmasterCanonicalMetrics | null;
  yandex: WebmasterCanonicalMetrics | null;
}>;

function mergeQueryMetrics(current: WebmasterCanonicalMetrics | null, next: WebmasterCanonicalMetrics): WebmasterCanonicalMetrics {
  if (!current) return next;
  const clicks = current.clicks + next.clicks;
  const impressions = current.impressions + next.impressions;
  const positioned = [current, next].filter((metrics) => metrics.averagePosition !== null && (metrics.positionedImpressions ?? metrics.impressions) > 0);
  const positionedImpressions = positioned.reduce((sum, metrics) => sum + (metrics.positionedImpressions ?? metrics.impressions), 0);
  return {
    clicks,
    impressions,
    ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
    averagePosition: positionedImpressions > 0
      ? positioned.reduce((sum, metrics) => sum + metrics.averagePosition! * (metrics.positionedImpressions ?? metrics.impressions), 0) / positionedImpressions
      : null,
    positionedImpressions,
  };
}

function unifiedQueries(model: DashboardReadModel, showGsc: boolean, showWebmaster: boolean): UnifiedQuery[] {
  const rows = new Map<string, UnifiedQuery>();
  const add = (phrase: string, source: "google" | "yandex", metrics: WebmasterCanonicalMetrics) => {
    const normalized = phrase.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
    if (!normalized) return;
    const current = rows.get(normalized) ?? { phrase: phrase.trim().replace(/\s+/g, " "), google: null, yandex: null };
    rows.set(normalized, { ...current, [source]: mergeQueryMetrics(current[source], metrics) });
  };
  if (showGsc) {
    for (const row of model.gsc.dimensions) if (row.dimension === "query") add(row.value, "google", row.metrics);
  }
  if (showWebmaster) {
    for (const row of model.webmaster?.queryFacts ?? []) add(row.query, "yandex", row.metrics);
  }
  // Server HTML intentionally renders a deterministic top 100 by maximum source impressions.
  return [...rows.values()]
    .sort((left, right) => Math.max(right.google?.impressions ?? 0, right.yandex?.impressions ?? 0) - Math.max(left.google?.impressions ?? 0, left.yandex?.impressions ?? 0) || left.phrase.localeCompare(right.phrase, "ru"))
    .slice(0, 100);
}

function SourceCells({ metrics }: Readonly<{ metrics: WebmasterCanonicalMetrics | null }>) {
  return <><td>{metrics ? number.format(metrics.impressions) : "—"}</td><td>{metrics ? number.format(metrics.clicks) : "—"}</td><td>{percent(metrics?.ctrPct)}</td><td>{metric(metrics?.averagePosition)}</td></>;
}

export function Search({ id, model, profile, showGsc, showWebmaster = true }: Readonly<{
  id: string;
  model: DashboardReadModel;
  profile?: SiteProfile;
  showGsc: boolean;
  showWebmaster?: boolean;
  comparison?: DashboardReadModel["trafficComparison"]["yandex_webmaster"];
  comparisonKey?: string;
}>) {
  const sections = aggregateWebmasterSections(profile?.seoSections ?? [], showWebmaster ? model.webmaster?.topPages ?? [] : []);
  const queries = unifiedQueries(model, showGsc, showWebmaster);

  return (
    <div id={id} className="site-seo-section-stack">
      <div className="site-seo-seo-summary-grid">
        <Panel panelId="seo.alice" title="ИИ-видимость в Алисе AI">
          <KpiStrip>
            <Kpi label="Официальный SOV" value={model.alice?.officialSovPct == null ? "—" : percent(model.alice.officialSovPct)} />
            <Kpi label="Присутствие" value={model.alice?.samplePresencePct == null ? "—" : percent(model.alice.samplePresencePct)} />
          </KpiStrip>
          {!model.alice ? <EmptyNotice>Нет опубликованной выгрузки за выбранный месяц.</EmptyNotice> : null}
        </Panel>

        <Panel panelId="seo.sections" title="Позиции по разделам">
          <TableFrame label="Позиции разделов">
            <table className="site-seo-table">
              <thead><tr><th>Раздел</th><th>Клики</th><th>Показы</th><th>Позиция</th></tr></thead>
              <tbody>{sections.length ? sections.map((section) => <tr key={section.id}><th scope="row">{section.label}</th><td>{section.metrics ? number.format(section.metrics.clicks) : "—"}</td><td>{section.metrics ? number.format(section.metrics.impressions) : "—"}</td><td>{metric(section.metrics?.averagePosition)}</td></tr>) : <tr><td colSpan={4} className="site-seo-empty-row">Разделы не настроены.</td></tr>}</tbody>
            </table>
          </TableFrame>
        </Panel>
      </div>

      <Panel panelId="seo.queries" title="Запросы: Google, Яндекс и SEO OS" subtitle="Топ-100 фраз по показам в доступных поисковых источниках">
        <TableFrame label="Объединённые поисковые запросы">
          <table className="site-seo-table site-seo-table-bounded">
            <thead>
              <tr><th rowSpan={2}>Запрос</th><th colSpan={4}>Google</th><th colSpan={4}>Яндекс Вебмастер</th><th colSpan={3}>SEO OS</th></tr>
              <tr><th>Показы</th><th>Клики</th><th>CTR</th><th>Позиция</th><th>Показы</th><th>Клики</th><th>CTR</th><th>Позиция</th><th>Позиция</th><th>Дельта</th><th>Статус</th></tr>
            </thead>
            <tbody>{queries.length ? queries.map((row) => <tr key={row.phrase}><th scope="row" className="site-seo-wrap-cell">{row.phrase}</th><SourceCells metrics={row.google} /><SourceCells metrics={row.yandex} /><td>—</td><td>—</td><td>—</td></tr>) : <tr><td colSpan={12} className="site-seo-empty-row">Нет опубликованных запросов за выбранные периоды.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
