import type { TargetIntentClassifiedQuery } from "@reportingdash/site-seo-contract";
import type { DashboardTargetIntentView } from "../lib/read-model.ts";

const number = new Intl.NumberFormat("ru-RU");

function sourceLabel(source: TargetIntentClassifiedQuery["source"]): string {
  return source === "google" ? "Google" : "Яндекс";
}

function queryCountLabel(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return "запросов";
  if (remainder10 === 1) return "запрос";
  if (remainder10 >= 2 && remainder10 <= 4) return "запроса";
  return "запросов";
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function categoryRows(view: DashboardTargetIntentView, category: "target" | "other") {
  return view.queries
    .filter((row) => row.category === category && row.impressions > 0)
    .toSorted((left, right) =>
      right.impressions - left.impressions ||
      right.clicks - left.clicks ||
      compareText(left.query, right.query) ||
      compareText(left.source, right.source));
}

function TargetTable({ rows, label }: Readonly<{ rows: readonly TargetIntentClassifiedQuery[]; label: string }>) {
  return <div className="site-seo-table-frame site-seo-intent-table-frame" role="region" aria-label={`${label}: запросы`} tabIndex={0}>
    <table className="site-seo-intent-table">
      <caption>{label}: запросы выбранной недели с положительным числом показов</caption>
      <thead><tr><th>Запрос</th><th>Источник</th><th>Показы</th><th>Клики</th><th>Группа</th><th>Правило</th><th>Тип совпадения</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.query}:${row.source}:${index}`}>
        <td>{row.query}</td><td>{sourceLabel(row.source)}</td><td>{number.format(row.impressions)}</td><td>{number.format(row.clicks)}</td><td>{row.group ?? "—"}</td><td>{row.matchedRule ?? "—"}</td><td>{row.matchType === "exact" ? "точное" : "фраза"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function OtherTable({ rows }: Readonly<{ rows: readonly TargetIntentClassifiedQuery[] }>) {
  return <div className="site-seo-table-frame site-seo-intent-table-frame" role="region" aria-label="Остальные запросы" tabIndex={0}>
    <table className="site-seo-intent-table">
      <caption>Остальные запросы выбранной недели с положительным числом показов</caption>
      <thead><tr><th>Запрос</th><th>Источник</th><th>Показы</th><th>Клики</th><th>Статус классификации</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.query}:${row.source}:${index}`}>
        <td>{row.query}</td><td>{sourceLabel(row.source)}</td><td>{number.format(row.impressions)}</td><td>{number.format(row.clicks)}</td><td>не найдено правило</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export type IntentQueryNavigation = Readonly<{
  target: Readonly<{ page: number; pageSize: number; open?: boolean }>;
  other: Readonly<{ page: number; pageSize: number; open?: boolean }>;
  pageHref: (category: "target" | "other", page: number) => string;
  downloadHref: (category: "target" | "other", format: "csv" | "xlsx") => string;
}>;

function DisclosureControls({ category, totalRows, navigation }: Readonly<{
  category: "target" | "other";
  totalRows: number;
  navigation: IntentQueryNavigation;
}>) {
  const settings = navigation[category];
  const totalPages = Math.max(1, Math.ceil(totalRows / settings.pageSize));
  const page = Math.min(totalPages, Math.max(1, settings.page));
  return <div className="site-seo-intent-table-controls">
    <span>Страница {page} из {totalPages}</span>
    <nav aria-label={`Страницы категории ${category}`}>
      {page > 1 ? <a href={navigation.pageHref(category, page - 1)}>← Назад</a> : null}
      {page < totalPages ? <a href={navigation.pageHref(category, page + 1)}>Вперёд →</a> : null}
    </nav>
    <span className="site-seo-intent-downloads">Скачать: <a href={navigation.downloadHref(category, "csv")}>CSV</a>{" · "}<a href={navigation.downloadHref(category, "xlsx")}>Excel</a></span>
  </div>;
}

function pageRows(rows: readonly TargetIntentClassifiedQuery[], category: "target" | "other", navigation?: IntentQueryNavigation) {
  if (!navigation) return rows.slice(0, 50);
  const { page, pageSize } = navigation[category];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const boundedPage = Math.min(totalPages, Math.max(1, page));
  const start = (boundedPage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function IntentQueryDisclosures({ view, navigation }: Readonly<{ view: DashboardTargetIntentView; navigation?: IntentQueryNavigation }>) {
  if (view.state !== "ready") return null;
  const target = categoryRows(view, "target");
  const other = categoryRows(view, "other");
  return <div className="site-seo-intent-disclosures">
    <details data-intent-category="target" open={navigation?.target.open === true || (navigation?.target.page !== undefined && navigation.target.page > 1)}>
      <summary>{view.target.label} — {target.length} {queryCountLabel(target.length)}</summary>
      <TargetTable rows={pageRows(target, "target", navigation)} label={view.target.label} />
      {navigation ? <DisclosureControls category="target" totalRows={target.length} navigation={navigation} /> : null}
    </details>
    <details data-intent-category="other" open={navigation?.other.open === true || (navigation?.other.page !== undefined && navigation.other.page > 1)}>
      <summary>{view.other.label} — {other.length} {queryCountLabel(other.length)}</summary>
      <OtherTable rows={pageRows(other, "other", navigation)} />
      {navigation ? <DisclosureControls category="other" totalRows={other.length} navigation={navigation} /> : null}
    </details>
  </div>;
}
