import type { DashboardReadModel } from "../lib/read-model.ts";
import type { PeriodSelection } from "../lib/period-selection.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

export function Traffic({ id, model, selection }: Readonly<{ id: string; model: DashboardReadModel; selection: PeriodSelection }>) {
  const data = model.metrika;
  const meta = data ?? model.datasets.yandex_metrika;
  const state = meta?.state ?? "missing";
  const comparison = model.trafficComparison.yandex_metrika;

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="traffic.summary" title="Посещаемость" subtitle={meta?.period ? `${meta.period.from} — ${meta.period.to}` : "Выбранная неделя"} state={state}>
        <KpiStrip>
          <Kpi label="Визиты" value={data?.summary?.visits ?? "—"} />
          <Kpi label="Просмотры" value={data?.summary?.pageviews ?? "—"} />
          <Kpi label="Состояние" value={<StatusBadge state={state} />} />
        </KpiStrip>
        {!data?.summary ? <EmptyNotice>Итоги посещаемости за выбранную неделю не опубликованы.</EmptyNotice> : null}
        {selection.traffic.comparison && comparison && "kind" in comparison && comparison.kind === "metrika" ? (
          <p className="site-seo-panel-note">Сравнение {selection.traffic.comparison.key}: визиты {comparison.summary?.visits ?? "нет данных"}; просмотры {comparison.summary?.pageviews ?? "нет данных"}</p>
        ) : selection.traffic.comparison ? <EmptyNotice>Сравнение за {selection.traffic.comparison.key} не опубликовано.</EmptyNotice> : null}
      </Panel>

      <Panel panelId="traffic.trend" title="Динамика" subtitle="Данные по дням; пользователи не суммируются за период" state={state}>
        <TableFrame label="Динамика посещаемости">
          <table className="site-seo-table">
            <thead><tr><th>Дата</th><th>Визиты</th><th>Просмотры</th><th>Пользователи за день</th></tr></thead>
            <tbody>{data?.daily.length ? data.daily.map((row) => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.visits}</td><td>{row.pageviews}</td><td>Пользователи за день: {row.users ?? "неизвестно"}</td></tr>) : <tr><td colSpan={4} className="site-seo-empty-row">Нет опубликованных дневных строк за выбранную неделю.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>

      <Panel panelId="traffic.pages" title="Страницы" subtitle="Канонические строки Метрики" state={state}>
        <TableFrame label="Страницы">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Страница</th><th>Визиты</th><th>Просмотры</th></tr></thead>
            <tbody>{data?.topPages.length ? data.topPages.map((row) => <tr key={row.page}><th scope="row" className="site-seo-url-cell">{row.page}</th><td>{row.visits}</td><td>{row.pageviews}</td></tr>) : <tr><td colSpan={3} className="site-seo-empty-row">Нет опубликованных строк страниц за выбранную неделю.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
