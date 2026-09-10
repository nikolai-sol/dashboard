import type { DashboardReadModel } from "../lib/read-model.ts";
export function Search({ id, model, showGsc }: Readonly<{ id: string; model: DashboardReadModel; showGsc: boolean }>) {
  if (!showGsc) return <section id={id}><h2>Поиск и индексация</h2><p>Данные Яндекс: {model.datasets.yandex_webmaster?.state ?? "missing"}</p></section>;
  return <section id={id}><h2>Поиск и индексация</h2><p>GSC: {model.gsc.meta.state}; клики: {model.gsc.summary?.clicks ?? "нет данных"}; показы: {model.gsc.summary?.impressions ?? "нет данных"}</p><p>Индексация: {model.indexing.state}</p>
    <h3>Динамика</h3><table><tbody>{model.gsc.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody></table>
    <h3>Разрезы</h3><table><tbody>{model.gsc.dimensions.map((row) => <tr key={`${row.dimension}:${row.value}`}><th>{row.dimension}</th><td>{row.value}</td><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody></table>
  </section>;
}
