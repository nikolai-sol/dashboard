import type { DatasetMeta, SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { Panel, StatusBadge } from "./DashboardPrimitives.tsx";

export function sourceStatusLabel(meta: DatasetMeta | undefined): string {
  if (!meta || meta.state === "missing") return "Нужна выгрузка";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  if (meta.state === "failed") return "Последняя загрузка с ошибкой";
  const period = meta.period ? `${meta.period.from} — ${meta.period.to}` : "период не указан";
  return meta.collectionMode === "manual" ? `Загружено: ${period}` : `${meta.freshness}: ${period}`;
}

export function Sources({ id, profile, model }: Readonly<{ id: string; profile: SiteProfile; model: DashboardReadModel }>) {
  return (
    <div id={id}>
      <Panel title="Источники">
        <ul>{profile.sources.map((source) => {
          const state = source.mode === "disabled" ? "disabled" : model.datasets[source.sourceKey]?.state ?? "missing";
          const label = source.mode === "disabled" ? "отключён" : sourceStatusLabel(model.datasets[source.sourceKey]);
          return <li key={source.sourceKey}>{source.sourceKey}: <StatusBadge state={state} /> {label}</li>;
        })}</ul>
      </Panel>
    </div>
  );
}
