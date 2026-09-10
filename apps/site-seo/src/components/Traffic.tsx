import type { DashboardReadModel } from "../lib/read-model.ts";
import type { PeriodSelection } from "../lib/period-selection.ts";
import { Kpi, KpiStrip, Panel, TableFrame } from "./DashboardPrimitives.tsx";

export function Traffic({ id, model, selection }: Readonly<{ id: string; model: DashboardReadModel; selection: PeriodSelection }>) {
  const comparison = model.trafficComparison.yandex_metrika;

  return (
    <div id={id}>
      <Panel title="Посещаемость и страницы" subtitle={`Метрика: ${model.datasets.yandex_metrika?.state ?? "missing"}`}>
        {model.metrika?.summary ? (
          <KpiStrip>
            <Kpi label="Визиты" value={model.metrika.summary.visits} />
            <Kpi label="Просмотры" value={model.metrika.summary.pageviews} />
          </KpiStrip>
        ) : null}
        {selection.traffic.comparison && comparison && "kind" in comparison && comparison.kind === "metrika" ? (
          <p>Сравнение {selection.traffic.comparison.key}: визиты {comparison.summary?.visits ?? "нет данных"}; просмотры {comparison.summary?.pageviews ?? "нет данных"}</p>
        ) : null}
        {model.metrika ? (
          <>
            <h3>Динамика</h3>
            <TableFrame label="Динамика посещаемости">
              <table><tbody>{model.metrika.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>визиты: {row.visits}</td><td>просмотры: {row.pageviews}</td><td>Пользователи за день: {row.users ?? "неизвестно"}</td></tr>)}</tbody></table>
            </TableFrame>
            <h3>Страницы</h3>
            <TableFrame label="Страницы">
              <table><tbody>{model.metrika.topPages.map((row) => <tr key={row.page}><th>{row.page}</th><td>визиты: {row.visits}</td><td>просмотры: {row.pageviews}</td></tr>)}</tbody></table>
            </TableFrame>
          </>
        ) : null}
      </Panel>
    </div>
  );
}
