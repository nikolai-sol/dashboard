import type { DashboardReadModel } from "../lib/read-model.ts";
import { datasetStateLabel, EmptyNotice, Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

type WebmasterComparison = DashboardReadModel["trafficComparison"]["yandex_webmaster"];

function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function decimal(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

const dimensionLabels: Readonly<Record<string, string>> = {
  query: "Запрос",
  country: "Страна",
  device: "Устройство",
  appearance: "Вид в поиске",
};

function emptySourceCopy(source: string, state: string, subject: string): string {
  if (state === "disabled") return `Источник ${source} отключён для этого сайта.`;
  if (state === "failed") return `${subject}: последний сбор завершился ошибкой.`;
  if (state === "partial") return `${subject}: опубликованные данные неполные.`;
  if (state === "complete_empty") return `${subject}: сбор завершён, строк нет.`;
  return `${subject}: данные не опубликованы.`;
}

export function Search({ id, model, showGsc, showWebmaster = true, comparison, comparisonKey }: Readonly<{
  id: string;
  model: DashboardReadModel;
  showGsc: boolean;
  showWebmaster?: boolean;
  comparison?: WebmasterComparison;
  comparisonKey?: string;
}>) {
  const gscState = showGsc ? model.gsc.meta.state : "disabled";
  const webmasterState = showWebmaster ? model.webmaster?.state ?? model.datasets.yandex_webmaster?.state ?? "missing" : "disabled";
  const indexingState = showGsc ? model.indexing.state : "disabled";
  const gscPages = showGsc ? model.gsc.dimensions.filter((row) => row.dimension === "page") : [];
  const gscDimensions = showGsc ? model.gsc.dimensions.filter((row) => row.dimension !== "page") : [];
  const webmasterPages = showWebmaster ? model.webmaster?.topPages ?? [] : [];

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="search.summary" title="Поиск и индексация" subtitle="Канонические данные Google и Яндекса">
        <KpiStrip>
          {showGsc ? <Kpi label="Google" value={<StatusBadge state={gscState} />} detail={model.gsc.meta.period ? `${model.gsc.meta.period.from} — ${model.gsc.meta.period.to}` : "Период не опубликован"} /> : null}
          {showWebmaster ? <Kpi label="Яндекс" value={<StatusBadge state={webmasterState} />} detail={model.webmaster?.period ? `${model.webmaster.period.from} — ${model.webmaster.period.to}` : "Период не опубликован"} /> : null}
          <Kpi label="Индексация" value={<StatusBadge state={indexingState} />} detail={showGsc ? datasetStateLabel(indexingState) : "Источник GSC отключён"} />
        </KpiStrip>
      </Panel>

      <Panel panelId="search.gsc" title="Динамика GSC" subtitle={showGsc && model.gsc.meta.period ? `${model.gsc.meta.period.from} — ${model.gsc.meta.period.to}` : showGsc ? "Период не опубликован" : "Источник отключён"} state={gscState}>
        {showGsc ? <>
          <KpiStrip>
            <Kpi label="Клики" value={model.gsc.summary?.clicks ?? "—"} />
            <Kpi label="Показы" value={model.gsc.summary?.impressions ?? "—"} />
            <Kpi label="CTR" value={percent(model.gsc.summary?.ctrPct)} />
            <Kpi label="Средняя позиция" value={decimal(model.gsc.summary?.averagePosition)} />
            <Kpi label="Состояние" value={<StatusBadge state={gscState} />} />
          </KpiStrip>
          {!model.gsc.summary ? <EmptyNotice>{emptySourceCopy("GSC", gscState, "Итоги GSC за выбранный период")}</EmptyNotice> : null}
          <TableFrame label="Динамика GSC">
            <table className="site-seo-table">
              <thead><tr><th>Дата</th><th>Клики</th><th>Показы</th></tr></thead>
              <tbody>{model.gsc.daily.length ? model.gsc.daily.map((row) => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>) : <tr><td colSpan={3} className="site-seo-empty-row">Нет опубликованных дневных строк GSC за выбранный период.</td></tr>}</tbody>
            </table>
          </TableFrame>
          <TableFrame label="Разрезы GSC">
            <table className="site-seo-table site-seo-table-bounded">
              <thead><tr><th>Разрез</th><th>Значение</th><th>Клики</th><th>Показы</th><th>CTR</th><th>Позиция</th></tr></thead>
              <tbody>{gscDimensions.length ? gscDimensions.map((row) => <tr key={`${row.dimension}:${row.value}`}><th scope="row">{dimensionLabels[row.dimension] ?? row.dimension}</th><td className="site-seo-wrap-cell">{row.value}</td><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td><td>{percent(row.metrics.ctrPct)}</td><td>{decimal(row.metrics.averagePosition)}</td></tr>) : <tr><td colSpan={6} className="site-seo-empty-row">Нет опубликованных строк разрезов GSC за выбранный период.</td></tr>}</tbody>
            </table>
          </TableFrame>
        </> : <EmptyNotice>{emptySourceCopy("Google Search Console", gscState, "Данные GSC")}</EmptyNotice>}
      </Panel>

      <Panel panelId="search.webmaster" title="Динамика Webmaster" subtitle={model.webmaster?.period ? `${model.webmaster.period.from} — ${model.webmaster.period.to}` : showWebmaster ? "Период не опубликован" : "Источник отключён"} state={webmasterState}>
        {showWebmaster ? <>
          <KpiStrip>
            <Kpi label="Клики" value={model.webmaster?.summary?.clicks ?? "—"} />
            <Kpi label="Показы" value={model.webmaster?.summary?.impressions ?? "—"} />
            <Kpi label="CTR" value={percent(model.webmaster?.summary?.ctrPct)} />
            <Kpi label="Средняя позиция" value={decimal(model.webmaster?.summary?.averagePosition)} />
            <Kpi label="Состояние" value={<StatusBadge state={webmasterState} />} />
          </KpiStrip>
          {model.webmaster ? <p className="site-seo-panel-note">Webmaster: {model.webmaster.state}; клики: {model.webmaster.summary?.clicks ?? "нет данных"}; показы: {model.webmaster.summary?.impressions ?? "нет данных"}. {datasetStateLabel(webmasterState)}.</p> : <EmptyNotice>{emptySourceCopy("Яндекс Вебмастер", webmasterState, "Итоги Webmaster за выбранную неделю")}</EmptyNotice>}
          {comparisonKey && comparison && "kind" in comparison && comparison.kind === "webmaster" ? <p className="site-seo-panel-note">Сравнение Webmaster {comparisonKey}: клики {comparison.summary?.clicks ?? "нет данных"}; показы {comparison.summary?.impressions ?? "нет данных"}</p> : null}
          <TableFrame label="Динамика Webmaster">
            <table className="site-seo-table">
              <thead><tr><th>Дата</th><th>Клики</th><th>Показы</th><th>CTR</th><th>Позиция</th></tr></thead>
              <tbody>{model.webmaster?.daily.length ? model.webmaster.daily.map((row) => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td><td>{percent(row.metrics.ctrPct)}</td><td>{decimal(row.metrics.averagePosition)}</td></tr>) : <tr><td colSpan={5} className="site-seo-empty-row">Нет опубликованных дневных строк Webmaster за выбранную неделю.</td></tr>}</tbody>
            </table>
          </TableFrame>
        </> : <EmptyNotice>{emptySourceCopy("Яндекс Вебмастер", webmasterState, "Данные Webmaster")}</EmptyNotice>}
      </Panel>

      <Panel panelId="search.pages" title="Страницы" subtitle="Страницы из доступных поисковых источников">
        <TableFrame label="Страницы поиска">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Источник</th><th>Страница</th><th>Клики</th><th>Показы</th></tr></thead>
            <tbody>{gscPages.length || webmasterPages.length ? <>
              {gscPages.map((row) => <tr key={`gsc:${row.value}`}><td>Google</td><th scope="row" className="site-seo-url-cell">{row.value}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}
              {webmasterPages.map((row) => <tr key={`webmaster:${row.page}`}><td>Яндекс</td><th scope="row" className="site-seo-url-cell">{row.page}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}
            </> : <tr><td colSpan={4} className="site-seo-empty-row">Нет опубликованных строк страниц за выбранные периоды.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
