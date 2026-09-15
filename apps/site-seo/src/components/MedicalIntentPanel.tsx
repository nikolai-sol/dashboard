import type { DashboardTargetIntentView } from "../lib/read-model.ts";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const value = (metric: number | null) => metric === null ? "—" : number.format(metric);

function coverageCopy(source: DashboardTargetIntentView["sources"][number]): string {
  const label = source.source === "google" ? "Google" : "Яндекс";
  const status = !source.included
    ? source.reason === "failed" ? "ошибка сбора" : source.reason === "invalid_metrics" ? "некорректные данные" : "нет запросов за неделю"
    : source.reason === "complete_empty" ? "подтверждённо пусто"
      : source.meta?.state === "partial" || source.meta?.completeness !== "complete" ? "частичные данные" : "запросы за неделю";
  return `${label}: ${status}${source.included && source.meta?.latestAttempt === "failed" ? "; последняя загрузка не удалась" : ""}`;
}

export function MedicalIntentPanel({ intent }: Readonly<{ intent: DashboardTargetIntentView }>) {
  const available = intent.sources.some(source => source.included);
  const labels = intent.sources.filter(source => source.included).map(source => source.source === "google" ? "Google" : "Яндекс");
  return <section className="site-seo-panel site-seo-overview-panel site-seo-intent-panel">
    <header className="site-seo-overview-panel-header">
      <div><h2>Цель: рост целевого органического трафика</h2>
        <p>{labels.length ? labels.join(" + ") : "Поисковые запросы"} · {intent.period.from} — {intent.period.to}</p>
      </div>
    </header>
    <div className="site-seo-overview-panel-body">
      <div className="site-seo-intent-cards">
        {(["other", "target"] as const).map(category => {
          const card = intent[category];
          return <article key={category} className="site-seo-intent-card" data-category={category}>
            <div className="site-seo-intent-label">{card.label}
              <span title="Желаемое направление, не изменение за период" aria-label={category === "target" ? "Цель — увеличить долю" : "Цель — снизить долю"}>{category === "target" ? "↑" : "↓"}</span>
            </div>
            <div className="site-seo-intent-value">{value(card.sharePct)}{card.sharePct !== null ? "%" : ""}</div>
            <div className="site-seo-intent-caption">доля показов</div>
            <div className="site-seo-intent-facts">
              <div><b>{value(card.impressions)}</b><span>показов</span></div>
              <div><b>{value(card.clicks)}</b><span>кликов</span></div>
            </div>
          </article>;
        })}
      </div>
      <div className="site-seo-intent-coverage" aria-label="Охват статистики">
        {intent.sources.map(source => <span key={source.source} data-included={source.included}>{coverageCopy(source)}</span>)}
      </div>
      {!available ? <p className="site-seo-intent-unavailable">Нет статистики запросов за выбранную неделю.</p> : null}
      <div className="site-seo-intent-footer">
        <span title="Доля = показы категории / показы всех доступных запросов. Целевые запросы определяются активной опубликованной версией правил.">Доли среди запросов с доступной статистикой</span>
        <span title="Один человек может перейти несколько раз; это не число уникальных пользователей.">Клики ≠ пользователи</span>
      </div>
    </div>
  </section>;
}
