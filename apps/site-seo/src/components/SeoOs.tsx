import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { SeoOsCanonicalData } from "../lib/db.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

function stateCopy(state: DatasetMeta["state"]): string {
  if (state === "ready") return "Сигналы доступны";
  if (state === "partial") return "Сигналы опубликованы с ограничениями";
  if (state === "complete_empty") return "Сбор завершён: сигналов нет";
  if (state === "failed") return "Последний расчёт завершился ошибкой";
  return "Нужна опубликованная выгрузка";
}

export function SeoOs({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: SeoOsCanonicalData | null }>) {
  const state = meta?.state ?? "missing";

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="seo-os.summary" title="SEO OS" subtitle={meta?.period ? `${meta.period.from} — ${meta.period.to}` : "Выбранная ISO-неделя"} state={state}>
        <KpiStrip><Kpi label="Состояние" value={<StatusBadge state={state} />} detail={stateCopy(state)} /></KpiStrip>
        {data?.rows.length ? <TableFrame label="Сигналы SEO OS"><table className="site-seo-table site-seo-table-bounded"><thead><tr><th>Система</th><th>Упоминания</th><th>Цитирования</th><th>Основание</th></tr></thead><tbody>{data.rows.map((row, index) => <tr key={`${row.engine}:${index}`}><th scope="row">{row.engine}</th><td>{row.mentions}</td><td>{row.citations}</td><td className="site-seo-wrap-cell">{row.evidence ?? "Не опубликовано"}</td></tr>)}</tbody></table></TableFrame> : <EmptyNotice>Отдельные строки сигналов не опубликованы.</EmptyNotice>}
      </Panel>

      <Panel panelId="seo-os.recommendations" title="Рекомендации" subtitle="Опубликованные рекомендации и их происхождение" state={state}>
        <TableFrame label="Рекомендации SEO OS">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Рекомендация</th><th>Действие</th><th>Страница</th><th>Происхождение</th><th>Статус</th></tr></thead>
            <tbody>{data?.recommendations.length ? data.recommendations.map((row, index) => <tr key={`${row.topic ?? row.kind ?? "recommendation"}:${index}`}><th scope="row" className="site-seo-wrap-cell">{row.topic ?? row.kind ?? "Рекомендация"}</th><td className="site-seo-wrap-cell">{row.action ?? "Действие не опубликовано"}</td><td className="site-seo-url-cell">{row.pageUrl ?? "Страница не опубликована"}</td><td className="site-seo-wrap-cell">Правило: {row.ruleVersion ?? "не указано"}; периоды: {row.sourcePeriods.join(", ") || "не указаны"}; источники: {row.sourceIds.join(", ") || "не указаны"}</td><td>{row.publicationStatus ?? "Не указан"}</td></tr>) : <tr><td colSpan={5} className="site-seo-empty-row">Нет опубликованных рекомендаций за выбранную неделю.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>

      <Panel panelId="seo-os.tasks" title="Задачи" subtitle="Связанные задачи SEO OS" state={state}>
        <TableFrame label="Задачи SEO OS">
          <table className="site-seo-table"><thead><tr><th>Задача</th><th>Статус</th></tr></thead><tbody>{data?.tasks.length ? data.tasks.map((task) => <tr key={task.id}><th scope="row">{task.id}</th><td>{task.status}</td></tr>) : <tr><td colSpan={2} className="site-seo-empty-row">Нет опубликованных задач за выбранную неделю.</td></tr>}</tbody></table>
        </TableFrame>
      </Panel>
    </div>
  );
}
