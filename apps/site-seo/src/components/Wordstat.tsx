import type { DatasetMeta } from "@reportingdash/site-seo-contract";
import type { WordstatCanonicalData } from "../lib/db.ts";

function wordstatStatus(meta?: DatasetMeta): string {
  if (!meta || meta.state === "missing") return "Источник не настроен или сбор ещё не выполнен";
  if (meta.state === "failed") return "Последний сбор завершился ошибкой";
  if (meta.state === "partial") return "Неполные данные";
  if (meta.state === "complete_empty") return "Подтверждённо пусто";
  return "Данные доступны";
}

export function Wordstat({ id, meta, data }: Readonly<{ id: string; meta?: DatasetMeta; data: WordstatCanonicalData | null }>) { return <section id={id}><h2>Wordstat</h2><p>{wordstatStatus(meta)}</p>{data?.period && <p>Окно snapshot: {data.period.from} — {data.period.to} (не недельный итог)</p>}{data?.demand != null && <p>Спрос: {data.demand}</p>}<table><tbody>{data?.queries.map((row) => <tr key={`${row.kind}:${row.query}`}><th>{row.query}</th><td>{row.kind}</td><td>{row.count}</td><td>{row.window.from} — {row.window.to}</td></tr>)}</tbody></table></section>; }
