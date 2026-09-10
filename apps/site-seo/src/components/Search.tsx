import type { DashboardReadModel } from "../lib/read-model.ts";
import { Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

export function Search({ id, model, showGsc }: Readonly<{ id: string; model: DashboardReadModel; showGsc: boolean }>) {
  return (
    <div id={id}>
      <Panel title="Поиск и индексация">
        {showGsc ? (
          <>
            <KpiStrip>
              <Kpi label="GSC" value={<StatusBadge state={model.gsc.meta.state} />} detail={`клики: ${model.gsc.summary?.clicks ?? "нет данных"}; показы: ${model.gsc.summary?.impressions ?? "нет данных"}`} />
              <Kpi label="Индексация" value={<StatusBadge state={model.indexing.state} />} />
            </KpiStrip>
            <h3>Динамика GSC</h3>
            <TableFrame label="Динамика GSC">
              <table className="site-seo-table">
                <thead><tr><th>Дата</th><th>Клики</th><th>Показы</th></tr></thead>
                <tbody>{model.gsc.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody>
              </table>
            </TableFrame>
            <h3>Разрезы GSC</h3>
            <TableFrame label="Разрезы GSC">
              <table className="site-seo-table">
                <thead><tr><th>Разрез</th><th>Значение</th><th>Клики</th><th>Показы</th></tr></thead>
                <tbody>{model.gsc.dimensions.map((row) => <tr key={`${row.dimension}:${row.value}`}><th>{row.dimension}</th><td>{row.value}</td><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody>
              </table>
            </TableFrame>
          </>
        ) : null}
        {model.webmaster ? (
          <>
            <p><StatusBadge state={model.webmaster.state} /></p>
            <p>Webmaster: {model.webmaster.state}; клики: {model.webmaster.summary?.clicks ?? "нет данных"}; показы: {model.webmaster.summary?.impressions ?? "нет данных"}</p>
            <h3>Динамика Webmaster</h3>
            <TableFrame label="Динамика Webmaster">
              <table className="site-seo-table">
                <thead><tr><th>Дата</th><th>Клики</th><th>Показы</th><th>CTR</th><th>Позиция</th></tr></thead>
                <tbody>{model.webmaster.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>клики: {row.metrics.clicks}</td><td>показы: {row.metrics.impressions}</td><td>CTR: {row.metrics.ctrPct ?? "неизвестно"}</td><td>позиция: {row.metrics.averagePosition ?? "неизвестно"}</td></tr>)}</tbody>
              </table>
            </TableFrame>
            <h3>Страницы Webmaster</h3>
            <TableFrame label="Страницы Webmaster">
              <table className="site-seo-table">
                <thead><tr><th>Страница</th><th>Клики</th><th>Показы</th></tr></thead>
                <tbody>{model.webmaster.topPages.map((row) => <tr key={row.page}><th>{row.page}</th><td>клики: {row.metrics.clicks}</td><td>показы: {row.metrics.impressions}</td></tr>)}</tbody>
              </table>
            </TableFrame>
          </>
        ) : null}
        {!showGsc && !model.webmaster ? <p>Данные Яндекс: <StatusBadge state={model.datasets.yandex_webmaster?.state ?? "missing"} /></p> : null}
      </Panel>
    </div>
  );
}
