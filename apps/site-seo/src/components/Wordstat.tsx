import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { WordstatCanonicalData } from "../lib/db.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, StatusBadge, TableFrame } from "./DashboardPrimitives.tsx";

function wordstatStatus(meta?: DatasetMeta): string {
  if (!meta || meta.state === "missing") return "Источник не настроен или сбор ещё не выполнен";
  if (meta.state === "failed") return "Последний сбор завершился ошибкой";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  return "Данные доступны";
}

function queryKindLabel(kind: string): string {
  return kind === "popular" ? "Популярный запрос" : kind;
}

export function Wordstat({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: WordstatCanonicalData | null }>) {
  const state = meta?.state ?? "missing";
  const selectedPeriod = data?.period ?? meta?.period;
  const snapshotPeriod = data?.snapshotPeriod;

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="wordstat.summary" title="Wordstat" subtitle="Спрос за выбранную ISO-неделю" state={state}>
        <KpiStrip>
          <Kpi label="Спрос" value={data?.demand ?? "—"} detail={selectedPeriod ? `${selectedPeriod.from} — ${selectedPeriod.to}` : "Период не опубликован"} />
          <Kpi label="Состояние" value={<StatusBadge state={state} />} detail={wordstatStatus(meta)} />
        </KpiStrip>
        {data?.demand == null ? <EmptyNotice>Недельный спрос не опубликован.</EmptyNotice> : null}
      </Panel>

      <Panel panelId="wordstat.queries" title="Популярные запросы" subtitle={snapshotPeriod ? `Rolling-окно ${snapshotPeriod.from} — ${snapshotPeriod.to}` : "Независимое rolling-окно snapshot"} state={state}>
        <TableFrame label="Запросы Wordstat">
          <table className="site-seo-table site-seo-table-bounded">
            <thead><tr><th>Запрос</th><th>Тип</th><th>Частотность</th><th>Окно</th></tr></thead>
            <tbody>{data?.queries.length ? data.queries.map((row) => <tr key={`${row.kind}:${row.query}`}><th scope="row" className="site-seo-wrap-cell">{row.query}</th><td>{queryKindLabel(row.kind)}</td><td>{row.count}</td><td>{row.window.from} — {row.window.to}</td></tr>) : <tr><td colSpan={4} className="site-seo-empty-row">Нет опубликованных запросов в последнем snapshot.</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}
