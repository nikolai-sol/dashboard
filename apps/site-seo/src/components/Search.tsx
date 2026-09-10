import type { DashboardReadModel } from "../lib/read-model.ts";

export function Search({ id, model, showGsc }: Readonly<{ id: string; model: DashboardReadModel; showGsc: boolean }>) {
  return <section id={id}><h2>Поиск и индексация</h2>
    {showGsc && <><p>GSC: {model.gsc.meta.state}; клики: {model.gsc.summary?.clicks ?? "нет данных"}; показы: {model.gsc.summary?.impressions ?? "нет данных"}</p><p>Индексация: {model.indexing.state}</p>
      <h3>Динамика GSC</h3><table><tbody>{model.gsc.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody></table>
      <h3>Разрезы GSC</h3><table><tbody>{model.gsc.dimensions.map((row) => <tr key={`${row.dimension}:${row.value}`}><th>{row.dimension}</th><td>{row.value}</td><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody></table></>}
    {model.webmaster && <><p>Webmaster: {model.webmaster.state}; клики: {model.webmaster.summary?.clicks ?? "нет данных"}; показы: {model.webmaster.summary?.impressions ?? "нет данных"}</p>
      <h3>Динамика Webmaster</h3><table><tbody>{model.webmaster.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>клики: {row.metrics.clicks}</td><td>показы: {row.metrics.impressions}</td><td>CTR: {row.metrics.ctrPct ?? "неизвестно"}</td><td>позиция: {row.metrics.averagePosition ?? "неизвестно"}</td></tr>)}</tbody></table>
      <h3>Страницы Webmaster</h3><table><tbody>{model.webmaster.topPages.map((row) => <tr key={row.page}><th>{row.page}</th><td>клики: {row.metrics.clicks}</td><td>показы: {row.metrics.impressions}</td></tr>)}</tbody></table></>}
    {!showGsc && !model.webmaster && <p>Данные Яндекс: {model.datasets.yandex_webmaster?.state ?? "missing"}</p>}
  </section>;
}
