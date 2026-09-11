import { gscFilters, type PeriodSelection } from "../lib/period-selection.ts";

export function buildDashboardQuery(selection: PeriodSelection, publicationId: string | null, filters: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams({ traffic_week: selection.traffic.primary.key, gsc_period: selection.gsc.key, alice_month: selection.alice.key });
  if (selection.traffic.comparison) params.set("traffic_compare", selection.traffic.comparison.key);
  if (publicationId) params.set("publication", publicationId);
  for (const [key, value] of Object.entries(gscFilters(filters))) params.set(`filter_${key}`, value);
  return params.toString();
}

export function PeriodSelector({ selection, publicationId, filters, activeTab, availableWeeks = [selection.traffic.primary, ...(selection.traffic.comparison ? [selection.traffic.comparison] : [])] }: Readonly<{ selection: PeriodSelection; publicationId: string | null; filters: Readonly<Record<string, string>>; activeTab: string; availableWeeks?: readonly PeriodSelection["traffic"]["primary"][] }>) {
  return <form className="site-seo-period-selector" method="get" aria-label="Периоды отчёта">
    <strong className="site-seo-period-heading">Отчётная SEO-неделя</strong>
    <label className="site-seo-field"><span>A · Основная неделя</span><select className="site-seo-input" name="traffic_week" defaultValue={selection.traffic.primary.key} required>{availableWeeks.map((week) => <option value={week.key} key={week.key}>{week.key} · {week.from} — {week.to}</option>)}</select></label>
    <label className="site-seo-field"><span>B · Сравнение</span><select className="site-seo-input" name="traffic_compare" defaultValue={selection.traffic.comparison?.key ?? ""}><option value="">Без сравнения</option>{availableWeeks.map((week) => <option value={week.key} key={week.key}>{week.key} · {week.from} — {week.to}</option>)}</select></label>
    <input type="hidden" name="gsc_period" value={selection.gsc.key} />
    <input type="hidden" name="alice_month" value={selection.alice.key} />
    {publicationId && <input type="hidden" name="publication" value={publicationId} />}
    {Object.entries(filters).map(([key, value]) => <input key={key} type="hidden" name={`filter_${key}`} value={value} />)}
    <input type="hidden" name="tab" value={activeTab} />
    <button className="site-seo-button" type="submit">Применить</button>
  </form>;
}
