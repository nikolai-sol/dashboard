import { gscFilters, type PeriodSelection } from "../lib/period-selection.ts";

export function buildDashboardQuery(selection: PeriodSelection, publicationId: string | null, filters: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams({ traffic_week: selection.traffic.primary.key, gsc_period: selection.gsc.key, alice_month: selection.alice.key });
  if (selection.traffic.comparison) params.set("traffic_compare", selection.traffic.comparison.key);
  if (publicationId) params.set("publication", publicationId);
  for (const [key, value] of Object.entries(gscFilters(filters))) params.set(`filter_${key}`, value);
  return params.toString();
}

export function PeriodSelector({ selection, publicationId, filters, activeTab }: Readonly<{ selection: PeriodSelection; publicationId: string | null; filters: Readonly<Record<string, string>>; activeTab: string }>) {
  const showWeek = activeTab === "overview" || activeTab === "traffic" || activeTab === "search" || activeTab === "seo-os";
  const showComparison = activeTab === "overview" || activeTab === "traffic" || activeTab === "seo-os";
  const showGsc = activeTab === "overview" || activeTab === "search";
  const showAlice = activeTab === "overview" || activeTab === "alice";

  return <form className="site-seo-period-selector" method="get" aria-label="Периоды отчёта">
    {showWeek ? <label className="site-seo-field">Неделя <input className="site-seo-input" name="traffic_week" defaultValue={selection.traffic.primary.key} pattern="\d{4}-W\d{2}" required /></label> : <input type="hidden" name="traffic_week" value={selection.traffic.primary.key} />}
    {showComparison ? <label className="site-seo-field"><span>Сравнение</span><input className="site-seo-input" name="traffic_compare" defaultValue={selection.traffic.comparison?.key ?? ""} pattern="\d{4}-W\d{2}" /></label> : selection.traffic.comparison ? <input type="hidden" name="traffic_compare" value={selection.traffic.comparison.key} /> : null}
    {showGsc ? <label className="site-seo-field"><span>GSC</span><input className="site-seo-input" name="gsc_period" defaultValue={selection.gsc.key} required /></label> : <input type="hidden" name="gsc_period" value={selection.gsc.key} />}
    {showAlice ? <label className="site-seo-field"><span>Алиса</span><input className="site-seo-input" name="alice_month" defaultValue={selection.alice.key} pattern="\d{4}-\d{2}" required /></label> : <input type="hidden" name="alice_month" value={selection.alice.key} />}
    {publicationId && <input type="hidden" name="publication" value={publicationId} />}
    {Object.entries(filters).map(([key, value]) => <input key={key} type="hidden" name={`filter_${key}`} value={value} />)}
    <input type="hidden" name="tab" value={activeTab} />
    <button className="site-seo-button" type="submit">Применить</button>
  </form>;
}
