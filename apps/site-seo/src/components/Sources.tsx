import type { SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "../lib/read-model.ts";
import type { DatasetMeta } from "@reportingdash/site-seo-contract";
export function sourceStatusLabel(meta: DatasetMeta | undefined): string {
  if (!meta || meta.state === "missing") return "Нужна выгрузка";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  if (meta.state === "failed") return "Последняя загрузка с ошибкой";
  const period = meta.period ? `${meta.period.from} — ${meta.period.to}` : "период не указан";
  return meta.collectionMode === "manual" ? `Загружено: ${period}` : `${meta.freshness}: ${period}`;
}
export function Sources({ id, profile, model }: Readonly<{ id: string; profile: SiteProfile; model: DashboardReadModel }>) { return <section id={id}><h2>Источники</h2><ul>{profile.sources.map((source) => <li key={source.sourceKey}>{source.sourceKey}: {source.mode === "disabled" ? "отключён" : sourceStatusLabel(model.datasets[source.sourceKey])}</li>)}</ul></section>; }
