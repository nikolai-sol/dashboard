import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { SeoOsCanonicalData } from "../lib/db.ts";
import { Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

export function SeoOs({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: SeoOsCanonicalData | null }>) {
  const stateCopy = meta?.state === "missing" ? "Нужна опубликованная выгрузка" : meta?.state === "partial" ? "Сигналы опубликованы с ограничениями" : "Сигналы доступны";

  return (
    <div id={id}>
      <Panel title="SEO OS" state={meta?.state}>
        <p>{meta ? <StatusBadge state={meta.state} /> : null} {stateCopy}</p>
        <TableFrame label="Рекомендации SEO OS">
          <table className="site-seo-table">
            <thead><tr><th>Рекомендация</th><th>Действие</th><th>Страница</th><th>Происхождение</th><th>Статус</th></tr></thead>
            <tbody>{data?.recommendations.map((row, index) => <tr key={`${row.topic ?? row.kind ?? "recommendation"}:${index}`}><th>{row.topic ?? row.kind ?? "Рекомендация"}</th><td>{row.action ?? "нет действия"}</td><td>{row.pageUrl ?? "нет страницы"}</td><td>rule: {row.ruleVersion ?? "нет"}; периоды: {row.sourcePeriods.join(", ") || "нет"}; sources: {row.sourceIds.join(", ") || "нет"}</td><td>{row.publicationStatus ?? "нет статуса"}</td></tr>)}</tbody>
          </table>
        </TableFrame>
        <ul>{data?.tasks.map((task) => <li key={task.id}>{task.id}: {task.status}</li>)}</ul>
      </Panel>
    </div>
  );
}
