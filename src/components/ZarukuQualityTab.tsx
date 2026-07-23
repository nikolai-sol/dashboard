import { buildZarukuTrustState } from "@/components/zaruku-quality-state";
import type { ZarukuDatasetKey, ZarukuSeoData, ZarukuSourceFreshnessRow } from "@/lib/types";

const DATASET_LABELS: Record<ZarukuDatasetKey, string> = {
  traffic_channels: "Каналы трафика",
  organic_trend: "Динамика органики",
  content_sections: "Разделы контента",
  top_pages: "Страницы",
  high_bounce_pages: "Риск отказов по входным страницам",
  best_engagement_pages: "Удержание по входным страницам",
  returning_pages: "Возврат к контенту",
  search_engines: "Поисковые системы после клика",
  search_phrases: "Поисковые фразы Метрики",
  organic_landing_pages: "Органические входные страницы",
  map_city_demand: "Города × каталог /map/",
  devices: "Устройства",
  source_devices: "Источник × устройство",
  browsers: "Браузеры",
  operating_systems: "Операционные системы",
  age: "Возраст",
  gender: "Пол",
  interests: "Интересы",
};

function panelClass(level: "trusted" | "partial" | "critical") {
  if (level === "critical") return "border-red-200 bg-red-50 text-red-900";
  if (level === "partial") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function statusLabel(status: ZarukuSourceFreshnessRow["freshness_status"]) {
  return status === "healthy" ? "актуален" : status === "delayed" ? "задерживается" : status === "failed" ? "ошибка" : "не запущен";
}

function statusClass(status: ZarukuSourceFreshnessRow["freshness_status"]) {
  return status === "healthy" ? "bg-emerald-50 text-emerald-700" : status === "failed" ? "bg-red-50 text-red-700" : status === "delayed" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
}

function coverageStateLabel(state: ZarukuSeoData["dataset_meta"][ZarukuDatasetKey]["state"]) {
  if (state === "partial") return "Покрытие неполное";
  if (state === "empty") return "Успешно, данных нет";
  if (state === "unavailable") return "Отчёт недоступен";
  return "Покрытие подтверждено";
}

function coverageStateClass(state: ZarukuSeoData["dataset_meta"][ZarukuDatasetKey]["state"]) {
  if (state === "partial") return "bg-amber-50 text-amber-700";
  if (state === "empty") return "bg-slate-100 text-slate-600";
  if (state === "unavailable") return "bg-red-50 text-red-700";
  return "bg-emerald-50 text-emerald-700";
}

export default function ZarukuQualityTab({ data }: { data: ZarukuSeoData }) {
  const datasets = Object.entries(data.dataset_meta) as Array<[ZarukuDatasetKey, ZarukuSeoData["dataset_meta"][ZarukuDatasetKey]]>;
  const trust = buildZarukuTrustState({ traffic: data.dataset_meta.traffic_channels, datasets: datasets.map(([, meta]) => meta), freshness: data.source_freshness });
  const nonReadyDatasets = datasets.filter(([, meta]) => meta.state !== "ready");
  return (
    <div className="space-y-5">
      <section className={`rounded-xl border px-5 py-4 ${panelClass(trust.level)}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-base font-semibold">Можно ли доверять данным?</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed opacity-80">Вердикт учитывает доступность canonical traffic, покрытие наборов и свежесть ключевого импорта.</p></div><span className="shrink-0 rounded-md border border-current/20 bg-white/70 px-2.5 py-1.5 text-xs font-semibold">{trust.label}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-md bg-white/70 px-3 py-2">Готово: <strong>{trust.counts.ready}</strong></div><div className="rounded-md bg-white/70 px-3 py-2">Частично: <strong>{trust.counts.partial}</strong></div><div className="rounded-md bg-white/70 px-3 py-2">Пусто: <strong>{trust.counts.empty}</strong></div><div className="rounded-md bg-white/70 px-3 py-2">Недоступно: <strong>{trust.counts.unavailable}</strong></div></div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white"><header className="border-b border-slate-100 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Покрытие и ограничения</h3><p className="mt-1 text-xs text-slate-500">Что можно интерпретировать сейчас и где выводы ограничены источником или grain.</p></header><div className="space-y-5 px-5 py-4"><div className="grid gap-3 md:grid-cols-2">{data.data_quality.map((item) => <div key={item.title} className="rounded-lg bg-slate-50 px-4 py-3"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-700">{item.title}</div><div className="mt-1 text-xs leading-relaxed text-slate-500">{item.note}</div></div><div className={item.severity === "warning" ? "text-sm font-medium text-amber-700" : "text-sm font-medium text-slate-600"}>{item.value}</div></div></div>)}</div>{nonReadyDatasets.length ? <div><h4 className="text-sm font-semibold text-slate-800">Наборы с ограничениями</h4><div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">{nonReadyDatasets.map(([key, meta]) => <div key={key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-sm font-medium text-slate-700">{DATASET_LABELS[key]}</div><div className="mt-1 text-xs text-slate-500">Покрытие: {meta.period.from} — {meta.period.to}</div>{meta.message ? <div className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">{meta.message}</div> : null}</div><span className={`w-fit shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${coverageStateClass(meta.state)}`}>{coverageStateLabel(meta.state)}</span></div>)}</div></div> : null}</div></section>

      <section className="rounded-xl border border-slate-200 bg-white"><header className="border-b border-slate-100 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Свежесть источников</h3><p className="mt-1 text-xs text-slate-500">Клиентский статус импорта; названия collectors и служебные счётчики доступны в деталях.</p></header><div className="px-5 py-4">{data.source_freshness.length ? <div className="space-y-3">{data.source_freshness.map((row) => <div key={row.source_key} className="rounded-lg border border-slate-200 px-4 py-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-800">{row.label}</div><div className="mt-1 text-xs text-slate-500">Покрытие: {row.date_from && row.date_to ? `${row.date_from} — ${row.date_to}` : "период не подтверждён"} · последний успех {row.last_success_at ?? "—"}</div></div><span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(row.freshness_status)}`}>{statusLabel(row.freshness_status)}</span></div><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium text-slate-600">Технические детали</summary><div className="mt-2 grid gap-1 rounded-md bg-slate-50 p-3 sm:grid-cols-2"><div>Collector: {row.collector}</div><div>Ожидаемый ритм: {row.expected_frequency_hours} ч.</div><div>Прочитано строк: {row.rows_read.toLocaleString("ru-RU")}</div><div>Записано строк: {row.rows_written.toLocaleString("ru-RU")}</div><div className="sm:col-span-2">{row.note}</div>{row.last_error_summary ? <div className="text-red-700 sm:col-span-2">{row.last_error_at ?? "Ошибка"}: {row.last_error_summary}</div> : null}</div></details></div>)}</div> : <div className="rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-500">Телеметрия регулярных импортов ещё не записана.</div>}</div></section>

      <section className="rounded-xl border border-slate-200 bg-white"><header className="border-b border-slate-100 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Ожидаемые источники</h3><p className="mt-1 text-xs text-slate-500">Источники, без которых отдельные выводы остаются неполными.</p></header><div className="px-5 py-4">{data.pending_requirements.length ? <div className="grid gap-3 md:grid-cols-2">{data.pending_requirements.map((item) => <div key={`${item.source}-${item.title}`} className="rounded-lg border border-dashed border-slate-200 p-4"><div className="text-sm font-semibold text-slate-700">{item.title}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{item.reason}</p></div>)}</div> : <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Все ожидаемые источники подключены.</div>}</div></section>
    </div>
  );
}
