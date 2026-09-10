import type { DashboardReadModel } from "../lib/read-model.ts";

export function Overview({ id, model, showGsc }: Readonly<{ id: string; model: DashboardReadModel; showGsc: boolean }>) {
  return <section id={id}><h2>Обзор</h2>
    {showGsc && <p>Google Search Console: {model.gsc.meta.state}</p>}
    {model.metrika && <p>Метрика: {model.metrika.state}; визиты: {model.metrika.summary?.visits ?? "нет данных"}; просмотры: {model.metrika.summary?.pageviews ?? "нет данных"}</p>}
    {model.webmaster && <p>Webmaster: {model.webmaster.state}; клики: {model.webmaster.summary?.clicks ?? "нет данных"}; показы: {model.webmaster.summary?.impressions ?? "нет данных"}</p>}
  </section>;
}
