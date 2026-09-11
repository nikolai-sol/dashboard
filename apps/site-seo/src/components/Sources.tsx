import type { DatasetMeta, SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { Kpi, KpiStrip, Panel, StatusBadge } from "./DashboardPrimitives.tsx";

const sourceLabels: Readonly<Record<string, string>> = {
  yandex_metrika: "Яндекс Метрика",
  yandex_webmaster: "Яндекс Вебмастер",
  google_search_console: "Google Search Console",
  yandex_wordstat: "Яндекс Wordstat",
  yandex_webmaster_alice_manual: "Яндекс Алиса",
  seo_os: "SEO OS",
};

const modeLabels: Readonly<Record<string, string>> = {
  automated: "Автоматический сбор",
  manual: "Ручная загрузка",
  disabled: "Отключён",
};

export function sourceStatusLabel(meta: DatasetMeta | undefined): string {
  if (!meta || meta.state === "missing") return "Нужна выгрузка";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  if (meta.state === "failed") return "Последняя загрузка с ошибкой";
  const period = meta.period ? `${meta.period.from} — ${meta.period.to}` : "период не указан";
  return meta.collectionMode === "manual" ? `Загружено: ${period}` : `${meta.freshness === "current" ? "Актуально" : meta.freshness === "delayed" ? "С задержкой" : "Актуальность неизвестна"}: ${period}`;
}

export function Sources({ id, profile, model }: Readonly<{ id: string; profile: SiteProfile; model: DashboardReadModel }>) {
  const automated = profile.sources.filter((source) => source.mode === "automated").length;
  const manual = profile.sources.filter((source) => source.mode === "manual").length;
  const disabled = profile.sources.filter((source) => source.mode === "disabled").length;

  return (
    <div id={id} className="site-seo-section-stack">
      <Panel panelId="sources.summary" title="Источники" subtitle="Конфигурация источников сайта">
        <KpiStrip>
          <Kpi label="Всего" value={profile.sources.length} />
          <Kpi label="Автоматически" value={automated} />
          <Kpi label="Вручную" value={manual} />
          <Kpi label="Отключено" value={disabled} />
        </KpiStrip>
      </Panel>

      <Panel panelId="sources.list" title="Состояние источников" subtitle="Каждый источник оценивается отдельно">
        <div className="site-seo-source-card-grid">{profile.sources.map((source) => {
          const meta = source.mode === "disabled" ? undefined : model.datasets[source.sourceKey];
          const state = source.mode === "disabled" ? "disabled" : meta?.state ?? "missing";
          const label = source.mode === "disabled" ? "Источник отключён" : sourceStatusLabel(meta);
          return <article className="site-seo-source-card" key={source.sourceKey} data-state={state}>
            <div className="site-seo-source-card-heading"><h3>{sourceLabels[source.sourceKey] ?? source.sourceKey}</h3><StatusBadge state={state} /></div>
            <p>{modeLabels[source.mode] ?? source.mode}</p>
            <p>{label}</p>
          </article>;
        })}</div>
      </Panel>
    </div>
  );
}
