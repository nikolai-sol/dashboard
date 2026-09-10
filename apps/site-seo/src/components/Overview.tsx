import type { DashboardReadModel } from "../lib/read-model.ts";
import { Kpi, KpiStrip, Panel, StatusBadge } from "./DashboardPrimitives.tsx";

export function Overview({ id, model, showGsc }: Readonly<{ id: string; model: DashboardReadModel; showGsc: boolean }>) {
  return (
    <div id={id}>
      <Panel title="Обзор">
        <KpiStrip>
          {showGsc ? <Kpi label="Google Search Console" value={<StatusBadge state={model.gsc.meta.state} />} /> : null}
          {model.metrika ? <Kpi label="Метрика" value={<StatusBadge state={model.metrika.state} />} detail={`визиты: ${model.metrika.summary?.visits ?? "нет данных"}; просмотры: ${model.metrika.summary?.pageviews ?? "нет данных"}`} /> : null}
          {model.webmaster ? <Kpi label="Webmaster" value={<StatusBadge state={model.webmaster.state} />} detail={`клики: ${model.webmaster.summary?.clicks ?? "нет данных"}; показы: ${model.webmaster.summary?.impressions ?? "нет данных"}`} /> : null}
        </KpiStrip>
      </Panel>
    </div>
  );
}
