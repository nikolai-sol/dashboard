import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { WordstatCanonicalData } from "../lib/db.ts";
import { Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

function wordstatStatus(meta: DatasetMeta | undefined, hasPublishedSnapshot: boolean): string {
  if (!meta || meta.state === "missing") return "Источник не настроен или сбор ещё не выполнен";
  if (meta.latestAttempt === "failed" && meta.state !== "failed") return hasPublishedSnapshot
    ? "Последняя попытка сбора завершилась ошибкой; показаны ранее опубликованные данные"
    : "Последняя попытка сбора завершилась ошибкой; опубликованные данные недоступны";
  if (meta.state === "failed") return "Последний сбор завершился ошибкой";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  return "Данные доступны";
}

function queryKindLabel(kind: string): string {
  return kind === "popular" ? "Популярный запрос" : kind;
}

function lastSuccessfulCollection(meta: DatasetMeta | undefined, data: WordstatCanonicalData | null): string {
  return data?.snapshotPeriod && meta?.loadedAt
    ? `Последний успешный сбор: ${meta.loadedAt}`
    : "Последний успешный сбор пока не подтверждён";
}

function currentQueriesEmpty(state: DatasetMeta["state"]): string {
  if (state === "failed") return "Текущие запросы Wordstat недоступны: последний сбор завершился ошибкой.";
  if (state === "complete_empty") return "Сбор завершился успешно, но текущих запросов нет.";
  return "Текущие запросы Wordstat пока не опубликованы.";
}

export function Wordstat({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: WordstatCanonicalData | null }>) {
  const state = meta?.state ?? "missing";
  const snapshotPeriod = data?.snapshotPeriod;
  const snapshotLabel = snapshotPeriod
    ? `Последние 30 дней · ${snapshotPeriod.from} — ${snapshotPeriod.to}`
    : "Период текущих запросов пока не подтверждён";

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel
        panelId="wordstat.summary"
        title="Где есть медицинский спрос, что уже получает MedRoche и что стоит улучшить"
        subtitle="Wordstat показывает спрос, а не визиты, показы или долю сайта"
        state={state}
      >
        <KpiStrip>
          <Kpi label="Фактический период snapshot" value={snapshotLabel} />
          <Kpi label="Состояние" value={<StatusBadge state={state} />} detail={`${wordstatStatus(meta, Boolean(snapshotPeriod))}. ${lastSuccessfulCollection(meta, data)}`} />
        </KpiStrip>
      </Panel>

      <Panel panelId="wordstat.queries" title="Текущие запросы Wordstat" subtitle={snapshotPeriod ? `Rolling-окно ${snapshotPeriod.from} — ${snapshotPeriod.to}` : "Фактическое rolling-окно пока не подтверждено"} state={state}>
        <p>Частотность показана отдельно для каждого запроса. Частотности пересекающихся запросов нельзя складывать.</p>
        <TableFrame label="Запросы Wordstat">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Запрос</th><th>Тип</th><th>Частотность</th><th>Окно</th></tr></thead>
            <tbody>{data?.queries.length ? data.queries.map((row) => <tr key={`${row.kind}:${row.query}`}><th scope="row" className="site-seo-wrap-cell">{row.query}</th><td>{queryKindLabel(row.kind)}</td><td>{row.count}</td><td>{row.window.from} — {row.window.to}</td></tr>) : <tr><td colSpan={4} className="site-seo-empty-row">{currentQueriesEmpty(state)}</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
