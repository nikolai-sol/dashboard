import type { DashboardTargetIntentView } from "../lib/read-model.ts";
import { IntentQueryDisclosures, type IntentQueryNavigation } from "./IntentQueryDisclosures.tsx";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const value = (metric: number | null) => metric === null ? "—" : number.format(metric);

function IntentCard({ category, card }: Readonly<{ category: "target" | "other"; card: DashboardTargetIntentView["target"] }>) {
  return <article className="site-seo-intent-card" data-category={category}>
    <div className="site-seo-intent-label">{card.label}
      <span title="Желаемое направление, не изменение за период" aria-label={category === "target" ? "Цель — увеличить долю" : "Цель — снизить долю"}>{category === "target" ? "↑" : "↓"}</span>
    </div>
    <div className="site-seo-intent-value">{value(card.sharePct)}{card.sharePct !== null ? "%" : ""}</div>
    <div className="site-seo-intent-caption">доля поисковых показов за выбранную неделю</div>
    <div className="site-seo-intent-facts">
      <div><b>{value(card.impressions)}</b><span>показов</span></div>
      <div><b>{value(card.clicks)}</b><span>кликов</span></div>
    </div>
  </article>;
}

function unavailableCopy(intent: DashboardTargetIntentView) {
  if (intent.state === "not_configured") return <p className="site-seo-intent-unavailable"><strong>Классификация не настроена.</strong> Запросы не отнесены к категории «Остальные запросы».</p>;
  if (intent.state === "unavailable") return <p className="site-seo-intent-unavailable"><strong>Классификация временно недоступна.</strong> Доли и итоги за выбранную неделю не рассчитаны.</p>;
  return null;
}

export function TargetIntentPanel({ intent, navigation }: Readonly<{ intent: DashboardTargetIntentView; navigation?: IntentQueryNavigation }>) {
  return <section className="site-seo-panel site-seo-overview-panel site-seo-intent-panel" data-intent-state={intent.state}>
    <header className="site-seo-overview-panel-header">
      <div><h2>Цель: целевой органический трафик + ИИ-выдача</h2>
        <p>Выбранная неделя · {intent.period.from} — {intent.period.to}</p>
      </div>
    </header>
    <div className="site-seo-overview-panel-body">
      <div className="site-seo-intent-cards">
        <IntentCard category="target" card={intent.target} />
        <IntentCard category="other" card={intent.other} />
      </div>
      {unavailableCopy(intent)}
      <IntentQueryDisclosures view={intent} navigation={navigation} />
      <div className="site-seo-intent-footer">
        <span title="Доля = показы категории / показы всех доступных запросов выбранной недели.">Доли рассчитаны по поисковым показам выбранной недели</span>
        <span title="Один человек может перейти несколько раз.">Клики — переходы из поиска, а не пользователи</span>
      </div>
    </div>
  </section>;
}
