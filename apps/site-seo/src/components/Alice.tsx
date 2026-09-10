import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { AliceCanonicalData } from "../lib/db.ts";
import { Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

export function Alice({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: AliceCanonicalData | null }>) {
  const stateCopy = meta?.state === "missing" ? "Нужна выгрузка" : meta?.state ?? "нет данных";

  return (
    <div id={id}>
      <Panel title="AI-видимость и конкуренты" state={meta?.state}>
        <p>{meta ? <StatusBadge state={meta.state} /> : null} {stateCopy}</p>
        {data ? (
          <>
            <p>Официальный SOV: {data.officialSovPct ?? "нет данных"}; sample: {data.samplePresencePct ?? "нет данных"}</p>
            <p>Конкуренты: {data.competitors.join(", ") || "нет данных"}</p>
            <p>Источники: {data.sources.join(", ") || "нет данных"}</p>
            <TableFrame label="Запросы AI-видимости">
              <table className="site-seo-table">
                <thead><tr><th>Запрос</th><th>Портал</th><th>Позиция</th><th>URL</th><th>Источники</th></tr></thead>
                <tbody>{data.queries.map((query) => <tr key={query.query}><th>{query.query}</th><td>портал: {query.portalPresent ? "есть" : "нет"}</td><td>позиция: {query.portalPosition ?? "нет"}</td><td>{query.portalUrl ?? "нет URL"}</td><td>{query.sources.map((source) => `${source.rank}. ${source.domain}`).join("; ") || "нет источников"}</td></tr>)}</tbody>
              </table>
            </TableFrame>
          </>
        ) : null}
      </Panel>
    </div>
  );
}
