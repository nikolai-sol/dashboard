import { gscFilters, type PeriodSelection } from "../lib/period-selection.ts";

export function buildDashboardQuery(selection: PeriodSelection, publicationId: string | null, filters: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams({ traffic_week: selection.traffic.primary.key, gsc_period: selection.gsc.key, alice_month: selection.alice.key });
  if (selection.traffic.comparison) params.set("traffic_compare", selection.traffic.comparison.key);
  if (publicationId) params.set("publication", publicationId);
  for (const [key, value] of Object.entries(gscFilters(filters))) params.set(`filter_${key}`, value);
  return params.toString();
}

export function PeriodSelector({ selection, publicationId, filters, activeTab, availableWeeks = [selection.traffic.primary, ...(selection.traffic.comparison ? [selection.traffic.comparison] : [])] }: Readonly<{ selection: PeriodSelection; publicationId: string | null; filters: Readonly<Record<string, string>>; activeTab: string; availableWeeks?: readonly PeriodSelection["traffic"]["primary"][] }>) {
  const hasWeeks = availableWeeks.length > 0;
  const comparisonEnabled = selection.traffic.comparison !== null;
  const comparisonAvailable = availableWeeks.length > 1;
  const previousWeek = [...availableWeeks]
    .filter((week) => week.key < selection.traffic.primary.key)
    .sort((left, right) => right.key.localeCompare(left.key))[0] ?? null;

  return <form className="site-seo-period-selector" method="get" aria-label="Периоды отчёта">
    <strong className="site-seo-period-heading">Отчётная SEO-неделя</strong>
    <div className="site-seo-period-mode" role="group" aria-label="Режим сравнения">
      <button className="site-seo-period-mode-button" type="submit" name="comparison_mode" value="single" aria-pressed={!comparisonEnabled} disabled={!hasWeeks}>Одна неделя</button>
      <button className="site-seo-period-mode-button" type="submit" name="comparison_mode" value="compare" aria-pressed={comparisonEnabled && comparisonAvailable} disabled={!comparisonAvailable}>Сравнить</button>
    </div>
    <label className="site-seo-field"><span>A · Основная неделя</span><select className="site-seo-input" name="traffic_week" defaultValue={hasWeeks ? selection.traffic.primary.key : ""} required disabled={!hasWeeks}>{!hasWeeks ? <option value="">Нет доступных недель</option> : null}{availableWeeks.map((week) => <option value={week.key} key={week.key}>{week.key} · {week.from} — {week.to}</option>)}</select></label>
    <label className="site-seo-field"><span>B · Сравнение</span><select className="site-seo-input" name="traffic_compare" defaultValue={selection.traffic.comparison?.key ?? ""} disabled={!comparisonEnabled || !comparisonAvailable}><option value="">Выберите неделю</option>{availableWeeks.map((week) => <option value={week.key} key={week.key}>{week.key} · {week.from} — {week.to}</option>)}</select></label>
    <button className="site-seo-period-previous" type="submit" name="comparison_mode" value="previous" data-week={previousWeek?.key} aria-label="Сравнить с предыдущей доступной неделей" title={previousWeek ? "Сравнить с предыдущей доступной неделей" : "Нет предыдущей доступной недели для сравнения"} disabled={!previousWeek}>↶</button>
    <input type="hidden" name="gsc_period" value={selection.gsc.key} />
    <input type="hidden" name="alice_month" value={selection.alice.key} />
    {publicationId && <input type="hidden" name="publication" value={publicationId} />}
    {Object.entries(filters).map(([key, value]) => <input key={key} type="hidden" name={`filter_${key}`} value={value} />)}
    <input type="hidden" name="tab" value={activeTab} />
    <button className="site-seo-button" type="submit" disabled={!hasWeeks}>Применить</button>
  </form>;
}
