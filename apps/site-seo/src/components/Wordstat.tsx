import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { WordstatCanonicalData } from "../lib/db.ts";
import { Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

function wordstatStatus(meta?: DatasetMeta): string {
  if (!meta || meta.state === "missing") return "Источник не настроен или сбор ещё не выполнен";
  if (meta.state === "failed") return "Последний сбор завершился ошибкой";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  return "Данные доступны";
}

export function Wordstat({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: WordstatCanonicalData | null }>) {
  const state = meta?.state ?? "missing";

  return (
    <div id={id}>
      <Panel title="Wordstat" state={state}>
        <p><StatusBadge state={state} /> {wordstatStatus(meta)}</p>
        {data?.period ? <p>Окно snapshot: {data.period.from} — {data.period.to} (не недельный итог)</p> : null}
        {data?.demand != null ? <p>Спрос: {data.demand}</p> : null}
        <TableFrame label="Запросы Wordstat">
          <table className="site-seo-table">
            <thead><tr><th>Запрос</th><th>Тип</th><th>Частотность</th><th>Окно</th></tr></thead>
            <tbody>{data?.queries.map((row) => <tr key={`${row.kind}:${row.query}`}><th>{row.query}</th><td>{row.kind}</td><td>{row.count}</td><td>{row.window.from} — {row.window.to}</td></tr>)}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
