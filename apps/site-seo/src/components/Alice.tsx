import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { AliceCanonicalData } from "../lib/db.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

export function Alice({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: AliceCanonicalData | null }>) {
  const state = meta?.state ?? "missing";

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="alice.summary" title="AI-видимость" subtitle={meta?.period ? `${meta.period.from} — ${meta.period.to}` : "Месячная выгрузка Яндекс Алисы"} state={state}>
        <KpiStrip>
          <Kpi label="Официальный SOV" value={data?.officialSovPct == null ? "—" : `${data.officialSovPct}%`} />
          <Kpi label="Присутствие в выборке" value={data?.samplePresencePct == null ? "—" : `${data.samplePresencePct}%`} />
          <Kpi label="Состояние" value={<StatusBadge state={state} />} />
        </KpiStrip>
        {!data ? <EmptyNotice>Опубликованная выгрузка AI-видимости за выбранный месяц отсутствует.</EmptyNotice> : null}
      </Panel>

      <Panel panelId="alice.competitors" title="Конкуренты и источники" subtitle="Домены из опубликованной выгрузки" state={state}>
        <div className="site-seo-two-column-grid">
          <div><h3>Конкуренты</h3>{data?.competitors.length ? <ul className="site-seo-plain-list">{data.competitors.map((competitor) => <li key={competitor}>{competitor}</li>)}</ul> : <EmptyNotice>Конкуренты не опубликованы.</EmptyNotice>}</div>
          <div><h3>Источники ответов</h3>{data?.sources.length ? <ul className="site-seo-plain-list">{data.sources.map((source) => <li key={source}>{source}</li>)}</ul> : <EmptyNotice>Источники ответов не опубликованы.</EmptyNotice>}</div>
        </div>
      </Panel>

      <Panel panelId="alice.queries" title="Запросы" subtitle="Факты присутствия портала в ответах" state={state}>
        <TableFrame label="Запросы AI-видимости">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Запрос</th><th>Портал</th><th>Позиция</th><th>URL</th><th>Источники</th></tr></thead>
            <tbody>{data?.queries.length ? data.queries.map((query) => <tr key={query.query}><th scope="row" className="site-seo-wrap-cell">{query.query}</th><td>{query.portalPresent ? "Есть" : "Нет"}</td><td>{query.portalPosition ?? "—"}</td><td className="site-seo-url-cell">{query.portalUrl ?? "URL не опубликован"}</td><td className="site-seo-wrap-cell">{query.sources.map((source) => `${source.rank}. ${source.domain}`).join("; ") || "Источники не опубликованы"}</td></tr>) : <tr><td colSpan={5} className="site-seo-empty-row">Нет опубликованных строк запросов за выбранный месяц.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
