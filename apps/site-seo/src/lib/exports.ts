import type { DatasetMeta, GscView, Period, SiteProfile } from "@reportingdash/site-seo-contract";
import type { DashboardReadModel } from "./read-model.ts";
import type { AliceCanonicalData, MetrikaCanonicalData, SeoOsCanonicalData, WebmasterCanonicalData, WordstatCanonicalData } from "./db.ts";
import type { PeriodSelection } from "./period-selection.ts";

export type ExportRow = Readonly<{ field: string; value: string }>;

export function buildExportRows(input: Readonly<{ title: string; period: Period; source: DatasetMeta }>): ExportRow[] {
  const limitation = input.source.latestAttempt === "failed" && input.source.state !== "failed"
    ? "Последняя попытка сбора завершилась ошибкой; показаны ранее опубликованные данные"
    : input.source.state === "missing"
    ? "Нужна выгрузка"
    : input.source.state === "partial"
      ? "Источник содержит неполные данные"
      : input.source.state === "complete_empty"
        ? "Подтверждённо пустой период"
        : input.source.state === "failed"
          ? "Последняя загрузка завершилась ошибкой"
          : "Нет";
  return [
    { field: "Раздел", value: input.title },
    { field: "Период от", value: input.period.from },
    { field: "Период до", value: input.period.to },
    { field: "Источник", value: input.source.sourceKey },
    { field: "Состояние", value: input.source.state },
    { field: "Ограничение", value: limitation },
    { field: "Загружено", value: input.source.loadedAt ?? "неизвестно" },
  ];
}

export function buildGscExportRows(input: Pick<GscView, "summary" | "daily" | "dimensions"> & Readonly<{ period: Period; source: DatasetMeta }>): ExportRow[] {
  const rows = buildExportRows({ title: "Google Search Console", period: input.period, source: input.source });
  if (input.summary) rows.push(
    { field: "Итоговые клики", value: String(input.summary.clicks) },
    { field: "Итоговые показы", value: String(input.summary.impressions) },
    { field: "CTR, %", value: input.summary.ctrPct === null ? "неизвестно" : String(input.summary.ctrPct) },
    { field: "Средняя позиция", value: input.summary.averagePosition === null ? "неизвестно" : String(input.summary.averagePosition) },
  );
  for (const row of input.daily) rows.push({ field: `День ${row.date}`, value: `клики ${row.metrics.clicks}; показы ${row.metrics.impressions}` });
  for (const row of input.dimensions) rows.push({ field: `${row.dimension}: ${row.value}`, value: `клики ${row.metrics.clicks}; показы ${row.metrics.impressions}` });
  return rows;
}

function buildMetrikaExportRows(input: Readonly<{ period: Period; data: MetrikaCanonicalData }>): ExportRow[] {
  const rows = buildExportRows({ title: "Яндекс Метрика", period: input.period, source: input.data });
  if (input.data.summary) rows.push(
    { field: "Визиты Metrika", value: String(input.data.summary.visits) },
    { field: "Просмотры Metrika", value: String(input.data.summary.pageviews) },
  );
  for (const row of input.data.daily) rows.push(
    { field: `День Metrika ${row.date}`, value: `визиты ${row.visits}; просмотры ${row.pageviews}` },
    { field: `Пользователи за день ${row.date}`, value: row.users === null ? "неизвестно" : String(row.users) },
  );
  for (const row of input.data.topPages) rows.push({ field: `Страница Metrika ${row.page}`, value: `визиты ${row.visits}; просмотры ${row.pageviews}` });
  return rows;
}

function buildWebmasterExportRows(input: Readonly<{ period: Period; data: WebmasterCanonicalData }>): ExportRow[] {
  const rows = buildExportRows({ title: "Яндекс Вебмастер", period: input.period, source: input.data });
  const append = (title: string, metrics: WebmasterCanonicalData["summary"]) => {
    if (!metrics) return;
    rows.push(
      { field: `Клики Webmaster${title}`, value: String(metrics.clicks) },
      { field: `Показы Webmaster${title}`, value: String(metrics.impressions) },
      { field: `CTR Webmaster${title}, %`, value: metrics.ctrPct === null ? "неизвестно" : String(metrics.ctrPct) },
      { field: `Средняя позиция Webmaster${title}`, value: metrics.averagePosition === null ? "неизвестно" : String(metrics.averagePosition) },
    );
  };
  append("", input.data.summary);
  for (const row of input.data.daily) append(` ${row.date}`, row.metrics);
  for (const row of input.data.topPages) append(` ${row.page}`, row.metrics);
  return rows;
}

function buildWordstatExportRows(input: Readonly<{ period: Period; data: WordstatCanonicalData }>): ExportRow[] {
  const rows = buildExportRows({ title: "Wordstat", period: input.data.period ?? input.period, source: input.data });
  if (input.data.snapshotPeriod) rows.push({
    field: "Окно snapshot Wordstat",
    value: `${input.data.snapshotPeriod.from} — ${input.data.snapshotPeriod.to}`,
  });
  if (input.data.demand !== null) rows.push({ field: "Спрос Wordstat", value: String(input.data.demand) });
  for (const row of input.data.queries) rows.push({
    field: `Wordstat ${row.kind}: ${row.query}`,
    value: `${row.count}; окно ${row.window.from}…${row.window.to}; snapshot ${row.window.snapshotDate}; registry ${row.window.registryVersion}; import ${row.window.importId ?? "неизвестно"}`,
  });
  return rows;
}

function buildAliceExportRows(input: Readonly<{ period: Period; data: AliceCanonicalData }>): ExportRow[] {
  const rows = buildExportRows({ title: "Алиса", period: input.period, source: input.data });
  rows.push({ field: "Официальный SOV Алиса, %", value: input.data.officialSovPct === null ? "неизвестно" : String(input.data.officialSovPct) });
  rows.push({ field: "Sample presence Алиса, %", value: input.data.samplePresencePct === null ? "неизвестно" : String(input.data.samplePresencePct) });
  for (const value of input.data.competitors) rows.push({ field: "Конкурент Алиса", value });
  for (const value of input.data.sources) rows.push({ field: "Источник Алиса", value });
  for (const query of input.data.queries) rows.push({
    field: `Запрос Алиса: ${query.query}`,
    value: `портал: ${query.portalPresent ? "есть" : "нет"}; позиция: ${query.portalPosition ?? "нет"}; URL: ${query.portalUrl ?? "нет"}; источники: ${query.sources.map((source) => `${source.rank}. ${source.domain} (${source.url})`).join("; ") || "нет"}`,
  });
  return rows;
}

function buildSeoOsExportRows(input: Readonly<{ period: Period; data: SeoOsCanonicalData }>): ExportRow[] {
  const rows = buildExportRows({ title: "SEO OS", period: input.period, source: input.data });
  for (const row of input.data.rows) rows.push({ field: `SEO OS ${row.engine}`, value: `упоминания ${row.mentions}; цитаты ${row.citations}; evidence ${row.evidence ?? "нет"}` });
  for (const recommendation of input.data.recommendations) rows.push({
    field: `Рекомендация SEO OS: ${recommendation.topic ?? recommendation.kind ?? "без темы"}`,
    value: `действие: ${recommendation.action ?? "нет"}; страница: ${recommendation.pageUrl ?? "нет"}; rule: ${recommendation.ruleVersion ?? "нет"}; периоды: ${recommendation.sourcePeriods.join(", ") || "нет"}; sources: ${recommendation.sourceIds.join(", ") || "нет"}; публикация: ${recommendation.publicationStatus ?? "нет"}`,
  });
  for (const task of input.data.tasks) rows.push({ field: `Задача SEO OS ${task.id}`, value: task.status });
  return rows;
}

export function buildDashboardExportRows(input: Readonly<{
  profile: Pick<SiteProfile, "sources">;
  selection: PeriodSelection;
  model: Pick<DashboardReadModel, "gsc" | "datasets"> & Partial<Pick<DashboardReadModel, "metrika" | "webmaster" | "wordstat" | "alice" | "seoOs" | "trafficComparison">>;
}>): ExportRow[] {
  const gscEnabled = input.profile.sources.some((source) => source.sourceKey === "google_search_console" && source.mode !== "disabled");
  const rows: ExportRow[] = gscEnabled
    ? buildGscExportRows({ ...input.model.gsc, period: input.selection.gsc, source: input.model.gsc.meta })
    : [];
  for (const source of input.profile.sources
    .filter((source) => source.mode !== "disabled" && source.sourceKey !== "google_search_console")
  ) {
    const period = source.sourceKey === "yandex_webmaster_alice_manual" ? input.selection.alice : input.selection.traffic.primary;
    if (source.sourceKey === "yandex_metrika" && input.model.metrika) rows.push(...buildMetrikaExportRows({ period, data: input.model.metrika }));
    else if (source.sourceKey === "yandex_webmaster" && input.model.webmaster) rows.push(...buildWebmasterExportRows({ period, data: input.model.webmaster }));
    else if (source.sourceKey === "yandex_wordstat" && input.model.wordstat) rows.push(...buildWordstatExportRows({ period, data: input.model.wordstat }));
    else if (source.sourceKey === "yandex_webmaster_alice_manual" && input.model.alice) rows.push(...buildAliceExportRows({ period, data: input.model.alice }));
    else if (source.sourceKey === "seo_os" && input.model.seoOs) rows.push(...buildSeoOsExportRows({ period, data: input.model.seoOs }));
    else {
      const meta = input.model.datasets[source.sourceKey];
      if (meta) rows.push(...buildExportRows({ title: source.sourceKey, period, source: meta }));
    }
  }
  const comparison = input.selection.traffic.comparison;
  if (comparison) {
    rows.push({ field: "Сравнение", value: comparison.key });
    const metrika = input.model.trafficComparison?.yandex_metrika;
    if (metrika && "kind" in metrika && metrika.kind === "metrika" && metrika.summary) rows.push(
      { field: "Визиты Metrika (сравнение)", value: String(metrika.summary.visits) },
      { field: "Просмотры Metrika (сравнение)", value: String(metrika.summary.pageviews) },
    );
    const webmaster = input.model.trafficComparison?.yandex_webmaster;
    if (webmaster && "kind" in webmaster && webmaster.kind === "webmaster" && webmaster.summary) rows.push(
      { field: "Клики Webmaster (сравнение)", value: String(webmaster.summary.clicks) },
      { field: "Показы Webmaster (сравнение)", value: String(webmaster.summary.impressions) },
    );
  }
  return rows;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly ExportRow[]): string {
  return ["Поле;Значение", ...rows.map((row) => `${csvCell(row.field)};${csvCell(row.value)}`)].join("\r\n");
}
